import { createRayHit, type AbilityStats, type AltFireState, type SecondaryStats, type WeaponStats, type BotPathStats, type BotStats, type MechInput, type MechState, type MechStats, type RingNow, type World } from "@rustbucket/shared";
import type { BotAbilityStats } from "./botAbilities";
import { DropBrain, type DropAim, type DropPlan } from "./botDrop";
import type { Pathfinder } from "./Pathfinder";
import { createSteerMemory, steerRound, type SteerBody } from "./steer";

const DEG = Math.PI / 180;
const EYE_HEIGHT = 2.4;
const CHEST_HEIGHT = 2.0;
// Close enough to loot: inside both the walk-over radius and the reach of E, with room to spare. A guess, small
// enough that a bot standing here really is on top of the thing.
const LOOT_REACH = 1.2;
const LOOT_DIRECT = 6; // nearer than this a bot walks straight at loot, not along a route that stops short
const SAME_LOOT = 0.5;
type GoalKind = "ring" | "loot" | "heard" | "hunt" | "wander";

export interface BotTarget {
  id: number;
  x: number; y: number; z: number; // feet position
  aimHeight?: number; // how far above the feet to aim, when not a mech's chest (the Junk Titan)
  person?: boolean; // a person playing: judged further away than they are (bots.json hunt.personDistanceScale)
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
  private shortFor = 0; // seconds spent past the end of routes that stop short of the goal, while they end in the same place
  private shortEndX = 0;
  private shortEndZ = 0;
  private heading = { x: 0, z: 0 };
  private heardX = 0;
  private heardZ = 0;
  private heardFor = 0;
  private atX = 0; // where it was at its last think, for judging which sound is nearer
  private atZ = 0;
  needsRepair = false; // set by the room: a part is bad enough that the bot stops to fix it when nobody is in sight
  abilityKind: AbilityStats["kind"] | null = null; // set by the room: the Q ability of the mech this bot drives
  // Set by the room: the size of the mech this bot drives, for stepping round trunks and crates in its way. Null
  // steers round nothing, which the tests of aim and routes rely on.
  body: SteerBody | null = null;
  // Set by the room before each think: the right-click of the gun in hand and the player's heat and charge, so it
  // can back off before overheating and release a charge when it is full. Null: never right-clicks.
  secondary: SecondaryStats | null = null;
  alt: AltFireState | null = null;
  weapon: WeaponStats | null = null; // the gun in hand, for its projectile kind and range (gate 18b)
  rivetsReady = 0; // its own rivets riding other mechs near enough to pop now, worked out by the room
  private detonateDown = false; // right-click was pressed last think: let go so the next press is a fresh one
  private venting = false; // let go of a spun up autocannon to cool, until the heat is down again
  private charging = false; // holding a spike driver charge
  private trackId = 0; // the target whose speed is being watched, for charging on one that stands still
  private trackX = 0;
  private trackZ = 0;
  private targetSpeed = Infinity;
  private steering = createSteerMemory();
  private steered = { x: 0, z: 0 };
  private healthMark = Infinity;
  private hurtFor = 0; // seconds left of feeling under fire since the last hit
  private dodgeFor = 0; // seconds left of getting out from under a Rail Shot laser
  private dodgeX = 0;
  private dodgeZ = 0;
  private dodgeDash = false; // dash once as the dodge starts
  private laserSeen = -1; // the last laser this bot decided about, so it rolls once per laser, not every tick
  personDistanceScale = 1; // set by the room from bots.json hunt
  private hasHunt = false;
  private huntX = 0;
  private huntZ = 0;
  private hasLoot = false;
  private lootX = 0;
  private lootZ = 0;
  private lootWreck = false;
  private lootTryingFor = 0; // seconds spent close to the current loot, trying to take it
  private pressE = false; // flips every think beside a pickup, so E goes down afresh for each thing lying there
  private skipLootX = 0;
  private skipLootZ = 0;
  private skipLootFor = 0; // seconds left of leaving alone loot it gave up on
  private dangerX = 0; // a circle to keep out of, the Junk Titan's reach; radius 0 for none
  private dangerZ = 0;
  private dangerRadius = 0;
  private drop = new DropBrain();
  private dropAim: DropAim = { yaw: 0, pitch: 0, targetX: 0, targetZ: 0 };

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

