import type { MechInput } from "./MechInput";
import { Meter } from "./Meter";
import type { MechStats } from "./stats";
import type { Box, World } from "./world";

const DEG = Math.PI / 180;
// A small constant push into the floor keeps the mech reporting grounded while it stands still.
const STICK_TO_GROUND = -2;

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
  crawling: boolean; // legs broken: slow, no sprint or dash, jets still work. Set by the server from hit points.
  dashTime: number; // seconds of dash left, above 0 while dashing
  dashCooldown: number;
  dashX: number; dashZ: number; // dash direction, unit length
  fuel: Meter;
  stamina: Meter;
}

export function createMechState(stats: MechStats, x: number, y: number, z: number, yaw: number, mech = 0): MechState {
  return {
    x, y, z, vx: 0, vz: 0, vy: 0, bodyYaw: yaw, mech,
    grounded: false, running: false, jetting: false, fuelScale: 1, crawling: false, dashTime: 0, dashCooldown: 0, dashX: 0, dashZ: 0,
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
export function stepMech(s: MechState, input: MechInput, stats: MechStats, dt: number, world: World): void {
  s.fuel.setMax(stats.fuelMax * s.fuelScale);
  s.stamina.setMax(stats.staminaMax);

  // 0 means the body always faces where you look. Above 0 it swings round at that many degrees a second, which feels heavier.
  s.bodyYaw = stats.turnSpeedDegrees > 0 ? moveTowardsAngle(s.bodyYaw, input.aimYaw, stats.turnSpeedDegrees * DEG * dt) : input.aimYaw;

  // Movement is relative to where the camera looks, not where the body faces.
  const yaw = input.aimYaw;
  const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  let wishX = rightX * input.moveX + forwardX * input.moveY;
  let wishZ = rightZ * input.moveX + forwardZ * input.moveY;
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

  // A dash goes the way you are steering, in any of the eight directions, or straight ahead if you are standing still.
  s.dashCooldown = Math.max(0, s.dashCooldown - dt);
  if (input.dash && !s.crawling && s.dashCooldown <= 0 && s.dashTime <= 0 && s.stamina.canUse && s.stamina.value >= stats.dashStaminaCost) {
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

  if (s.dashTime > 0) {
    s.vx = s.dashX * stats.dashSpeed;
    s.vz = s.dashZ * stats.dashSpeed;
    s.dashTime -= dt;
    if (s.dashTime <= 0) {
      // Dash over: bleed the extra speed off so the mech slides out of it instead of keeping a 38 m/s run.
      const speed = Math.hypot(s.vx, s.vz);
      if (speed > stats.runSpeed) {
        s.vx *= stats.runSpeed / speed;
        s.vz *= stats.runSpeed / speed;
      }
    }
  } else {
    const topSpeed = s.crawling ? stats.walkSpeed * stats.crawlSpeedMultiplier : s.running ? stats.runSpeed : stats.walkSpeed;
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

  s.jetting = input.jet && s.fuel.canUse;
  if (s.jetting) {
    s.fuel.drain(stats.fuelDrainPerSecond * dt, stats.fuelRegenDelay);
    s.vy = Math.min(s.vy + stats.jetLift * dt, stats.jetMaxRiseSpeed);
  } else {
    s.fuel.regen(stats.fuelRegenPerSecond, dt, stats.fuelUnlockFraction);
    s.vy = s.grounded && s.vy < 0 ? STICK_TO_GROUND : Math.max(s.vy - stats.gravity * dt, -stats.maxFallSpeed);
  }

  s.grounded = false;
  moveHorizontal(s, stats, s.vx * dt, 0, world);
  moveHorizontal(s, stats, 0, s.vz * dt, world);
  moveVertical(s, stats, s.vy * dt, world);
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

// Reused for every query so the sim allocates nothing per step.
const nearby: number[] = [];

function nearbyBoxes(s: MechState, stats: MechStats, world: World): number {
  return world.query(s.x - stats.halfWidth, s.z - stats.halfWidth, s.x + stats.halfWidth, s.z + stats.halfWidth, nearby);
}

function moveHorizontal(s: MechState, stats: MechStats, dx: number, dz: number, world: World): void {
  if (dx === 0 && dz === 0) return;
  s.x += dx;
  s.z += dz;
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
    if (dy <= 0) {
      s.y = b.maxY;
      s.grounded = true;
    } else {
      s.y = b.minY - stats.height;
    }
    s.vy = 0;
  }
}
