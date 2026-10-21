import { DROP_RIDING, shipAt, type ShipPath } from "./drop";
import type { MechState } from "./mechStep";
import { SeededRng } from "./generation/SeededRng";
import { STEP } from "./protocol";
import type { World } from "./world";

// The Rustbucket's line for one match (gate 16b), from the match seed alone, so the server and offline practice pick
// the same line for the same match. It passes through the first ring circle, so the ship always flies over where the
// match is going; it is live from where it crosses into the map (minus edgeMeters) to where it leaves, and it starts
// back far enough that it is just reaching that point when the countdown ends.

// The `ship` section of data/drop.json.
export interface ShipStats {
  speedMeters: Record<string, number>; // per tier, metres a second
  edgeMeters: number; // the ride is over (everyone is thrown out) this far inside the map's edge
  passShare: number; // the line passes this share of the first circle's radius from its centre, or closer
  tries: number; // points tried for one inside the map, and headings for a line that crosses enough of it
  slotMeters: number; // riders stand this far apart round the cannon
  slotsPerRow: number; // riders in a row across the deck
}

const SHIP_KEYS = ["edgeMeters", "passShare", "tries", "slotMeters", "slotsPerRow"] as const;
const SALT = 0x5b1d; // so the line does not repeat the first numbers the map itself was made from
const TWO_PI = Math.PI * 2;
const UNIT = 2 ** 32;

export function parseShipStats(raw: unknown, tiers: readonly string[]): ShipStats {
  const ship = raw as Record<string, unknown> | undefined;
  const speeds = ship?.speedMeters as Record<string, unknown> | undefined;
  if (!speeds || typeof speeds !== "object") throw new Error("drop.json: needs ship.speedMeters");
  for (const tier of tiers) {
    const value = speeds[tier];
    if (typeof value !== "number" || !(value > 0)) throw new Error(`drop.json: ship.speedMeters.${tier} must be a number above 0`);
  }
  for (const key of SHIP_KEYS) {
    const value = ship![key];
    if (typeof value !== "number" || !(value >= 0)) throw new Error(`drop.json: ship.${key} must be a number, 0 or more`);
  }
  if ((ship!.passShare as number) > 1) throw new Error("drop.json: ship.passShare must be from 0 to 1");
  for (const key of ["tries", "slotsPerRow"] as const) {
    if (!Number.isInteger(ship![key]) || (ship![key] as number) < 1) throw new Error(`drop.json: ship.${key} must be a whole number, 1 or more`);
  }
  return ship as unknown as ShipStats;
}

// `altitude` is the tier's drop height (drop.json altitudeMeters), above the ground where the line crosses the circle.
export function planShipPath(
  seed: number, world: World, mapMeters: number, circle: { cx: number; cz: number; radius: number },
  altitude: number, speed: number, ship: ShipStats, countdownSeconds: number,
): ShipPath {
  const rng = new SeededRng((seed ^ SALT) >>> 0);
  const random = () => rng.next32() / UNIT;
  const inner = Math.max(1, mapMeters / 2 - ship.edgeMeters);
  const clamp = (v: number) => Math.max(-inner, Math.min(inner, v));

  // A point inside the first circle and inside the map: a big circle can reach past the edge.
  let px = clamp(circle.cx), pz = clamp(circle.cz);
  for (let i = 0; i < ship.tries; i++) {
    const angle = random() * TWO_PI, distance = Math.sqrt(random()) * ship.passShare * circle.radius;
    const x = circle.cx + Math.cos(angle) * distance, z = circle.cz + Math.sin(angle) * distance;
    if (Math.abs(x) <= inner && Math.abs(z) <= inner) { px = x; pz = z; break; }
  }

  // A heading through it. Near a corner most headings only clip the map, so it takes the first that crosses at least
  // a side's length of it, or else the longest it tried.
  let best = -1, dx = 1, dz = 0, from = 0, to = 0;
  for (let i = 0; i < ship.tries && best < inner * 2; i++) {
    const heading = random() * TWO_PI;
    const hx = Math.sin(heading), hz = Math.cos(heading);
    const [a, b] = crossing(px, pz, hx, hz, inner);
    if (b - a > best) { best = b - a; dx = hx; dz = hz; from = a; to = b; }
  }

  // Through the countdown it flies in from outside the map, reaching the live part of the line as the match starts.
  // The extra step is the countdown's first tick, on which the riders already move. The tick count is worked out
  // exactly as the room works out its countdown, so the two agree.
  const lead = (Math.ceil(countdownSeconds / STEP) + 1) * STEP;
  const ground = world.groundAt(px, pz);
  return {
    x0: px + dx * (from - speed * lead), z0: pz + dz * (from - speed * lead),
    x1: px + dx * to, z1: pz + dz * to,
    y: (Number.isFinite(ground) ? ground : 0) + altitude,
    speed,
    startAt: -lead,
  };
}

// Where rider number `slot` stands at a match-clock second: rows across the deck, alternating in front of and behind
// the cannon, so riders are near it and not all on one point.
export function riderSlot(path: ShipPath, seconds: number, slot: number, ship: ShipStats, out: { x: number; z: number }): void {
  shipAt(path, seconds, out);
  const length = Math.hypot(path.x1 - path.x0, path.z1 - path.z0) || 1;
  const fx = (path.x1 - path.x0) / length, fz = (path.z1 - path.z0) / length;
  const index = Math.max(0, Math.floor(slot));
  const row = Math.floor(index / ship.slotsPerRow), column = index % ship.slotsPerRow;
  const side = (column - (ship.slotsPerRow - 1) / 2) * ship.slotMeters;
  const along = (row % 2 === 0 ? -1 : 1) * Math.ceil(row / 2) * ship.slotMeters;
  // (fz, -fx) is square to the heading; the rows are symmetric, so which side it points to does not matter.
  out.x += fx * along + fz * side;
  out.z += fz * along - fx * side;
}

// Puts a mech aboard: at its slot, moving with the ship. Its speed is rounded to what a snapshot carries, so the
// owner's prediction of the ride is exact.
export function boardShip(s: MechState, path: ShipPath, seconds: number, slot: number, ship: ShipStats): void {
  riderSlot(path, seconds, slot, ship, s);
  const length = Math.hypot(path.x1 - path.x0, path.z1 - path.z0) || 1;
  s.y = path.y;
  s.vx = Math.fround((path.speed * (path.x1 - path.x0)) / length);
  s.vz = Math.fround((path.speed * (path.z1 - path.z0)) / length);
  s.vy = 0;
  s.grounded = false;
  s.dropPhase = DROP_RIDING;
  s.dropTime = 0;
}

// Where a line through (px, pz) heading (hx, hz) is inside the square of half side `inner`, as distances along it.
function crossing(px: number, pz: number, hx: number, hz: number, inner: number): [number, number] {
  let a = -Infinity, b = Infinity;
  for (const [p, h] of [[px, hx], [pz, hz]] as const) {
    if (Math.abs(h) < 1e-9) continue;
    const t1 = (inner - p) / h, t2 = (-inner - p) / h;
    a = Math.max(a, Math.min(t1, t2));
    b = Math.min(b, Math.max(t1, t2));
  }
  return [a, b];
}