  // Something was heard here. With nobody in sight, the bot goes to have a look for a while: at the nearest thing it
  // has heard lately. Taking every newest sound instead, a bot near a big fight turned round with each shot, the sounds
  // a little off the real spots, and stood still.
  hear(x: number, z: number, seconds: number): void {
    if (this.heardFor > 0 && Math.hypot(x - this.atX, z - this.atZ) > Math.hypot(this.heardX - this.atX, this.heardZ - this.atZ)) return;
    this.heardX = x;
    this.heardZ = z;
    this.heardFor = seconds;
  }

  // Its hit points plus armor, every tick, from the room. Any drop means it was just hit, seen or not.
  noteHealth(health: number): void {
    if (health < this.healthMark && this.abilities) this.hurtFor = this.abilities.decoyHurtSeconds;
    this.healthMark = health;
  }

  // Something worth having, set by the room. The bot goes for it whenever nobody is in sight. A wreck is looted by
  // holding E, anything else is taken by a press.
  setLootGoal(x: number, z: number, wreck: boolean): void {
    // Loot it gave up on is left alone for a while, or the room would send it straight back.
    if (this.skipLootFor > 0 && Math.hypot(x - this.skipLootX, z - this.skipLootZ) < SAME_LOOT) { this.hasLoot = false; return; }
    if (!this.hasLoot || Math.hypot(x - this.lootX, z - this.lootZ) > SAME_LOOT) this.lootTryingFor = 0;
    this.hasLoot = true;
    this.lootX = x;
    this.lootZ = z;
    this.lootWreck = wreck;
  }

  clearLootGoal(): void {
    this.hasLoot = false;
  }

  get hasLootGoal(): boolean {
    return this.hasLoot;
  }

  // The nearest other mech, set by the room whether or not it can be seen. With nothing better to do the bot goes
  // looking for it, so bots meet and fight each other instead of wandering a big map alone.
  setHuntGoal(x: number, z: number): void {
    this.hasHunt = true;
    this.huntX = x;
    this.huntZ = z;
  }

  clearHuntGoal(): void {
    this.hasHunt = false;
  }

  // Set by the room every tick: somewhere it must not stand, the Junk Titan's stomp. Radius 0 for nowhere.
  keepOutOf(x: number, z: number, radius: number): void {
    this.dangerX = x;
    this.dangerZ = z;
    this.dangerRadius = radius;
  }

  // A new map means the old routes are meaningless.
  setFinder(finder: Pathfinder | null): void {
    this.finder = finder;
    this.path.length = 0;
    this.needsPlan = true;
  }

  // A new match: the next drop needs a new landing spot.
  forgetDrop(): void {
    this.drop.forget();
  }

  // The drop-in at the start of a match. Nothing to do but aim the ball at its spot (botDrop.ts): no weapons until it
  // is down. Its view turns at its usual speed, so it swings round like a person's rather than snapping.
  thinkDrop(self: MechState, plan: DropPlan, mech: MechStats, dt: number, out: MechInput): void {
    out.moveX = 0; out.moveY = 0; out.run = false; out.jet = false; out.dash = false; out.fire = false; out.altFire = false; out.grenade = false; out.interact = false; out.repair = false; out.ability = false;
    if (!this.drop.chosen) this.drop.choose(self, plan, mech, this.random);
    const aim = this.dropAim;
    this.drop.steer(self, aim);
    const maxTurn = this.stats.turnDegreesPerSecond * DEG * dt;
    const diff = Math.atan2(Math.sin(aim.yaw - this.aimYaw), Math.cos(aim.yaw - this.aimYaw));
    this.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    this.aimPitch += Math.max(-maxTurn, Math.min(maxTurn, aim.pitch - this.aimPitch));
    out.aimYaw = this.aimYaw;
    out.aimPitch = this.aimPitch;
    out.targetX = aim.targetX;
    out.targetZ = aim.targetZ;
  }

