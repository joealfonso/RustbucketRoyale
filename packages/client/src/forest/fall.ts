import type { FallLook } from "./config";

// The numbers of a tree coming down, apart from drawing it: how far over it ends up, how far over it is at a moment,
// how deep it has sunk when it goes, and how see-through a crown in the way of the camera is. Times are seconds since
// the tree broke; angles are radians from upright.

const toRadians = Math.PI / 180;

// How far over a tree comes to rest: until the crown, lifted `crownLiftMeters` off the ground, meets the ground under
// where the tip lands. `length` is from the pivot to the tip; `drop` is the ground there less the pivot's height
// (negative falling downhill). Clamped, so on a steep slope it neither stands nearly upright nor folds back on itself.
export function restAngle(fall: FallLook, length: number, drop: number): number {
  const lean = Math.acos(Math.max(-1, Math.min(1, (drop + fall.crownLiftMeters) / length)));
  return Math.max(fall.minDegrees * toRadians, Math.min(fall.maxDegrees * toRadians, lean));
}

// Over it goes slowly then faster and faster, the way a tree really falls (the angle grows with time squared), hits,
// bounces up a few degrees and settles.
export function fallAngle(fall: FallLook, rest: number, t: number): number {
  if (t <= 0) return 0;
  if (t < fall.seconds) return rest * (t / fall.seconds) ** 2;
  const after = t - fall.seconds;
  if (after < fall.bounceSeconds) return rest - fall.bounceDegrees * toRadians * Math.sin((Math.PI * after) / fall.bounceSeconds);
  return rest;
}

// When it lies still on the ground, it stays a while, then sinks out of sight: nothing collides with it, so it must
// not lie there for good as a log you walk through.
export function sinkDepth(fall: FallLook, t: number): number {
  const from = fall.seconds + fall.bounceSeconds + fall.lieSeconds;
  if (t <= from) return 0;
  return Math.min(1, (t - from) / fall.sinkSeconds) * fall.sinkMeters;
}

export function fallOver(fall: FallLook, t: number): boolean {
  return t >= fall.seconds + fall.bounceSeconds + fall.lieSeconds + fall.sinkSeconds;
}

// A crown that hides the camera's view of its mech is drawn stippled (see treeView.ts), and one the camera is inside
// is not drawn at all: 1 is solid, `least` the most see-through a crown in the way gets, 0 gone. The crown is taken as
// a cone from `radius` at `bottom` to a point at `top` round the trunk at (x, z). What is tested is the camera (c),
// and the nearest point to the trunk on the line from the camera to what it looks at (f), on the ground plan. It
// fades in over `margin` metres outside the crown.
export function crownFade(
  x: number, z: number, bottom: number, top: number, radius: number,
  cx: number, cy: number, cz: number, fx: number, fy: number, fz: number, margin: number, least: number,
): number {
  const sx = fx - cx, sz = fz - cz;
  const lengthSq = sx * sx + sz * sz;
  const s = lengthSq > 1e-6 ? Math.max(0, Math.min(1, ((x - cx) * sx + (z - cz) * sz) / lengthSq)) : 0;
  const inTheWay = least + (1 - least) * outside(x, z, bottom, top, radius, margin, cx + sx * s, cy + (fy - cy) * s, cz + sz * s);
  return Math.min(inTheWay, outside(x, z, bottom, top, radius, margin, cx, cy, cz));
}

// How far a point is outside the crown cone, as a share of `margin`: 0 inside, 1 a margin or more clear of it.
// Plain arguments rather than a closure, since it runs for every near tree every frame.
function outside(x: number, z: number, bottom: number, top: number, radius: number, margin: number, px: number, py: number, pz: number): number {
  if (py > top || py < bottom - margin) return 1;
  const reach = py <= bottom ? radius : (radius * (top - py)) / (top - bottom);
  return Math.max(0, Math.min(1, (Math.hypot(x - px, z - pz) - reach) / margin));
}
