import type { MechState } from "./mechStep";
import { createRayHit, type World } from "./world";
import type { GrenadeStats } from "./stats";

export interface GrenadeState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  timeLeft: number;
}

export function createGrenade(): GrenadeState {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, timeLeft: 0 };
}

// Lobs a grenade from the mech's barrel toward the aim point, with some lift for an arc.
export function throwGrenade(mech: MechState, targetX: number, targetY: number, targetZ: number, stats: GrenadeStats, out: GrenadeState): void {
  const sin = Math.sin(mech.bodyYaw), cos = Math.cos(mech.bodyYaw);
  out.x = mech.x + cos * 1.2 - sin * 1.4;
  out.y = mech.y + 2.4;
  out.z = mech.z - sin * 1.2 - cos * 1.4;

  let dx = targetX - out.x, dy = targetY - out.y, dz = targetZ - out.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) { dx = -sin; dy = 0; dz = -cos; } else { dx /= length; dy /= length; dz /= length; }
  out.vx = dx * stats.throwSpeed;
  out.vy = dy * stats.throwSpeed + stats.throwLift;
  out.vz = dz * stats.throwSpeed;
  out.timeLeft = stats.fuseSeconds;
}

const hit = createRayHit();

// One step of a grenade: gravity, bounce off boxes, fuse. Returns true on the step it goes off.
// Pure and deterministic, so the client can fly the same arc the server does without being told each frame.
export function stepGrenade(g: GrenadeState, stats: GrenadeStats, dt: number, world: World): boolean {
  g.vy -= stats.gravity * dt;
  const sx = g.vx * dt, sy = g.vy * dt, sz = g.vz * dt;
  const length = Math.hypot(sx, sy, sz);

  if (length > 1e-9 && world.raycast(g.x, g.y, g.z, sx / length, sy / length, sz / length, length + stats.radius, hit)) {
    // Stop one radius short of the surface, then bounce: lose some speed along the normal and some along the surface.
    const travel = Math.max(0, hit.distance - stats.radius);
    g.x += (sx / length) * travel; g.y += (sy / length) * travel; g.z += (sz / length) * travel;

    const vn = g.vx * hit.normalX + g.vy * hit.normalY + g.vz * hit.normalZ;
    if (vn < 0) {
      const tx = g.vx - vn * hit.normalX, ty = g.vy - vn * hit.normalY, tz = g.vz - vn * hit.normalZ;
      const keep = -vn * stats.bounce;
      g.vx = hit.normalX * keep + tx * stats.friction;
      g.vy = hit.normalY * keep + ty * stats.friction;
      g.vz = hit.normalZ * keep + tz * stats.friction;
      // Rolling to a stop instead of jittering forever on the floor.
      if (hit.normalY > 0.7 && Math.abs(g.vy) < 1) { g.vy = 0; g.vx *= 0.9; g.vz *= 0.9; }
    }
  } else {
    g.x += sx; g.y += sy; g.z += sz;
  }

  g.timeLeft -= dt;
  return g.timeLeft <= 0;
}
