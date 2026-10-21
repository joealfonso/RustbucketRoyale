import { DROP_HANGING } from "./drop";
import type { MechState } from "./mechStep";
import { SeededRng } from "./generation/SeededRng";
import type { World } from "./world";

// Where each mech hangs before the drop-in (gate 16c), from the match seed alone, so the server and offline practice
// put everyone in the same places. Spots are spread over the whole map by best-candidate sampling: each new spot is
// the one of `tries` random whole-metre points furthest from every spot before it, which keeps them apart without a
// grid's rows. Each spot uses the same number of draws, so spot i is the same however many are planned: a mech
// joining in the countdown gets the next spot without moving anyone. Distances are compared squared in whole metres,
// so the choice is exact on every machine.

// The `spots` section of data/drop.json.
export interface DropSpotStats {
  edgeMeters: number; // spots stay this far inside the map's edge
  tries: number; // random points tried for each spot; more spreads them more evenly
}

const SALT = 0x2d70; // so the spots do not repeat the first numbers the map itself was made from

export function parseDropSpotStats(raw: unknown): DropSpotStats {
  const spots = raw as Record<string, unknown> | undefined;
  if (!spots || typeof spots !== "object") throw new Error("drop.json: needs spots");
  if (typeof spots.edgeMeters !== "number" || !(spots.edgeMeters >= 0)) throw new Error("drop.json: spots.edgeMeters must be a number, 0 or more");
  if (!Number.isInteger(spots.tries) || (spots.tries as number) < 1) throw new Error("drop.json: spots.tries must be a whole number, 1 or more");
  return spots as unknown as DropSpotStats;
}

export function planDropSpots(seed: number, count: number, world: World, mapMeters: number, stats: DropSpotStats): { x: number; z: number }[] {
  const rng = new SeededRng((seed ^ SALT) >>> 0);
  const inner = Math.max(0, Math.floor(mapMeters / 2 - stats.edgeMeters));
  const spots: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    // Over land first: on an island a spot out at sea would start the drop steering back to shore. With no land
    // point among the tries, the furthest point of any kind will do.
    let bestX = 0, bestZ = 0, best = -1, bestLand = false;
    for (let t = 0; t < stats.tries; t++) {
      const x = rng.nextInt(inner * 2 + 1) - inner, z = rng.nextInt(inner * 2 + 1) - inner;
      const land = overLand(world, x, z);
      if (bestLand && !land) continue;
      let nearest = Number.MAX_SAFE_INTEGER;
      for (const s of spots) nearest = Math.min(nearest, (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z));
      if (nearest > best || (land && !bestLand)) { best = nearest; bestX = x; bestZ = z; bestLand = land; }
    }
    spots.push({ x: bestX, z: bestZ });
  }
  return spots;
}

// Puts a mech at its spot, `altitude` metres above the ground there, hanging still until the match goes live.
export function hangAtSpot(s: MechState, x: number, z: number, world: World, altitude: number): void {
  const ground = world.groundAt(x, z);
  s.x = x; s.z = z;
  s.y = (Number.isFinite(ground) ? ground : 0) + altitude;
  s.vx = 0; s.vy = 0; s.vz = 0;
  s.grounded = false;
  s.dropPhase = DROP_HANGING;
  s.dropTime = 0;
}

function overLand(world: World, x: number, z: number): boolean {
  const terrain = world.terrain;
  return !terrain || (terrain.mayStand(x, z) && terrain.waterDepthAt(x, z) <= 0);
}