  // Where it means to land, for checks. Chosen as the match goes live.
  get dropSpot(): { x: number; z: number } | null {
    return this.drop.chosen ? { x: this.drop.spotX, z: this.drop.spotZ } : null;
  }

  think(self: MechState, targets: readonly BotTarget[], ring: RingNow | null, world: World, dt: number, out: MechInput): void {
    this.drop.forget(); // down: the next drop picks afresh
    this.atX = self.x; this.atZ = self.z;
    out.moveX = 0; out.moveY = 0; out.run = false; out.jet = false; out.dash = false; out.fire = false; out.altFire = false; out.grenade = false; out.interact = false; out.repair = false; out.ability = false;
    const s = this.stats;
    this.retargetIn -= dt;
    this.strafeIn -= dt;
    this.wanderIn -= dt;
    this.replanIn -= dt;
    this.heardFor -= dt;
    this.hurtFor -= dt;
    this.skipLootFor -= dt;

    const target = this.pickTarget(self, targets, world);
    let targetDistance = Infinity;
    let wantX = 0, wantZ = 0; // the direction to travel, in the world
    let run = false;
    let steerWithin = Infinity; // how far off the spot it walks straight to is, when it is close

    if (target) {
      this.shortFor = 0;
      if (target.id !== this.lastTargetId) { this.spottedFor = 0; this.lastTargetId = target.id; }
      this.spottedFor += dt;
      if (this.retargetIn <= 0) this.rerollAimError(Math.hypot(target.x - self.x, target.z - self.z));

      const aimX = target.x + this.aimOffsetX, aimY = target.y + (target.aimHeight ?? CHEST_HEIGHT) + this.aimOffsetY, aimZ = target.z + this.aimOffsetZ;
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
      this.watchSpeed(target, dt);
      this.useSecondary(distance, dt, out);
      this.useProjectile(out);
      if (this.abilityKind && this.abilities) this.useAbility(self, target, distance, dt, out);
    } else {
      this.lastTargetId = 0;
      this.charging = false;
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
      // Past the end of a route that stops short, travel heads straight on for the goal, and steering and hopping often
      // find the way the coarse grid could not. If they have not after a while, the goal is given up for another.
      if (this.shortFor > this.pathStats.giveUpSeconds) this.giveUp(goal.kind);
      // Loot: walk right up to it and use E. Holding it down loots a wreck. Anything else is taken by a press, so E goes
      // up and down: held down, it would take the first thing and never the one lying next to it.
      if (goal.kind === "loot") {
        const dx = goal.x - self.x, dz = goal.z - self.z;
        const distance = Math.hypot(dx, dz);
        // This close it should be had in a moment. Still not after a while, and it is not coming: up on a roof, say.
        if (distance < LOOT_DIRECT) {
          this.lootTryingFor += dt;
          if (this.lootTryingFor > this.pathStats.giveUpSeconds) this.giveUp("loot");
        }
        if (distance <= LOOT_REACH) {
          wantX = 0; wantZ = 0;
          this.pressE = !this.pressE;
          out.interact = this.lootWreck || this.pressE;
        } else if (distance < LOOT_DIRECT) { wantX = dx / distance; wantZ = dz / distance; steerWithin = distance; }
      }
      // Look where it is going.
      this.turnToward(self, self.x + heading.x * 10, self.y + EYE_HEIGHT, self.z + heading.z * 10, dt);
    }

    if (this.abilityKind === "decoy" && this.abilities) this.dropDecoys(targetDistance, dt, out);

    // Getting out from under a laser beats everything else it wanted to do.
    this.dodgeFor -= dt;
    if (this.dodgeFor > 0) {
      wantX = this.dodgeX; wantZ = this.dodgeZ; run = true;
      if (this.dodgeDash) { out.dash = true; this.dodgeDash = false; }
    }

    // Too near the Titan: get out first, running straight away from it, whatever else it wanted. Also keeps it from
    // being pinned against the Titan's body.
    if (this.dangerRadius > 0) {
      const dx = self.x - this.dangerX, dz = self.z - this.dangerZ;
      const distance = Math.hypot(dx, dz);
      if (distance < this.dangerRadius) {
        wantX = distance > 1e-3 ? dx / distance : 1; wantZ = distance > 1e-3 ? dz / distance : 0;
        run = true;
      }
    }

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

  // How fast the current target is moving, from where it was on the last think.
  private watchSpeed(target: BotTarget, dt: number): void {
    if (target.id !== this.trackId) this.targetSpeed = Infinity;
    else if (dt > 0) this.targetSpeed = Math.hypot(target.x - this.trackX, target.z - this.trackZ) / dt;
    this.trackId = target.id; this.trackX = target.x; this.trackZ = target.z;
  }

  // Right-click in a fight, decided once the left button already would fire (lined up, in range, reacted): slugs at
  // range, a spun up autocannon up close that lets go before it overheats, and a spike charged on a target that is
  // far off or standing still, let go only once it is full and lined up again.
  private useSecondary(distance: number, dt: number, out: MechInput): void {
    const sec = this.secondary, alt = this.alt, b = this.abilities?.secondary;
    if (!sec || !alt || !b) { this.charging = false; return; }
    const lined = out.fire;
    if (sec.kind !== "charge") this.charging = false;
    if (sec.kind === "slug") {
      if (lined && distance >= b.slugMinRange && distance <= sec.maxAimDistance) { out.fire = false; out.altFire = true; }
    } else if (sec.kind === "windup") {
      if (alt.heat >= b.windupHeatLimit || alt.overheat > 0) this.venting = true;
      else if (alt.heat <= b.windupResumeHeat) this.venting = false;
      if (lined && distance <= b.windupMaxRange && !this.venting) { out.fire = false; out.altFire = true; }
    } else if (this.charging) {
      out.fire = false;
      // The release step is the one that fires, toward the aim point this think set for the left button.
      if (sec.kind === "charge" && alt.charge >= sec.chargeSeconds && lined) this.charging = false;
      else out.altFire = true;
    } else if (sec.kind === "charge" && lined && (distance >= b.chargeMinRange || this.targetSpeed <= b.chargeStillSpeed) && this.random() < b.chargeChancePerSecond * dt) {
      this.charging = true;
      out.fire = false;
      out.altFire = true;
    }
  }

  // The rivet gun in a fight (gate 18b). Rivets go on whatever it shoots, and right-click pops them once enough ride
  // mechs that are close but not on top of it.
  private useProjectile(out: MechInput): void {
    const b = this.abilities?.secondary;
    if (this.weapon?.projectile.kind !== "rivet" || !b) { this.detonateDown = false; return; }
    const press = !this.detonateDown && this.rivetsReady >= b.detonateMinRivets;
    this.detonateDown = press;
    if (press) { out.altFire = true; out.fire = false; }
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
    } else if (this.abilityKind === "rail") {
      // A Rail Shot from range; the bot keeps tracking the target with its usual aim while it charges.
      if (distance < a.railMinRange || distance > a.railMaxRange || this.random() >= a.railChancePerSecond * dt) return;
    } else {
      return;
    }
    out.ability = true;
    // The aim point is the landing spot or the strike now. Holding fire this step keeps a shot from going there with
    // perfect aim.
    out.fire = false;
    out.targetX = target.x; out.targetY = target.y; out.targetZ = target.z;
  }

