import { createRayHit, type AbilityStats, type BotPathStats, type BotStats, type MechInput, type MechState, type RingNow, type World } from "@rustbucket/shared";
import type { BotAbilityStats } from "./botAbilities";
import type { Pathfinder } from "./Pathfinder";
import { createSteerMemory, steerRound, type SteerBody } from "./steer";

const DEG = Math.PI / 180;
const EYE_HEIGHT = 2.4;
const CHEST_HEIGHT = 2.0;
// Close enough to loot: inside both the walk-over radius and the reach of E, with room to spare. A guess, small
// enough that a bot standing here really is on top of the thing.
const LOOT_REACH = 1.2;
const LOOT_DIRECT = 6; // nearer than this a bot walks straight at loot, not along a route that stops short

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

  // The route to where it is heading: x, z, x, z... and how far along it is.
  private path: number[] = [];
  private pathIndex = 0;
  private pathGoalX = 0;
  private pathGoalZ = 0;
  private replanIn = 0;
  private needsPlan = true; // no route for the current goal yet
  private pathWhole = false; // the route goes all the way to the goal, not just as far as the search got
  private heading = { x: 0, z: 0 };
  private heardX = 0;
  private heardZ = 0;
  private heardFor = 0;
  needsRepair = false; // set by the room: a part is bad enough that the bot stops to fix it when nobody is in sight
  abilityKind: AbilityStats["kind"] | null = null; // set by the room: the Q ability of the mech this bot drives
  // Set by the room: the size of the mech this bot drives, for stepping round trunks and crates in its way. Null
  // steers round nothing, which the tests of aim and routes rely on.
  body: SteerBody | null = null;
  private steering = createSteerMemory();
  private steered = { x: 0, z: 0 };
  private healthMark = Infinity;
  private hurtFor = 0; // seconds left of feeling under fire since the last hit
  private hasLoot = false;
  private lootX = 0;
  private lootZ = 0;

  constructor(
    private stats: BotStats,
    private random: () => number,
    private pathStats: BotPathStats,
    private finder: Pathfinder | null,
    readonly rating = 2, // easy 1, normal 2, hard 3, used to settle fights that are worked out on paper
    private abilities: BotAbilityStats | null = null, // null: never presses Q, whatever its mech
  ) {
    this.replanIn = random() * pathStats.replanSeconds; // so a room full of bots does not all search on the same tick
  }

  // Something was heard here. With nobody in sight, the bot goes to have a look for a while.
  hear(x: number, z: number, seconds: number): void {
    this.heardX = x;
    this.heardZ = z;
    this.heardFor = seconds;
  }

  // Its hit points plus armor, every tick, from the room. Any drop means it was just hit, seen or not.
  noteHealth(health: number): void {
    if (health < this.healthMark && this.abilities) this.hurtFor = this.abilities.decoyHurtSeconds;
    this.healthMark = health;
  }

  // Something worth having, set by the room. The bot goes for it whenever nobody is in sight.
  setLootGoal(x: number, z: number): void {
    this.hasLoot = true;
    this.lootX = x;
    this.lootZ = z;
  }

  clearLootGoal(): void {
    this.hasLoot = false;
  }

  // A new map means the old routes are meaningless.
  setFinder(finder: Pathfinder | null): void {
    this.finder = finder;
    this.path.length = 0;
    this.needsPlan = true;
  }

  think(self: MechState, targets: readonly BotTarget[], ring: RingNow | null, world: World, dt: number, out: MechInput): void {
    out.moveX = 0; out.moveY = 0; out.run = false; out.jet = false; out.dash = false; out.fire = false; out.grenade = false; out.interact = false; out.repair = false; out.ability = false;
    const s = this.stats;
    this.retargetIn -= dt;
    this.strafeIn -= dt;
    this.wanderIn -= dt;
    this.replanIn -= dt;
    this.heardFor -= dt;
    this.hurtFor -= dt;

    const target = this.pickTarget(self, targets, world);
    let targetDistance = Infinity;
    let wantX = 0, wantZ = 0; // the direction to travel, in the world
    let run = false;
    let steerWithin = Infinity; // how far off the spot it walks straight to is, when it is close

    if (target) {
      if (target.id !== this.lastTargetId) { this.spottedFor = 0; this.lastTargetId = target.id; }
      this.spottedFor += dt;
      if (this.retargetIn <= 0) this.rerollAimError(Math.hypot(target.x - self.x, target.z - self.z));

      const aimX = target.x + this.aimOffsetX, aimY = target.y + CHEST_HEIGHT + this.aimOffsetY, aimZ = target.z + this.aimOffsetZ;
      this.turnToward(self, aimX, aimY, aimZ, dt);

      const dx = target.x - self.x, dz = target.z - self.z;
      const distance = Math.hypot(dx, dz) || 1;
      targetDistance = distance;
      const toward = this.preferredMovement(distance, dx / distance, dz / distance);
      wantX = toward.x; wantZ = toward.z;
      // A fight that is a long way off is walked to along a route, so the bot does not run into a wall on the way.
      if (distance > s.preferredDistance + 8 && distance > this.pathStats.minPathDistance) {
        const heading = this.travel(self, target.x, target.z, dt);
        wantX = heading.x; wantZ = heading.z;
      }
      if (this.random() < s.dashChancePerSecond * dt) out.dash = true; // a quick dodge sideways
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
      if (this.abilityKind && this.abilities) this.useAbility(self, target, distance, dt, out);
    } else {
      this.lastTargetId = 0;
      // Out of sight is as safe as it gets: stop and repair, unless the ring is coming.
      if (this.needsRepair && (!ring || Math.hypot(self.x - ring.cx, self.z - ring.cz) < ring.radius - this.stats.ringMargin)) {
        out.repair = true;
        out.aimYaw = this.aimYaw;
        out.aimPitch = this.aimPitch;
        return;
      }
      const goal = this.chooseGoal(self, ring);
      const heading = this.travel(self, goal.x, goal.z, dt);
      wantX = heading.x; wantZ = heading.z;
      run = goal.urgent;
      // Loot: walk right up to it and hold E. Holding is what loots a wreck; the first step of it takes a weapon.
      if (goal.loot) {
        const dx = goal.x - self.x, dz = goal.z - self.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= LOOT_REACH) { wantX = 0; wantZ = 0; out.interact = true; }
        else if (distance < LOOT_DIRECT) { wantX = dx / distance; wantZ = dz / distance; steerWithin = distance; }
      }
      // Look where it is going.
      this.turnToward(self, self.x + heading.x * 10, self.y + EYE_HEIGHT, self.z + heading.z * 10, dt);
    }

    if (this.abilityKind === "decoy" && this.abilities) this.dropDecoys(targetDistance, dt, out);

    // Routes go straight through woods, so whatever it wants, it steps round a trunk or crate right in front of it.
    if (this.body && (wantX !== 0 || wantZ !== 0)) {
      steerRound(world, self.x, self.y, self.z, wantX, wantZ, this.body, this.pathStats, this.steering, this.steered, steerWithin);
      wantX = this.steered.x; wantZ = this.steered.z;
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

  // Q in a fight: a ram once the target is close and lined up dead ahead, since it charges the way the bot looks, a
  // pounce onto the target from a middling range, or a mortar strike on it from further off. The mech step ignores
  // the key while the ability is cooling down. Decoys are not about a target, so they are decided apart.
  private useAbility(self: MechState, target: BotTarget, distance: number, dt: number, out: MechInput): void {
    const a = this.abilities!;
    if (this.abilityKind === "ram") {
      if (distance < a.ramMinRange || distance > a.ramMaxRange) return;
      const toward = Math.atan2(-(target.x - self.x), -(target.z - self.z));
      const off = Math.abs(Math.atan2(Math.sin(toward - this.aimYaw), Math.cos(toward - this.aimYaw)));
      if (off > a.ramMaxAngleDegrees * DEG || this.random() >= a.ramChancePerSecond * dt) return;
      out.ability = true;
      return;
    }
    if (this.abilityKind === "pounce") {
      if (distance < a.pounceMinRange || distance > a.pounceMaxRange || this.random() >= a.pounceChancePerSecond * dt) return;
    } else if (this.abilityKind === "barrage") {
      if (distance < a.barrageMinRange || distance > a.barrageMaxRange || this.random() >= a.barrageChancePerSecond * dt) return;
    } else {
      return;
    }
    out.ability = true;
    // The aim point is the landing spot or the strike now. Holding fire this step keeps a shot from going there with
    // perfect aim.
    out.fire = false;
    out.targetX = target.x; out.targetY = target.y; out.targetZ = target.z;
  }

  // An Arbiter under fire, or with someone right on top of it, sends its decoys out to muddle them.
  private dropDecoys(targetDistance: number, dt: number, out: MechInput): void {
    const a = this.abilities!;
    if (this.hurtFor <= 0 && targetDistance > a.decoyNearRange) return;
    if (this.random() < a.decoyChancePerSecond * dt) out.ability = true;
  }

  // The direction to walk to reach a spot. Far spots are walked to along a planned route round obstacles,
  // near ones straight. If no route can be found it just heads straight there.
  private travel(self: MechState, goalX: number, goalZ: number, dt: number): { x: number; z: number } {
    const out = this.heading;
    let tx = goalX, tz = goalZ;
    const straight = Math.hypot(goalX - self.x, goalZ - self.z);

    if (this.finder && straight > this.pathStats.minPathDistance) {
      const goalMoved = Math.hypot(goalX - this.pathGoalX, goalZ - this.pathGoalZ) > this.pathStats.goalMoveReplan;
      // Replanning on the clock used to be most of a large room's tick, and on a map that never changes it mostly
      // found the same route again. So the clock only replans when the bot has been pushed off its route (it can no
      // longer walk straight to its next waypoint), or is on the last leg of one that stopped short of the goal.
      if (this.replanIn <= 0 && !this.needsPlan && !goalMoved && this.onRoute(self)) {
        this.replanIn = this.pathStats.replanSeconds * (0.8 + this.random() * 0.4);
      }
      // A failed search waits for the next replan too, rather than trying again every tick.
      if ((this.needsPlan || this.replanIn <= 0 || goalMoved) && this.finder.canSearch()) {
        this.needsPlan = false;
        this.pathIndex = 0;
        this.pathGoalX = goalX; this.pathGoalZ = goalZ;
        this.replanIn = this.pathStats.replanSeconds * (0.8 + this.random() * 0.4);
        if (!this.finder.findPath(self.x, self.z, goalX, goalZ, this.path)) this.path.length = 0;
        this.pathWhole = this.path.length > 0 && this.finder.reachedGoal;
      }
      while (this.pathIndex * 2 < this.path.length - 2 && Math.hypot(this.path[this.pathIndex * 2]! - self.x, this.path[this.pathIndex * 2 + 1]! - self.z) < this.pathStats.waypointReach) this.pathIndex++;
      if (this.path.length > 0 && this.pathIndex * 2 < this.path.length) {
        tx = this.path[this.pathIndex * 2]!;
        tz = this.path[this.pathIndex * 2 + 1]!;
      }
    } else {
      this.path.length = 0;
      this.needsPlan = true;
    }

    const dx = tx - self.x, dz = tz - self.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 3) { out.x = dx / distance; out.z = dz / distance; } else { out.x = 0; out.z = 0; }
    return out;
  }

  private onRoute(self: MechState): boolean {
    if (this.pathIndex * 2 >= this.path.length) return false;
    if (!this.pathWhole && this.pathIndex * 2 >= this.path.length - 2) return false;
    return this.finder!.canWalkStraight(self.x, self.z, this.path[this.pathIndex * 2]!, this.path[this.pathIndex * 2 + 1]!);
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
  private chooseGoal(self: MechState, ring: RingNow | null): { x: number; z: number; urgent: boolean; loot: boolean } {
    if (ring) {
      const fromCentre = Math.hypot(self.x - ring.cx, self.z - ring.cz);
      if (fromCentre > ring.radius - this.stats.ringMargin) return { x: ring.cx, z: ring.cz, urgent: fromCentre > ring.radius, loot: false };
    }
    // Loot beats a noise: a bot is greedy before it is curious.
    if (this.hasLoot) {
      const inside = !ring || Math.hypot(this.lootX - ring.cx, this.lootZ - ring.cz) < ring.radius;
      if (inside) return { x: this.lootX, z: this.lootZ, urgent: false, loot: true };
    }
    // A sound worth checking, as long as going there does not mean leaving the safe area.
    if (this.heardFor > 0) {
      const inside = !ring || Math.hypot(this.heardX - ring.cx, this.heardZ - ring.cz) < ring.radius - this.stats.ringMargin;
      if (inside && Math.hypot(this.heardX - self.x, this.heardZ - self.z) > 6) return { x: this.heardX, z: this.heardZ, urgent: false, loot: false };
    }
    if (this.wanderIn <= 0) {
      const range = ring ? Math.max(10, ring.radius - this.stats.ringMargin) : 60;
      const angle = this.random() * Math.PI * 2;
      const distance = Math.sqrt(this.random()) * range;
      this.goalX = (ring?.cx ?? self.x) + Math.cos(angle) * distance;
      this.goalZ = (ring?.cz ?? self.z) + Math.sin(angle) * distance;
      this.wanderIn = this.stats.wanderSeconds;
    }
    return { x: this.goalX, z: this.goalZ, urgent: false, loot: false };
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
