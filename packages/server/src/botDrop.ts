import { ballFallSeconds, createRayHit, type MechState, type MechStats, type PropInstance, type World } from "@rustbucket/shared";
import type { DropBotStats } from "./dropConfig";

const STANDING = 0.5; // a box topping the ground by more than this stands in the way of a landing
const LOOK_DOWN = 4000; // metres: a ray down this far from the mech finds whatever is under a spot
const LOOK_DOWN_PITCH = -Math.PI / 4; // where a falling bot looks; nothing reads it but the drawing of its head

// What a bot needs to choose where to come down: the map, the first ring circle, and the spots other mechs chose.
export interface DropPlan {
  world: World;
  propOfBox: Int32Array; // box to prop, -1 for buildings, walls and rocks
  props: readonly PropInstance[];
  scenery: readonly boolean[]; // per prop type: trees, which are not worth landing next to
  cx: number; cz: number; radius: number; // the first circle the ring closes to
  half: number; // half the map's side: a big first circle can reach past the map's edge
  taken: number[]; // x, z, x, z... of spots already chosen; a bot adds its own when it chooses
  stats: DropBotStats;
}

export interface DropAim {
  yaw: number;
  pitch: number;
  targetX: number; // the point the ball steers toward, as a person's crosshair would be on it
  targetZ: number;
}

// The drop brain of a bot. Once, as the match goes live, it picks a landing spot it can reach from where it hangs
// (the top steer speed for the whole fall): inside the first ring circle if it can get there, on open ground, near
// buildings or crates and away from everyone else, or now and then right next to another mech's spot for a hot drop.
// Then it aims at the spot all the way down, the way a person looks where they want to land.
export class DropBrain {
  chosen = false;
  spotX = 0;
  spotZ = 0;
  private boxes: number[] = [];
  private hit = createRayHit();

  forget(): void {
    this.chosen = false;
  }

  choose(self: MechState, plan: DropPlan, mech: MechStats, random: () => number): void {
    const s = plan.stats;
    const height = self.y - this.surface(plan.world, self.x, self.z, self.y);
    const reach = mech.ballSteer * ballFallSeconds(height, mech) * s.reachShare;
    const others = plan.taken.length / 2;
    let x = self.x, z = self.z, found = false;

    if (others > 0 && random() < s.hotDropChance) {
      const k = Math.floor(random() * others);
      const ox = plan.taken[k * 2]!, oz = plan.taken[k * 2 + 1]!;
      for (let i = 0; i < s.tries && !found; i++) {
        const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * s.hotDropMeters;
        x = ox + Math.cos(angle) * distance; z = oz + Math.sin(angle) * distance;
        found = Math.hypot(x - self.x, z - self.z) <= reach && this.onMap(plan, x, z) && this.open(plan, x, z);
      }
    }

    if (!found) {
      const inside = Math.max(0, plan.radius - s.ringMarginMeters);
      let best = -Infinity;
      for (let i = 0; i < s.tries; i++) {
        const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * inside;
        let px = plan.cx + Math.cos(angle) * distance, pz = plan.cz + Math.sin(angle) * distance;
        // Out of reach: as far that way as it can get instead, which may fall short of the circle.
        const away = Math.hypot(px - self.x, pz - self.z);
        if (away > reach) { px = self.x + ((px - self.x) * reach) / away; pz = self.z + ((pz - self.z) * reach) / away; }
        if (!found) { x = px; z = pz; } // with no open spot at all, the last one tried will do
        if (!this.onMap(plan, px, pz) || !this.open(plan, px, pz)) continue;
        let score = Math.min(1, this.nearestTaken(plan, px, pz) / Math.max(1, s.spreadMeters));
        if (this.nearSomething(plan, px, pz)) score += s.lootWeight;
        if (Math.hypot(px - plan.cx, pz - plan.cz) > plan.radius) score -= 2; // the ring would be on it at once
        if (score > best) { best = score; x = px; z = pz; found = true; }
      }
    }

    // Never out past the edge wall, even the fallback: the margin keeps the landing on the map.
    const edge = Math.max(0, plan.half - s.ringMarginMeters);
    this.chosen = true;
    this.spotX = Math.max(-edge, Math.min(edge, x));
    this.spotZ = Math.max(-edge, Math.min(edge, z));
    plan.taken.push(this.spotX, this.spotZ);
  }

  // Where to look and steer: the spot, all the way down.
  steer(self: MechState, out: DropAim): void {
    const dx = this.spotX - self.x, dz = this.spotZ - self.z;
    out.yaw = Math.hypot(dx, dz) > 0.5 ? Math.atan2(-dx, -dz) : self.bodyYaw;
    out.pitch = LOOK_DOWN_PITCH;
    out.targetX = this.spotX;
    out.targetZ = this.spotZ;
  }

  // The top of whatever is under a spot: ground, a roof, a rock.
  private surface(world: World, x: number, z: number, fromY: number): number {
    if (world.raycast(x, fromY, z, 0, -1, 0, LOOK_DOWN, this.hit)) return fromY - this.hit.distance;
    const ground = world.groundAt(x, z);
    return Number.isFinite(ground) ? ground : 0;
  }

  private onMap(plan: DropPlan, x: number, z: number): boolean {
    const edge = plan.half - plan.stats.ringMarginMeters;
    return Math.abs(x) <= edge && Math.abs(z) <= edge;
  }

  // Open dry ground: nothing standing within clearMeters, and not in the water or out past an island's shore.
  private open(plan: DropPlan, x: number, z: number): boolean {
    const { world } = plan;
    const terrain = world.terrain;
    if (terrain && (!terrain.mayStand(x, z) || terrain.waterDepthAt(x, z) > 0)) return false;
    const ground = terrain ? terrain.heightAt(x, z) : this.surface(world, x, z, LOOK_DOWN);
    const c = plan.stats.clearMeters;
    const count = world.query(x - c, z - c, x + c, z + c, this.boxes);
    for (let i = 0; i < count; i++) if (world.boxes[this.boxes[i]!]!.maxY > ground + STANDING) return false;
    return true;
  }

  // A building, wall, rock, crate or barrel near the spot: somewhere with loot and cover. Trees do not count.
  private nearSomething(plan: DropPlan, x: number, z: number): boolean {
    const r = plan.stats.nearMeters;
    const count = plan.world.query(x - r, z - r, x + r, z + r, this.boxes);
    for (let i = 0; i < count; i++) {
      const prop = plan.propOfBox[this.boxes[i]!]!;
      if (prop < 0 || !plan.scenery[plan.props[prop]!.type]) return true;
    }
    return false;
  }

  private nearestTaken(plan: DropPlan, x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < plan.taken.length; i += 2) best = Math.min(best, Math.hypot(plan.taken[i]! - x, plan.taken[i + 1]! - z));
    return best;
  }
}