  // A Longshot's laser is on this bot (the room checks each tick). Once per laser it decides whether it noticed; if so
  // it dashes and runs off sideways, the way (sideX, sideZ) points, for the rest of the charge.
  laserOn(laserId: number, sideX: number, sideZ: number, seconds: number): void {
    if (laserId === this.laserSeen) return;
    this.laserSeen = laserId;
    if (!this.abilities || this.random() >= this.abilities.railDodgeChance) return;
    this.dodgeFor = seconds;
    this.dodgeX = sideX;
    this.dodgeZ = sideZ;
    this.dodgeDash = true;
  }

  // An Arbiter under fire, or with someone right on top of it, sends its decoys out to muddle them.
  private dropDecoys(targetDistance: number, dt: number, out: MechInput): void {
    const a = this.abilities!;
    if (this.hurtFor <= 0 && targetDistance > a.decoyNearRange) return;
    if (this.random() < a.decoyChancePerSecond * dt) out.ability = true;
  }

  // Getting nowhere with a goal: forget it and find something else to do. The ring is never given up on; heading
  // straight for its middle is all that is left.
  private giveUp(kind: GoalKind): void {
    this.shortFor = 0;
    if (kind === "loot") {
      this.hasLoot = false;
      this.skipLootX = this.lootX;
      this.skipLootZ = this.lootZ;
      this.skipLootFor = this.stats.wanderSeconds; // a guess: long enough to be well away before it is tempted back
    } else if (kind === "heard") {
      this.heardFor = 0;
    } else if (kind === "wander") {
      this.wanderIn = 0;
    }
  }

