import { createRayHit, type BotStats, type MechInput, type MechState, type RingNow, type World } from "@rustbucket/shared";

const DEG = Math.PI / 180;
const EYE_HEIGHT = 2.4;
const CHEST_HEIGHT = 2.0;

export interface BotTarget {
  id: number;
  x: number; y: number; z: number; // feet position
}

// A deliberately simple bot. It sees whoever is close and unobstructed, aims a little badly, backs off or closes in
// to a comfortable distance, strafes, throws the odd grenade, stays inside the ring, and hops when it is stuck.
// It produces a MechInput, the same thing a human's keyboard produces, so the room treats it like any player.
export class Bot {
  private aimYaw = Math.PI;
  private aimPitch = 0;
  private aimOffsetX = 0;
  private aimOffsetY = 0;
  private aimOffsetZ = 0;
  private retargetIn = 0;
  private strafe = 1;
  private strafeIn = 0;
  private spottedFor = 0;
  private lastTargetId = 0;
  private goalX = 0;
  private goalZ = 0;
  private wanderIn = 0;
  private lastX = 0;
  private lastZ = 0;
  private watchIn = 0;
  private unstuckFor = 0;
  private unstuckStrafe = 1;
  private hit = createRayHit();

  constructor(private stats: BotStats, private random: () => number) {}

  think(self: MechState, targets: readonly BotTarget[], ring: RingNow | null, world: World, dt: number, out: MechInput): void {
    out.moveX = 0; out.moveY = 0; out.run = false; out.jet = false; out.dash = false; out.fire = false; out.grenade = false;
    const s = this.stats;
    this.retargetIn -= dt;
    this.strafeIn -= dt;
    this.wanderIn -= dt;

    const target = this.pickTarget(self, targets, world);
    let wantX = 0, wantZ = 0; // the direction to travel, in the world
    let run = false;

    if (target) {
      if (target.id !== this.lastTargetId) { this.spottedFor = 0; this.lastTargetId = target.id; }
      this.spottedFor += dt;
      if (this.retargetIn <= 0) this.rerollAimError(Math.hypot(target.x - self.x, target.z - self.z));

      const aimX = target.x + this.aimOffsetX, aimY = target.y + CHEST_HEIGHT + this.aimOffsetY, aimZ = target.z + this.aimOffsetZ;
      this.turnToward(self, aimX, aimY, aimZ, dt);

      const dx = target.x - self.x, dz = target.z - self.z;
      const distance = Math.hypot(dx, dz) || 1;
      const toward = this.preferredMovement(distance, dx / distance, dz / distance);
      wantX = toward.x; wantZ = toward.z;
      run = distance > s.preferredDistance * 1.8;

      const wanted = this.angleTo(self, aimX, aimY, aimZ);
      if (this.spottedFor >= s.reactionSeconds && distance <= s.maxFireRange && wanted < s.fireToleranceDegrees * DEG) {
        out.fire = true;
        out.targetX = aimX; out.targetY = aimY; out.targetZ = aimZ;
      }
      if (distance >= s.grenadeMinRange && distance <= s.grenadeMaxRange && this.random() < s.grenadeChancePerSecond * dt) {
        out.grenade = true;
        out.targetX = target.x; out.targetY = target.y; out.targetZ = target.z;
      }
    } else {
      this.lastTargetId = 0;
      const goal = this.chooseGoal(self, ring);
      const dx = goal.x - self.x, dz = goal.z - self.z;
      const distance = Math.hypot(dx, dz) || 1;
      if (distance > 3) { wantX = dx / distance; wantZ = dz / distance; }
      run = goal.urgent;
      // Look where it is going.
      this.turnToward(self, goal.x, self.y + EYE_HEIGHT, goal.z, dt);
    }

    // Stuck: it means to move but is not getting anywhere, so hop and slide sideways for a moment.
    this.watchIn -= dt;
    if (this.watchIn <= 0) {
      const moved = Math.hypot(self.x - this.lastX, self.z - this.lastZ);
      if ((wantX !== 0 || wantZ !== 0) && moved < 0.6 * s.stuckSeconds && this.unstuckFor <= 0) {
        this.unstuckFor = 0.8;
        this.unstuckStrafe = this.random() < 0.5 ? -1 : 1;
      }
      this.lastX = self.x; this.lastZ = self.z;
      this.watchIn = s.stuckSeconds;
    }
    if (this.unstuckFor > 0) {
      this.unstuckFor -= dt;
      out.jet = true;
      wantX += Math.cos(this.aimYaw) * this.unstuckStrafe;
      wantZ += -Math.sin(this.aimYaw) * this.unstuckStrafe;
    }

    // Turn the wanted world direction into forward and sideways keys relative to where the bot is looking.
    const length = Math.hypot(wantX, wantZ);
    if (length > 1e-6) {
      wantX /= length; wantZ /= length;
      const forwardX = -Math.sin(this.aimYaw), forwardZ = -Math.cos(this.aimYaw);
      const rightX = Math.cos(this.aimYaw), rightZ = -Math.sin(this.aimYaw);
      out.moveY = wantX * forwardX + wantZ * forwardZ;
      out.moveX = wantX * rightX + wantZ * rightZ;
      out.run = run;
    }
    out.aimYaw = this.aimYaw;
    out.aimPitch = this.aimPitch;
  }

