import { DROP_BURNING, DROP_HANGING, dropping, landDrop, steerDrop } from "./drop";
import type { AbilityStats, PounceStats } from "./abilities";
import type { MechInput } from "./MechInput";
import { Meter } from "./Meter";
import type { MechStats } from "./stats";
import type { Box, World } from "./world";

const DEG = Math.PI / 180;
// A small constant push into the floor keeps the mech reporting grounded while it stands still.
const STICK_TO_GROUND = -2;
// A ram that has lost more than half its speed to a wall has hit it, and stops instead of grinding along it.
const RAM_BLOCKED_FRACTION = 0.5;
// An aim point this close (or straight down at your own feet) gives no useful direction, so the leap goes ahead instead.
const POUNCE_MIN_TARGET = 3;
const POUNCE_FALLBACK_RANGE = 0.5; // share of maxRange leapt when there is no usable aim point
// Extra seconds a pounce may stay in the air past its planned flight, for landing lower down, before it gives up.
const POUNCE_GRACE_SECONDS = 1;

// Everything the sim needs to know about one mech. Plain numbers so it can be copied or sent.
export interface MechState {
  x: number; y: number; z: number; // y is the feet
  vx: number; vz: number; vy: number;
  bodyYaw: number;
  grounded: boolean;
  running: boolean;
  jetting: boolean;
  mech: number; // which roster mech this is (data/roster.json). The caller steps it with that mech's stats.
  fuelScale: number; // tank size from upgrades, 1 for the standard tank. Set by the server from the loadout.
  speedScale: number; // walk and run speed from upgrades, 1 for standard legs. Set by the server from the loadout.
  crawling: boolean; // legs broken: slow, no sprint or dash, jets still work. Set by the server from hit points.
  dashTime: number; // seconds of dash left, above 0 while dashing
  dashCooldown: number;
  dashX: number; dashZ: number; // dash direction, unit length
  abilityTime: number; // seconds of ram charge or mortar brace left, or above 0 while a pounce is in the air
  abilityCooldown: number; // seconds until the ability can be used again
  abilityX: number; abilityZ: number; // direction of the ram, leap, strike or decoys, unit length
  dropPhase: number; // the drop-in at the start of a match (drop.ts): 0 down, 1 hanging, 2 ball, 3 braking
  dropTime: number; // seconds of landing stun left: no moving, jets, dash or ability
  pinTime: number; // seconds left pinned by a full charge spike. Set by the server on the hit
  pinSpeed: number; // share of walk and run speed kept while pinned
  fuel: Meter;
  stamina: Meter;
}

export function createMechState(stats: MechStats, x: number, y: number, z: number, yaw: number, mech = 0): MechState {
  return {
    x, y, z, vx: 0, vz: 0, vy: 0, bodyYaw: yaw, mech,
    grounded: false, running: false, jetting: false, fuelScale: 1, speedScale: 1, crawling: false, dashTime: 0, dashCooldown: 0, dashX: 0, dashZ: 0,
    abilityTime: 0, abilityCooldown: 0, abilityX: 0, abilityZ: 0, dropPhase: 0, dropTime: 0, pinTime: 0, pinSpeed: 1,
    fuel: new Meter(stats.fuelMax), stamina: new Meter(stats.staminaMax),
  };
}