  // The direction to walk to reach a spot. Far spots are walked to along a planned route round obstacles, and so are
  // near ones with something in the way: walked straight at, a noise behind a building's wall pinned bots to the wall.
  // Near ones in the clear are walked to straight. If no route can be found it just heads straight there, and so it
  // does once past the end of a route that stops short of the spot.
  private travel(self: MechState, goalX: number, goalZ: number, dt: number): { x: number; z: number } {
    const out = this.heading;
    let tx = goalX, tz = goalZ;
    let onTheWay = false; // heading for a waypoint, not the end of its route
    const straight = Math.hypot(goalX - self.x, goalZ - self.z);

    if (this.finder && (straight > this.pathStats.minPathDistance || !this.finder.canWalkStraight(self.x, self.z, goalX, goalZ))) {
      // A whole route ends where the goal was when it was planned. Arrived there with the goal moved on a little since,
      // less than goalMoveReplan, it plans again rather than standing at the old spot.
      const n = this.path.length;
      const arrivedElsewhere = this.pathWhole && n > 0 && Math.hypot(this.path[n - 2]! - self.x, this.path[n - 1]! - self.z) < 3 &&
        Math.hypot(this.path[n - 2]! - goalX, this.path[n - 1]! - goalZ) > this.pathStats.waypointReach;
      const goalMoved = arrivedElsewhere || Math.hypot(goalX - this.pathGoalX, goalZ - this.pathGoalZ) > this.pathStats.goalMoveReplan;
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
        if (!this.finder.findPath(self.x, self.z, goalX, goalZ, this.path, self.y)) this.path.length = 0;
        this.pathWhole = this.path.length > 0 && this.finder.reachedGoal;
        this.noteRouteEnd(goalMoved);
      }
      // The last point of a whole route is the goal itself. The last of one that stops short is passed like any other.
      const last = this.pathWhole ? this.path.length - 2 : this.path.length;
      while (this.pathIndex * 2 < last && this.passed(self)) this.pathIndex++;
      if (this.path.length > 0 && this.pathIndex * 2 < this.path.length) {
        tx = this.path[this.pathIndex * 2]!;
        tz = this.path[this.pathIndex * 2 + 1]!;
        onTheWay = this.pathIndex * 2 < last;
      } else if (this.path.length > 0) {
        this.shortFor += dt;
      }
    } else {
      this.path.length = 0;
      this.needsPlan = true;
      this.shortFor = 0;
    }

