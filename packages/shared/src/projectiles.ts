import { STEP } from "./protocol";
import type { WeaponStats } from "./stats";

// Shared rules for the rivet gun (gate 18b), so the client draws and predicts what the server does.

// Steps from the trigger pull until the projectile gets `distance` metres: when a rivet sticks.
// At least one, so a point blank hit still lands after the step that fired it.
export function flightSteps(distance: number, weapon: WeaponStats): number {
  return Math.max(1, Math.round(distance / weapon.projectileSpeed / STEP));
}

// A rivet sits this far off the surface it hit.
export const SURFACE_NUDGE = 0.1;

// A point in a mech's own frame (from its feet, turned by its body yaw: the inverse of computeShot's muzzle turn), and
// back. A rivet riding a mech keeps its spot this way.
export function toMechFrame(wx: number, wy: number, wz: number, mx: number, my: number, mz: number, yaw: number, out: { x: number; y: number; z: number }): void {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const rx = wx - mx, rz = wz - mz;
  out.x = cos * rx - sin * rz;
  out.y = wy - my;
  out.z = sin * rx + cos * rz;
}

export function fromMechFrame(lx: number, ly: number, lz: number, mx: number, my: number, mz: number, yaw: number, out: { x: number; y: number; z: number }): void {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  out.x = mx + cos * lx + sin * lz;
  out.y = my + ly;
  out.z = mz - sin * lx + cos * lz;
}