  private pickTarget(self: MechState, targets: readonly BotTarget[], world: World): BotTarget | null {
    let best: BotTarget | null = null;
    let bestDistance = this.stats.sightRange;
    for (const t of targets) {
      const dx = t.x - self.x, dy = t.y + CHEST_HEIGHT - (self.y + EYE_HEIGHT), dz = t.z - self.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= bestDistance) continue;
      // Anything solid in between hides them.
      if (world.raycast(self.x, self.y + EYE_HEIGHT, self.z, dx / distance, dy / distance, dz / distance, distance - 1, this.hit)) continue;
      best = t;
      bestDistance = distance;
    }
    return best;
  }

  private rerollAimError(distance: number): void {
    const error = this.stats.aimErrorDegrees * DEG;
    this.aimOffsetX = (this.random() - 0.5) * 2 * Math.tan(error) * distance;
    this.aimOffsetY = (this.random() - 0.5) * 2 * Math.tan(error) * distance * 0.5;
    this.aimOffsetZ = (this.random() - 0.5) * 2 * Math.tan(error) * distance;
    this.retargetIn = this.stats.aimRetargetSeconds;
  }

  private preferredMovement(distance: number, towardX: number, towardZ: number): { x: number; z: number } {
    if (this.strafeIn <= 0) {
      this.strafe = this.random() < 0.5 ? -1 : 1;
      this.strafeIn = this.stats.strafeSeconds * (0.6 + this.random() * 0.8);
    }
    const sideX = -towardZ * this.strafe, sideZ = towardX * this.strafe;
    const preferred = this.stats.preferredDistance;
    if (distance > preferred + 8) return { x: towardX + sideX * 0.3, z: towardZ + sideZ * 0.3 };
    if (distance < preferred - 8) return { x: -towardX + sideX * 0.5, z: -towardZ + sideZ * 0.5 };
    return { x: sideX, z: sideZ };
  }

  // The ring wins over wandering: near its edge, or outside it, the bot heads for the middle.
  private chooseGoal(self: MechState, ring: RingNow | null): { x: number; z: number; urgent: boolean } {
    if (ring) {
      const fromCentre = Math.hypot(self.x - ring.cx, self.z - ring.cz);
      if (fromCentre > ring.radius - this.stats.ringMargin) return { x: ring.cx, z: ring.cz, urgent: fromCentre > ring.radius };
    }
    if (this.wanderIn <= 0) {
      const range = ring ? Math.max(10, ring.radius - this.stats.ringMargin) : 60;
      const angle = this.random() * Math.PI * 2;
      const distance = Math.sqrt(this.random()) * range;
      this.goalX = (ring?.cx ?? self.x) + Math.cos(angle) * distance;
      this.goalZ = (ring?.cz ?? self.z) + Math.sin(angle) * distance;
      this.wanderIn = this.stats.wanderSeconds;
    }
    return { x: this.goalX, z: this.goalZ, urgent: false };
  }

  private turnToward(self: MechState, x: number, y: number, z: number, dt: number): void {
    const dx = x - self.x, dz = z - self.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(y - (self.y + EYE_HEIGHT), Math.hypot(dx, dz));
    const maxTurn = this.stats.turnDegreesPerSecond * DEG * dt;
    let diff = Math.atan2(Math.sin(wantYaw - this.aimYaw), Math.cos(wantYaw - this.aimYaw));
    this.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    diff = wantPitch - this.aimPitch;
    this.aimPitch += Math.max(-maxTurn, Math.min(maxTurn, diff));
    this.aimPitch = Math.max(-1.2, Math.min(1.2, this.aimPitch));
  }

  // How far, in radians, the bot's aim is from pointing at a spot.
  private angleTo(self: MechState, x: number, y: number, z: number): number {
    const dx = x - self.x, dy = y - (self.y + EYE_HEIGHT), dz = z - self.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const yawError = Math.abs(Math.atan2(Math.sin(wantYaw - this.aimYaw), Math.cos(wantYaw - this.aimYaw)));
    return Math.hypot(yawError, wantPitch - this.aimPitch);
  }
}
