import { DROP_BURNING, createRayHit, type MechState, type MechStats, type PropInstance, type World } from "@rustbucket/shared";
import type { DropBotStats } from "./dropConfig";

const DEG = Math.PI / 180;
const STANDING = 0.5; // a box topping the ground by more than this stands in the way of a landing
const LOOK_DOWN = 4000; // metres: a ray down this far from the mech finds whatever is under a spot

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
  moveY: number; // -1 holds back, 0 glides on
}

// The dive brain of a bot. Once, as the dive starts, it picks a landing spot it can glide to: inside the first ring
// circle, on open ground, near buildings or crates and away from everyone else, or now and then right next to another
// mech's spot for a hot drop. Then every think it points at the spot and pitches by how far it still has to go for the
// height it has left, the way a person would: level when far, steep when close.
export class DropBrain {
  chosen = false;
  spotX = 0;
  spotZ = 0;
  private spotY = 0;
  private boxes: number[] = [];
  private hit = createRayHit();

  forget(): void {
    this.chosen = false;
  }

  choose(self: MechState, plan: DropPlan, mech: MechStats, random: () => number): void {
    const s = plan.stats;
    const reach = this.reach(self, plan.world, mech) * s.reachShare;
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
        // Out of gliding reach: as far as it can get that way instead, which may fall short of the circle.
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

    // Never out past the edge wall, even the fallback: the margin keeps the last of the glide on the map.
    const edge = Math.max(0, plan.half - s.ringMarginMeters);
    this.chosen = true;
    this.spotX = Math.max(-edge, Math.min(edge, x));
    this.spotZ = Math.max(-edge, Math.min(edge, z));
    x = this.spotX; z = this.spotZ;
    this.spotY = this.surface(plan.world, x, z, self.y);
    plan.taken.push(x, z);
  }

  // Where to look and whether to hold back, to come down on the spot.
  steer(self: MechState, mech: MechStats, stats: DropBotStats, out: DropAim): void {
    const dx = this.spotX - self.x, dz = this.spotZ - self.z;
    const distance = Math.hypot(dx, dz);
    out.yaw = distance > 0.5 ? Math.atan2(-dx, -dz) : self.bodyYaw;
    out.pitch = mech.diveLevelPitch * DEG;
    out.moveY = distance < stats.holdBackMeters ? -1 : 0;
    const height = self.y - this.spotY - mech.burnMeters;
    // Braking already: the pitch no longer matters, only the heading.
    if (self.dropPhase === DROP_BURNING || height <= 0) return;

    // The glide ratio it needs, against what each end of the pitch range gives. Glide and fall are both straight lines
    // in how steep the dive is, so solving glide / fall = ratio for steepness is exact.
    const ratio = distance / height;
    const g0 = mech.diveLevelGlide, g1 = mech.diveSteepGlide, f0 = mech.diveLevelFall, f1 = mech.diveSteepFall;
    const steep = Math.min(1, Math.max(0, (g0 - f0 * ratio) / (g0 - g1 + (f1 - f0) * ratio)));
    out.pitch = (mech.diveLevelPitch - steep * (mech.diveLevelPitch - mech.diveSteepPitch)) * DEG;
    // Closer than even the steepest dive keeps to: hold back too.
    if (ratio < g1 / f1) out.moveY = -1;
  }

  // How far a level glide carries from here: the dive down to the burn height, then the drift while braking.
  private reach(self: MechState, world: World, mech: MechStats): number {
    const height = self.y - this.surface(world, self.x, self.z, self.y) - mech.burnMeters;
    return (Math.max(0, height) / mech.diveLevelFall) * mech.diveLevelGlide + (mech.burnMeters / mech.landingFall) * mech.burnGlide;
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