export function moveTowardsAngle(current: number, target: number, maxDelta: number): number {
  const twoPi = Math.PI * 2;
  const diff = ((((target - current + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
  if (Math.abs(diff) <= maxDelta) return current + diff;
  return current + Math.sign(diff) * maxDelta;
}

// One fixed step of the mech. Weight comes from acceleration and the slow body turn, not slow top speed.
// Same code runs on the client now and the server at M2, so prediction matches.
// `ability` is this mech's Q ability, or null for a mech without one.
export function stepMech(s: MechState, input: MechInput, stats: MechStats, dt: number, world: World, ability: AbilityStats | null = null): void {
  s.fuel.setMax(stats.fuelMax * s.fuelScale);
  s.stamina.setMax(stats.staminaMax);
  if (dropping(s)) {
    stepDrop(s, input, stats, dt, world);
    return;
  }
  // Just landed from the drop: the impact holds the mech still for a moment.
  const stunned = s.dropTime > 0;
  // Ends with under half a step left, as the ram does: the time crosses the wire as a float32, and an exact count to
  // zero would end a step later on the client than on the server.
  if (stunned) s.dropTime = s.dropTime - dt < dt * 0.5 ? 0 : s.dropTime - dt;
  const pinned = s.pinTime > 0;
  if (pinned) s.pinTime = s.pinTime - dt < dt * 0.5 ? 0 : s.pinTime - dt;

  // 0 means the body always faces where you look. Above 0 it swings round at that many degrees a second, which feels heavier.
  s.bodyYaw = stats.turnSpeedDegrees > 0 ? moveTowardsAngle(s.bodyYaw, input.aimYaw, stats.turnSpeedDegrees * DEG * dt) : input.aimYaw;

  // Movement is relative to where the camera looks, not where the body faces.
  const yaw = input.aimYaw;
  const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  const moveX = stunned ? 0 : input.moveX, moveY = stunned ? 0 : input.moveY;
  let wishX = rightX * moveX + forwardX * moveY;
  let wishZ = rightZ * moveX + forwardZ * moveY;
  const wishLength2 = wishX * wishX + wishZ * wishZ;
  if (wishLength2 > 1) {
    const inv = 1 / Math.sqrt(wishLength2);
    wishX *= inv;
    wishZ *= inv;
  }
  const moving = wishLength2 > 1e-4;

  s.running = input.run && moving && s.stamina.canUse && !s.crawling;
  if (s.running) s.stamina.drain(stats.runDrainPerSecond * dt, stats.staminaRegenDelay);
  else s.stamina.regen(stats.staminaRegenPerSecond, dt, stats.staminaUnlockFraction);

  // Only a mech on solid footing can start one: no rams in mid air, no leaps off broken legs.
  if (!ability) s.abilityTime = 0;
  s.abilityCooldown = Math.max(0, s.abilityCooldown - dt);
  // The server spots a start by the cooldown going up, so every kind sets it here.
  if (ability && input.ability && !stunned && s.abilityCooldown <= 0 && s.abilityTime <= 0 && s.grounded && !s.crawling) {
    s.abilityCooldown = ability.cooldownSeconds;
    if (ability.kind === "pounce") {
      s.dashTime = 0;
      launchPounce(s, input, ability, stats, forwardX, forwardZ);
    } else {
      s.abilityX = forwardX;
      s.abilityZ = forwardZ;
      // Decoys leave the Arbiter's own movement alone, so a dash carries on through them: dash and decoy is the escape.
      if (ability.kind !== "decoy") s.dashTime = 0;
      if (ability.kind === "ram") s.abilityTime = ability.activeSeconds;
      else if (ability.kind === "barrage") s.abilityTime = ability.braceSeconds;
      else if (ability.kind === "rail") s.abilityTime = ability.chargeSeconds;
    }
  }
  const ramming = s.abilityTime > 0 && ability?.kind === "ram";
  const pouncing = s.abilityTime > 0 && ability?.kind === "pounce";
  // A mortar call and a Rail Shot charge both plant the feet: no walking, jets or dash until it is over.
  const bracing = s.abilityTime > 0 && (ability?.kind === "barrage" || ability?.kind === "rail");

  // A dash goes the way you are steering, in any of the eight directions, or straight ahead if you are standing still.
  s.dashCooldown = Math.max(0, s.dashCooldown - dt);
  if (input.dash && !stunned && !s.crawling && s.abilityTime <= 0 && s.dashCooldown <= 0 && s.dashTime <= 0 && s.stamina.canUse && s.stamina.value >= stats.dashStaminaCost) {
    let dirX = forwardX, dirZ = forwardZ;
    const length = Math.hypot(wishX, wishZ);
    if (length > 1e-4) {
      dirX = wishX / length;
      dirZ = wishZ / length;
    }
    s.dashX = dirX;
    s.dashZ = dirZ;
    s.dashTime = stats.dashSeconds;
    s.dashCooldown = stats.dashCooldown;
    s.stamina.drain(stats.dashStaminaCost, stats.staminaRegenDelay);
  }

  if (ramming) {
    s.vx = s.abilityX * ability.speed;
    s.vz = s.abilityZ * ability.speed;
    s.abilityTime -= dt;
    // Ends with under half a step left rather than at exactly zero: a charge that is a whole number of steps long
    // otherwise ends a step early or late depending on how the snapshot rounded the time left, and the client and
    // server part by a step of charge (about 40 cm).
    if (s.abilityTime < dt * 0.5) {
      s.abilityTime = 0;
      capToRunSpeed(s, stats);
    }
  } else if (pouncing) {
    // The leap keeps the speed it was launched with: no steering off it in the air.
  } else if (bracing) {
    // Feet planted while the strike is called in: a stopped target for a moment is the price of the shells.
    s.vx = 0;
    s.vz = 0;
    s.abilityTime -= dt;
    // The same half-step end as the ram, for the same snapshot rounding reason.
    if (s.abilityTime < dt * 0.5) s.abilityTime = 0;
  } else if (s.dashTime > 0) {
    s.vx = s.dashX * stats.dashSpeed;
    s.vz = s.dashZ * stats.dashSpeed;
    s.dashTime -= dt;
    // Dash over: bleed the extra speed off so the mech slides out of it instead of keeping a 38 m/s run.
    if (s.dashTime <= 0) capToRunSpeed(s, stats);
  } else {
    // A pin slows the legs only: a dash or the jets still get you out, which is the escape.
    const legs = (s.crawling ? stats.walkSpeed * stats.crawlSpeedMultiplier : s.running ? stats.runSpeed : stats.walkSpeed) * s.speedScale * (pinned ? s.pinSpeed : 1);
    const topSpeed = world.terrain?.wading(s.x, s.y, s.z) ? legs * stats.waterSpeedMultiplier : legs;
    const rate = (moving ? stats.acceleration : stats.deceleration) * (s.grounded ? 1 : stats.airControl);
    const toX = wishX * topSpeed - s.vx;
    const toZ = wishZ * topSpeed - s.vz;
    const toLength = Math.hypot(toX, toZ);
    const maxChange = rate * dt;
    if (toLength <= maxChange) {
      s.vx = wishX * topSpeed;
      s.vz = wishZ * topSpeed;
    } else {
      s.vx += (toX / toLength) * maxChange;
      s.vz += (toZ / toLength) * maxChange;
    }
  }

  s.jetting = input.jet && !stunned && s.fuel.canUse && !pouncing && !bracing;
  if (s.jetting) {
    s.fuel.drain(stats.fuelDrainPerSecond * dt, stats.fuelRegenDelay);
    s.vy = Math.min(s.vy + stats.jetLift * dt, stats.jetMaxRiseSpeed);
  } else {
    s.fuel.regen(stats.fuelRegenPerSecond, dt, stats.fuelUnlockFraction);
    s.vy = s.grounded && s.vy < 0 ? STICK_TO_GROUND : Math.max(s.vy - stats.gravity * dt, -stats.maxFallSpeed);
  }

  const wasGrounded = s.grounded;
  s.grounded = false;
  moveHorizontal(s, stats, s.vx * dt, 0, world);
  moveHorizontal(s, stats, 0, s.vz * dt, world);
  moveVertical(s, stats, s.vy * dt, world);
  standOnTerrain(s, world, wasGrounded);

  if (ramming && s.abilityTime > 0 && Math.hypot(s.vx, s.vz) < ability.speed * RAM_BLOCKED_FRACTION) {
    s.abilityTime = 0;
    capToRunSpeed(s, stats);
  }
  // The launch step always ends in the air (it moved up), so being grounded here means the leap has landed.
  if (pouncing) {
    s.abilityTime -= dt;
    if (s.grounded || s.abilityTime < dt * 0.5) s.abilityTime = 0;
  }
}

// A step of the drop-in: drop.ts sets the speed, the usual collision moves the mech, and touching down ends it.
function stepDrop(s: MechState, input: MechInput, stats: MechStats, dt: number, world: World): void {
  s.bodyYaw = input.aimYaw;
  s.running = false;
  s.jetting = s.dropPhase === DROP_BURNING;
  steerDrop(s, input, stats, dt, world.terrain?.heightAt(s.x, s.z) ?? 0);
  // Hanging through the countdown: nothing moves it, so nothing needs colliding.
  if (s.dropPhase === DROP_HANGING) return;
  s.grounded = false;
  const before = s.y;
  moveHorizontal(s, stats, s.vx * dt, 0, world);
  moveHorizontal(s, stats, 0, s.vz * dt, world);
  // Sliding into a low wall top steps the mech up onto it: that is touching down, or it would step up and fall
  // back every step and hang on the edge forever.
  if (s.y > before) s.grounded = true;
  else moveVertical(s, stats, s.vy * dt, world);
  standOnTerrain(s, world, false);
  // A ball steered at the horizon stays over the map: the edge wall is only so tall, and the drop starts far above it.
  const terrain = world.terrain;
  if (terrain) {
    const edge = terrain.meters / 2 - stats.halfWidth;
    s.x = Math.min(edge, Math.max(-edge, s.x));
    s.z = Math.min(edge, Math.max(-edge, s.z));
  }
  if (s.grounded) landDrop(s, stats);
  // Kept at float32, as the snapshot sends them: the burn starts at a height threshold, and a client replaying from
  // rounded numbers would otherwise cross it a step apart from the server and brake differently.
  s.x = Math.fround(s.x); s.y = Math.fround(s.y); s.z = Math.fround(s.z);
  s.vx = Math.fround(s.vx); s.vy = Math.fround(s.vy); s.vz = Math.fround(s.vz);
}

function capToRunSpeed(s: MechState, stats: MechStats): void {
  const speed = Math.hypot(s.vx, s.vz), top = stats.runSpeed * s.speedScale;
  if (speed > top) {
    s.vx *= top / speed;
    s.vz *= top / speed;
  }
}

// A ballistic leap that comes down on the aim point: the launch speed up is fixed, so the flight time is too, and
// the sideways speed is whatever covers the distance in that time, up to the pounce's top speed.
function launchPounce(s: MechState, input: MechInput, p: PounceStats, stats: MechStats, forwardX: number, forwardZ: number): void {
  const toX = input.targetX - s.x, toZ = input.targetZ - s.z;
  let distance = Math.hypot(toX, toZ);
  if (Number.isFinite(distance) && distance >= POUNCE_MIN_TARGET) {
    s.abilityX = toX / distance;
    s.abilityZ = toZ / distance;
    distance = Math.min(distance, p.maxRange);
  } else {
    s.abilityX = forwardX;
    s.abilityZ = forwardZ;
    distance = p.maxRange * POUNCE_FALLBACK_RANGE;
  }
  const flightTime = (2 * p.lift) / stats.gravity;
  const speed = Math.min(distance / flightTime, p.speed);
  s.vx = s.abilityX * speed;
  s.vz = s.abilityZ * speed;
  s.vy = p.lift;
  s.abilityTime = flightTime + POUNCE_GRACE_SECONDS;
}

// The hills: never below the ground, and a mech walking downhill stays on it rather than skipping off each step.
// Slopes are capped at walking steepness when the map is made, so the ground never blocks sideways movement.
function standOnTerrain(s: MechState, world: World, wasGrounded: boolean): void {
  const terrain = world.terrain;
  if (!terrain) return;
  const ground = terrain.heightAt(s.x, s.z);
  if (s.y < ground) {
    s.y = ground;
    if (s.vy < 0) s.vy = 0;
    s.grounded = true;
  } else if (!s.grounded && wasGrounded && s.vy <= 0 && !s.jetting && s.y - ground <= terrain.snapMeters) {
    s.y = ground;
    s.grounded = true;
  }
}

// Touching is not overlapping. Without a little room for rounding, a mech pushed flush against a wall can read
// as a hair inside it, and the vertical step then lifts it onto the top of the wall.
const TOUCH = 1e-4;

function overlaps(s: MechState, stats: MechStats, b: Box): boolean {
  return (
    s.x - stats.halfWidth < b.maxX - TOUCH && s.x + stats.halfWidth > b.minX + TOUCH &&
    s.y < b.maxY - TOUCH && s.y + stats.height > b.minY + TOUCH &&
    s.z - stats.halfWidth < b.maxZ - TOUCH && s.z + stats.halfWidth > b.minZ + TOUCH
  );
}

// A step that went into a box started at most TOUCH inside it, a little more once a snapshot has rounded the position
// to float32, so it can be no deeper in than it moved plus this.
const ENTERED_SLOP = 2 * TOUCH;

// A mech deeper in a box than its own step took it did not go in on that step: rounding left it a hair inside (the
// snapshot sends float32, so a mech the server has flush against a wall can arrive just over the touch margin), or a
// shove put it there. Pushing it back along the step would carry it out through the box's far side, 14 m along a long
// wall for a sliver 2 micrometres deep, and on the server it would not happen, so the client is snapped back that far.
// It leaves through the nearest face instead, which for a sliver is no move at all.
function pushOutNearest(s: MechState, stats: MechStats, b: Box): void {
  const toMinX = s.x + stats.halfWidth - b.minX, toMaxX = b.maxX - (s.x - stats.halfWidth);
  const toMinZ = s.z + stats.halfWidth - b.minZ, toMaxZ = b.maxZ - (s.z - stats.halfWidth);
  const toTop = b.maxY - s.y, toBottom = s.y + stats.height - b.minY;
  const least = Math.min(toMinX, toMaxX, toMinZ, toMaxZ, toTop, toBottom);
  if (least === toMinX) { s.x = b.minX - stats.halfWidth; if (s.vx > 0) s.vx = 0; }
  else if (least === toMaxX) { s.x = b.maxX + stats.halfWidth; if (s.vx < 0) s.vx = 0; }
  else if (least === toMinZ) { s.z = b.minZ - stats.halfWidth; if (s.vz > 0) s.vz = 0; }
  else if (least === toMaxZ) { s.z = b.maxZ + stats.halfWidth; if (s.vz < 0) s.vz = 0; }
  else if (least === toTop) { s.y = b.maxY; s.grounded = true; if (s.vy < 0) s.vy = 0; }
  else { s.y = b.minY - stats.height; if (s.vy > 0) s.vy = 0; }
}

// Reused for every query so the sim allocates nothing per step.
const nearby: number[] = [];

function nearbyBoxes(s: MechState, stats: MechStats, world: World): number {
  return world.query(s.x - stats.halfWidth, s.z - stats.halfWidth, s.x + stats.halfWidth, s.z + stats.halfWidth, nearby);
}

function moveHorizontal(s: MechState, stats: MechStats, dx: number, dz: number, world: World): void {
  if (dx === 0 && dz === 0) return;
  const fromX = s.x, fromY = s.y, fromZ = s.z;
  s.x += dx;
  s.z += dz;
  resolveBoxes(s, stats, dx, dz, world);
  // An island's sea is a wall at the wading limit, at any height, so no walk, dash, ram, leap or jet gets out over it.
  // The step that would cross it is undone (on this axis only, so a mech slides along the shore), the same way here
  // and in the server, so prediction stops on the same spot.
  const terrain = world.terrain;
  if (terrain && !terrain.mayMove(fromX, fromZ, s.x, s.z)) {
    s.x = fromX; s.y = fromY; s.z = fromZ;
    if (dx !== 0) s.vx = 0;
    else s.vz = 0;
  }
}

function resolveBoxes(s: MechState, stats: MechStats, dx: number, dz: number, world: World): void {
  const wasOnGround = s.vy <= 0;
  const count = nearbyBoxes(s, stats, world);
  for (let i = 0; i < count; i++) {
    const b = world.boxes[nearby[i]!]!;
    if (!overlaps(s, stats, b)) continue;

    // Low ledges and stairs are walked up, not bumped into.
    const rise = b.maxY - s.y;
    if (wasOnGround && rise > 0 && rise <= stats.stepHeight) {
      s.y = b.maxY;
      continue;
    }
    const into = dx > 0 ? s.x + stats.halfWidth - b.minX : dx < 0 ? b.maxX - (s.x - stats.halfWidth) : dz > 0 ? s.z + stats.halfWidth - b.minZ : b.maxZ - (s.z - stats.halfWidth);
    if (into > Math.abs(dx + dz) + ENTERED_SLOP) { pushOutNearest(s, stats, b); continue; }
    if (dx > 0) { s.x = b.minX - stats.halfWidth; s.vx = 0; }
    else if (dx < 0) { s.x = b.maxX + stats.halfWidth; s.vx = 0; }
    else if (dz > 0) { s.z = b.minZ - stats.halfWidth; s.vz = 0; }
    else { s.z = b.maxZ + stats.halfWidth; s.vz = 0; }
  }
}

function moveVertical(s: MechState, stats: MechStats, dy: number, world: World): void {
  s.y += dy;
  const count = nearbyBoxes(s, stats, world);
  for (let i = 0; i < count; i++) {
    const b = world.boxes[nearby[i]!]!;
    if (!overlaps(s, stats, b)) continue;
    const into = dy <= 0 ? b.maxY - s.y : s.y + stats.height - b.minY;
    if (into > Math.abs(dy) + ENTERED_SLOP) { pushOutNearest(s, stats, b); continue; }
    if (dy <= 0) {
      s.y = b.maxY;
      s.grounded = true;
    } else {
      s.y = b.minY - stats.height;
    }
    s.vy = 0;
  }
}