    const dx = tx - self.x, dz = tz - self.z;
    const distance = Math.hypot(dx, dz);
    // Only the end is stopped short of: a waypoint on the way is walked right up to until it counts as passed.
    if (distance > 3 || (onTheWay && distance > 1e-3)) { out.x = dx / distance; out.z = dz / distance; } else { out.x = 0; out.z = 0; }
    return out;
  }

  // Whether the waypoint it is heading for counts as reached: within waypointReach of it, as long as it can walk
  // straight on to the one after from here. Cutting the corner from further off took bots into the end of the wall
  // the route goes round. Close enough, it moves on anyway.
  private passed(self: MechState): boolean {
    const i = this.pathIndex * 2, path = this.path;
    const distance = Math.hypot(path[i]! - self.x, path[i + 1]! - self.z);
    if (distance >= this.pathStats.waypointReach) return false;
    if (distance < this.pathStats.cornerReachMeters || i + 2 >= path.length) return true;
    return this.finder!.canWalkStraight(self.x, self.z, path[i + 2]!, path[i + 3]!);
  }

  // Time past the end of short routes adds up for as long as the new routes keep ending in the same place, so a bot
  // that walks back to that end and out again still gives up. A whole route, one that gets further, or a new goal
  // starts it again.
  private noteRouteEnd(goalMoved: boolean): void {
    const n = this.path.length;
    const endX = n > 0 ? this.path[n - 2]! : 0, endZ = n > 0 ? this.path[n - 1]! : 0;
    if (this.pathWhole || goalMoved || Math.hypot(endX - this.shortEndX, endZ - this.shortEndZ) > this.pathStats.waypointReach) this.shortFor = 0;
    this.shortEndX = endX;
    this.shortEndZ = endZ;
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
      const dx = t.x - self.x, dy = t.y + (t.aimHeight ?? CHEST_HEIGHT) - (self.y + EYE_HEIGHT), dz = t.z - self.z;
      const distance = Math.hypot(dx, dy, dz);
      // People count as further off, so bots near a person turn on each other more often than all on the person.
      const judged = t.person ? distance * this.personDistanceScale : distance;
      if (judged >= bestDistance) continue;
      // Anything solid in between hides them.
      if (world.raycast(self.x, self.y + EYE_HEIGHT, self.z, dx / distance, dy / distance, dz / distance, distance - 1, this.hit)) continue;
      best = t;
      bestDistance = judged;
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
  private chooseGoal(self: MechState, ring: RingNow | null): { x: number; z: number; urgent: boolean; kind: GoalKind } {
    if (ring) {
      const fromCentre = Math.hypot(self.x - ring.cx, self.z - ring.cz);
      if (fromCentre > ring.radius - this.stats.ringMargin) return { x: ring.cx, z: ring.cz, urgent: fromCentre > ring.radius, kind: "ring" };
    }
    // Loot beats a noise: a bot is greedy before it is curious.
    if (this.hasLoot) {
      const inside = !ring || Math.hypot(this.lootX - ring.cx, this.lootZ - ring.cz) < ring.radius;
      if (inside) return { x: this.lootX, z: this.lootZ, urgent: false, kind: "loot" };
    }
    // A sound worth checking, as long as going there does not mean leaving the safe area. Once there it has had its
    // look, and the next sound it hears, near or far, is the one to go to.
    if (this.heardFor > 0) {
      const inside = !ring || Math.hypot(this.heardX - ring.cx, this.heardZ - ring.cz) < ring.radius - this.stats.ringMargin;
      const there = Math.hypot(this.heardX - self.x, this.heardZ - self.z) <= 6;
      if (there) this.heardFor = 0;
      else if (inside) return { x: this.heardX, z: this.heardZ, urgent: false, kind: "heard" };
    }
    if (this.hasHunt) {
      const inside = !ring || Math.hypot(this.huntX - ring.cx, this.huntZ - ring.cz) < ring.radius - this.stats.ringMargin;
      if (inside) return { x: this.huntX, z: this.huntZ, urgent: false, kind: "hunt" };
    }
    if (this.wanderIn <= 0) {
      const range = ring ? Math.max(10, ring.radius - this.stats.ringMargin) : 60;
      const angle = this.random() * Math.PI * 2;
      const distance = Math.sqrt(this.random()) * range;
      this.goalX = (ring?.cx ?? self.x) + Math.cos(angle) * distance;
      this.goalZ = (ring?.cz ?? self.z) + Math.sin(angle) * distance;
      this.wanderIn = this.stats.wanderSeconds;
    }
    return { x: this.goalX, z: this.goalZ, urgent: false, kind: "wander" };
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
