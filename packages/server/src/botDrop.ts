import { DROP_BURNING, DROP_RIDING, STEP, createRayHit, shellArc, shipAt, type MechState, type MechStats, type PropInstance, type ShipPath, type World } from "@rustbucket/shared";
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
  ship: ShipPath | null; // the Rustbucket's line: every bot starts aboard and chooses a spot it can reach from it
}

export interface DropAim {
  yaw: number;
  pitch: number;
  moveY: number; // -1 holds back, 0 glides on
  fire: boolean; // aboard the ship: fire out of the cannon now
}

// The dive brain of a bot. Once, aboard the ship, it picks a landing spot it can reach from the ship's line: inside
// the first ring circle, on open ground, near buildings or crates and away from everyone else, or now and then right
// next to another mech's spot for a hot drop. It fires itself out when the ship passes closest to the spot, or a
// little before when the spot is so near the line that the shell's own arc would carry it past. Then every think it
// points at the spot and pitches by how far it still has to go for the height it has left, the way a person would:
// level when far, steep when close.
export class DropBrain {
  chosen = false;
  spotX = 0;
  spotZ = 0;
  private spotY = 0;
  private boxes: number[] = [];
  private hit = createRayHit();
  private arc = { dx: 0, dz: 0, drop: 0, vx: 0, vy: 0, vz: 0 };
  private at = { x: 0, z: 0 };
  private nearest = { x: 0, z: 0 };
  // Shell distances at the two ends of the launch pitch range, and the whole reach from the line, worked out on choosing.
  private shellNear = 0;
  private reachTotal = 0;

  forget(): void {
    this.chosen = false;
  }

  choose(self: MechState, plan: DropPlan, mech: MechStats, random: () => number): void {
    const s = plan.stats;
    const reach = this.reachFrom(self, plan, mech) * s.reachShare;
    const others = plan.taken.length / 2;
    let x = self.x, z = self.z, found = false;

    if (others > 0 && random() < s.hotDropChance) {
      const k = Math.floor(random() * others);
      const ox = plan.taken[k * 2]!, oz = plan.taken[k * 2 + 1]!;
      for (let i = 0; i < s.tries && !found; i++) {
        const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * s.hotDropMeters;
        x = ox + Math.cos(angle) * distance; z = oz + Math.sin(angle) * distance;
        found = this.fromLine(self, plan, x, z) <= reach && this.onMap(plan, x, z) && this.open(plan, x, z);
      }
    }

    if (!found) {
      const inside = Math.max(0, plan.radius - s.ringMarginMeters);
      let best = -Infinity;
      for (let i = 0; i < s.tries; i++) {
        const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * inside;
        let px = plan.cx + Math.cos(angle) * distance, pz = plan.cz + Math.sin(angle) * distance;
        // Out of reach of the line: as far from it as it can get that way instead, which may fall short of the circle.
        const away = this.fromLine(self, plan, px, pz);
        if (away > reach) {
          const nx = this.nearest.x, nz = this.nearest.z;
          px = nx + ((px - nx) * reach) / away; pz = nz + ((pz - nz) * reach) / away;
        }
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

  // Where to look and whether to hold back, to come down on the spot. Aboard the ship: where to aim the shot, and
  // whether to fire now.
  steer(self: MechState, plan: DropPlan, mech: MechStats, out: DropAim): void {
    const stats = plan.stats;
    const dx = this.spotX - self.x, dz = this.spotZ - self.z;
    const distance = Math.hypot(dx, dz);
    out.yaw = distance > 0.5 ? Math.atan2(-dx, -dz) : self.bodyYaw;
    out.pitch = mech.diveLevelPitch * DEG;
    out.moveY = distance < stats.holdBackMeters ? -1 : 0;
    out.fire = false;
    if (self.dropPhase === DROP_RIDING) {
      this.aimShot(self, plan, mech, distance, out);
      return;
    }
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

  // Aboard: aims down at the spot, steeper the nearer it is, and fires once the ship is as close to the spot as it
  // will get. A spot nearer the line than the shortest shot is fired at a little early, so the shell's own forward
  // carry lands it near the spot rather than past it. Just before the end of the line it goes anyway.
  private aimShot(self: MechState, plan: DropPlan, mech: MechStats, distance: number, out: DropAim): void {
    const ship = plan.ship;
    if (!ship) return;
    const share = Math.min(1, Math.max(0, (distance - this.shellNear) / Math.max(1, this.reachTotal - this.shellNear)));
    out.pitch = (mech.launchSteepPitch + share * (mech.launchLevelPitch - mech.launchSteepPitch)) * DEG;
    const lx = ship.x1 - ship.x0, lz = ship.z1 - ship.z0;
    const length = Math.hypot(lx, lz) || 1;
    const ahead = ((this.spotX - self.x) * lx + (this.spotZ - self.z) * lz) / length; // how far the spot is still ahead along the line
    const left = ((ship.x1 - self.x) * lx + (ship.z1 - self.z) * lz) / length; // how far until the end of the line
    out.fire = ahead <= 0 || distance <= this.shellNear || left <= ship.speed * plan.stats.lastChanceSeconds;
  }

  // How far from the line a spot can be and still be reached: the longest shot's carry, then a level glide from the
  // height it leaves the shell at. Also keeps the shortest shot's carry, for aiming.
  private reachFrom(self: MechState, plan: DropPlan, mech: MechStats): number {
    shellArc(0, mech.launchSteepPitch * DEG, mech, STEP, this.arc);
    this.shellNear = Math.hypot(this.arc.dx, this.arc.dz);
    shellArc(0, mech.launchLevelPitch * DEG, mech, STEP, this.arc);
    const carry = plan.ship ? Math.hypot(this.arc.dx, this.arc.dz) : 0;
    const startY = plan.ship ? self.y - this.arc.drop : self.y;
    const height = startY - this.surface(plan.world, plan.cx, plan.cz, self.y) - mech.burnMeters;
    this.reachTotal = carry + (Math.max(0, height) / mech.diveLevelFall) * mech.diveLevelGlide + (mech.burnMeters / mech.landingFall) * mech.burnGlide;
    return this.reachTotal;
  }

  // How far a spot is from the part of the line still ahead of the mech, and the nearest point of it (in `nearest`).
  // Without a ship it is the distance from the mech itself. The line only counts from where the ship is when the
  // match goes live: nobody fires in the countdown.
  private fromLine(self: MechState, plan: DropPlan, x: number, z: number): number {
    const ship = plan.ship;
    if (!ship || self.dropPhase !== DROP_RIDING) {
      this.nearest.x = self.x; this.nearest.z = self.z;
      return Math.hypot(x - self.x, z - self.z);
    }
    shipAt(ship, 0, this.at);
    const lx = ship.x1 - ship.x0, lz = ship.z1 - ship.z0;
    const length2 = lx * lx + lz * lz || 1;
    const along = (px: number, pz: number) => ((px - ship.x0) * lx + (pz - ship.z0) * lz) / length2;
    const from = Math.max(along(this.at.x, this.at.z), along(self.x, self.z));
    const t = Math.min(1, Math.max(from, along(x, z)));
    this.nearest.x = ship.x0 + lx * t; this.nearest.z = ship.z0 + lz * t;
    return Math.hypot(x - this.nearest.x, z - this.nearest.z);
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
