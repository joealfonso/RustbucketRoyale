import { createRayHit, type World } from "@rustbucket/shared";

// Where the kill replay's camera sits: behind and over the killer's shoulder, turned to look at you, so the clip shows
// what they saw as they took you down (gate 13b, data/replay.json camera).
export interface ReplayCameraConfig {
  pivotHeightMeters: number; // the point over the killer the camera hangs from, as the game camera's pivot does
  backMeters: number;
  upMeters: number; // above the pivot
  shoulderMeters: number; // to the right, so the killer stands off to one side instead of blocking you
  lookHeightMeters: number; // the point on you it looks at, above your feet
  closeMeters: number; // nearer than this the line to you turns too fast, so it faces the killer's own way instead
  wallMarginMeters: number;
  sharpness: number; // how quickly it follows each second, so a killer circling you does not whip the view round
}

export interface CameraPose {
  x: number; y: number; z: number; // the lens
  pivotX: number; pivotY: number; pivotZ: number; // over the killer, for the wall check
  lookX: number; lookY: number; lookZ: number;
}

export function createCameraPose(): CameraPose {
  return { x: 0, y: 0, z: 0, pivotX: 0, pivotY: 0, pivotZ: 0, lookX: 0, lookY: 0, lookZ: 0 };
}

// The wanted pose for one moment. `killerYaw` uses the models' convention: yaw 0 faces -z, yaw PI faces +z.
export function replayCameraPose(
  kx: number, ky: number, kz: number, killerYaw: number,
  vx: number, vy: number, vz: number,
  c: ReplayCameraConfig, out: CameraPose,
): void {
  let fx = vx - kx, fz = vz - kz;
  const flat = Math.hypot(fx, fz);
  if (flat < c.closeMeters) { fx = -Math.sin(killerYaw); fz = -Math.cos(killerYaw); }
  else { fx /= flat; fz /= flat; }
  // Right of facing (fx, fz) on the ground: facing -z, right is +x.
  const rx = -fz, rz = fx;
  out.pivotX = kx; out.pivotY = ky + c.pivotHeightMeters; out.pivotZ = kz;
  out.x = out.pivotX - fx * c.backMeters + rx * c.shoulderMeters;
  out.y = out.pivotY + c.upMeters;
  out.z = out.pivotZ - fz * c.backMeters + rz * c.shoulderMeters;
  out.lookX = vx; out.lookY = vy + c.lookHeightMeters; out.lookZ = vz;
}

const hit = createRayHit();

// Brings the lens in front of any wall between it and the pivot, as the game camera does, so the replay never looks
// out from inside a box.
export function keepOutOfWalls(pose: CameraPose, world: Pick<World, "raycast">, margin: number): void {
  const dx = pose.x - pose.pivotX, dy = pose.y - pose.pivotY, dz = pose.z - pose.pivotZ;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return;
  if (!world.raycast(pose.pivotX, pose.pivotY, pose.pivotZ, dx / length, dy / length, dz / length, length, hit)) return;
  const keep = Math.max(0, hit.distance - margin) / length;
  pose.x = pose.pivotX + dx * keep;
  pose.y = pose.pivotY + dy * keep;
  pose.z = pose.pivotZ + dz * keep;
}

// Eases a smoothed pose toward the wanted one. `share` is how much of the gap to close this frame.
export function followPose(current: CameraPose, wanted: CameraPose, share: number): void {
  current.x += (wanted.x - current.x) * share;
  current.y += (wanted.y - current.y) * share;
  current.z += (wanted.z - current.z) * share;
  current.lookX += (wanted.lookX - current.lookX) * share;
  current.lookY += (wanted.lookY - current.lookY) * share;
  current.lookZ += (wanted.lookZ - current.lookZ) * share;
  current.pivotX = wanted.pivotX; current.pivotY = wanted.pivotY; current.pivotZ = wanted.pivotZ;
}
