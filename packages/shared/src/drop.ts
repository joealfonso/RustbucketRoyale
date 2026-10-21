import type { MechInput } from "./MechInput";
import type { MechState } from "./mechStep";
import type { MechStats } from "./stats";

// The drop-in at the start of a match (gates 16a, 16c). Every mech starts high above its own spot as a flaming scrap
// ball and hangs there through the countdown. Once live it falls at a fixed speed and steers toward the point under
// the pilot's crosshair (input.targetX, targetZ), so aiming is looking where you want to land. Near the ground the
// ball bursts, the retro-jets brake the fall, and a heavy landing leaves the mech stunned for a moment. No weapons,
// jets, dash or ability until it is down. The same code runs on the client and the server, so a drop is predicted
// like walking.

export const DROP_NONE = 0;
export const DROP_HANGING = 1; // the countdown: held still at the start spot
export const DROP_BALL = 2; // falling and steering toward the crosshair
export const DROP_BURNING = 3; // burst open, retro-jets braking the last stretch

export function dropping(s: MechState): boolean {
  return s.dropPhase !== DROP_NONE;
}

// The match goes live: a hanging mech starts to fall.
export function releaseDrop(s: MechState): void {
  if (s.dropPhase === DROP_HANGING) s.dropPhase = DROP_BALL;
}

// Sets the mech's speed for this step of the drop and moves it from the ball to braking. `groundY` is the ground under it.
export function steerDrop(s: MechState, input: MechInput, stats: MechStats, dt: number, groundY: number): void {
  if (s.dropPhase === DROP_HANGING) {
    s.vx = 0; s.vy = 0; s.vz = 0;
    return;
  }
  if (s.dropPhase === DROP_BALL && s.y - groundY <= stats.burnMeters) s.dropPhase = DROP_BURNING;
  const burning = s.dropPhase === DROP_BURNING;

  // Toward the target, as fast as it can still stop on it: the classic arrival curve, so it settles over the spot
  // rather than circling it. Far spots get the full steer speed and simply are not reached in time.
  const dx = input.targetX - s.x, dz = input.targetZ - s.z;
  const distance = Math.hypot(dx, dz);
  const top = burning ? stats.burnGlide : stats.ballSteer;
  const accel = stats.ballSteerAcceleration;
  const speed = Math.min(top, Math.sqrt(2 * accel * distance));
  const wishX = distance > 1e-6 ? (dx / distance) * speed : 0;
  const wishZ = distance > 1e-6 ? (dz / distance) * speed : 0;
  approach2(s, wishX, wishZ, accel * dt);

  if (burning) {
    // Braking: the fall slows to the landing speed and no slower, so it never hangs in the air.
    s.vy = Math.min(-stats.landingFall, s.vy + stats.burnDeceleration * dt);
  } else {
    // Out of the hang it picks up speed under gravity until the ball's fall speed.
    s.vy = Math.max(-stats.ballFall, s.vy - stats.gravity * dt);
  }
}

// About how long a drop from `height` metres above the ground takes, from the hang to touchdown: speeding up to the
// ball's fall, falling, then the burn. For bots judging their reach and checks judging a late landing.
export function ballFallSeconds(height: number, stats: MechStats): number {
  const f = stats.ballFall, g = stats.gravity;
  const ball = Math.max(0, height - stats.burnMeters);
  const speedingUp = Math.min(ball, (f * f) / (2 * g));
  const fallTime = Math.sqrt((2 * speedingUp) / g) + (ball - speedingUp) / f;
  const braking = Math.max(0, f - stats.landingFall) / stats.burnDeceleration;
  const brakingMeters = Math.min(Math.min(height, stats.burnMeters), ((f + stats.landingFall) / 2) * braking);
  return fallTime + braking + Math.max(0, Math.min(height, stats.burnMeters) - brakingMeters) / stats.landingFall;
}

// Down: the drop is over and the mech is stunned for a moment by the impact.
export function landDrop(s: MechState, stats: MechStats): void {
  s.dropPhase = DROP_NONE;
  s.dropTime = stats.landingStunSeconds;
  s.vx = 0; s.vz = 0;
}

function approach2(s: MechState, tx: number, tz: number, step: number): void {
  const dx = tx - s.vx, dz = tz - s.vz;
  const d = Math.hypot(dx, dz);
  if (d <= step) { s.vx = tx; s.vz = tz; return; }
  s.vx += (dx / d) * step;
  s.vz += (dz / d) * step;
}
