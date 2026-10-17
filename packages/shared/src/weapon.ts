import type { MechState } from "./mechStep";
import type { WeaponStats } from "./stats";

// Where the gun barrel sits relative to the mech, in the mech's own frame.
const MUZZLE_RIGHT = 1.2;
const MUZZLE_UP = 2.4;
const MUZZLE_FORWARD = 1.4;

export interface Shot {
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  length: number; // distance to the aim point, used to size the tracer
}

export function createShot(): Shot {
  return { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, length: 0 };
}

// Fire rate limit. Time is the shooter's own step clock, so client and server agree.
export class FireGate {
  private nextShot = 0;

  tryFire(time: number, shotsPerSecond: number): boolean {
    if (time < this.nextShot) return false;
    this.nextShot = time + 1 / shotsPerSecond;
    return true;
  }

  // No firing before `time`, for the moment after changing weapon.
  holdUntil(time: number): void {
    this.nextShot = Math.max(this.nextShot, time);
  }
}

// Works out a shot from the barrel toward the aim point, plus a little random spread.
// GUESS: this is the M2 stand-in for the camera ray versus barrel rule that is open in docs/DECISIONS.md (decide at M3).
export function computeShot(
  mech: MechState, targetX: number, targetY: number, targetZ: number,
  stats: WeaponStats, random: () => number, out: Shot, spreadMultiplier = 1,
): void {
  const sin = Math.sin(mech.bodyYaw), cos = Math.cos(mech.bodyYaw);
  out.ox = mech.x + cos * MUZZLE_RIGHT - sin * MUZZLE_FORWARD;
  out.oy = mech.y + MUZZLE_UP;
  out.oz = mech.z - sin * MUZZLE_RIGHT - cos * MUZZLE_FORWARD;

  let dx = targetX - out.ox, dy = targetY - out.oy, dz = targetZ - out.oz;
  const length = Math.hypot(dx, dy, dz);
  out.length = length;
  if (length < 1e-6) {
    // Aiming at the barrel itself: shoot straight ahead of the body.
    dx = -sin; dy = 0; dz = -cos;
  } else {
    dx /= length; dy /= length; dz /= length;
  }

  const spread = (stats.spreadDegrees * spreadMultiplier * Math.PI) / 180;
  dx += (random() - 0.5) * 2 * spread;
  dy += (random() - 0.5) * 2 * spread;
  dz += (random() - 0.5) * 2 * spread;
  const n = Math.hypot(dx, dy, dz);
  out.dx = dx / n; out.dy = dy / n; out.dz = dz / n;
}
