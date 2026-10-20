import type { IslandSettings } from "../terrain";
import { SeededRng, deriveSeed } from "./SeededRng";
import { ONE, cornersFor, smooth } from "./terrainGen";

// The coastline of an island tier, from the map seed, in whole centimetres with integer maths only, so every machine
// draws the same shore. Each terrain corner gets its distance from the waterline (inland positive): a radius that
// wanders with smooth random bays and points as you go round the island, minus how far the corner is from the middle.
//
// The radius depends only on which way the corner lies from the middle, so going straight out from the middle the
// distance only ever falls: the island is one piece, with no lakes and no islets cut off by the sea. The direction is
// read as a position round a square (a ratio of the corner's offsets), not an angle: atan2 is not promised to give
// the same last bit everywhere.

const ISLAND_SALT = 4000; // the coastline draws from its own stream, apart from the hills and props
const SIDE = 2 * ONE; // one side of the square, in perimeter units; the whole way round is 4 sides

const cm = (meters: number) => Math.round(meters * 100);

// Where a corner lies round the middle: 0 up to 8 * ONE, one side of the square every 2 * ONE, starting below the +x
// corner and going towards +z. The middle itself counts as 0.
export function perimeterAt(px: number, pz: number): number {
  const ax = Math.abs(px), az = Math.abs(pz);
  if (ax === 0 && az === 0) return 0;
  let side: number, t: number;
  if (ax >= az) { side = px > 0 ? 0 : 2; t = Math.floor((pz * ONE) / px); }
  else { side = pz > 0 ? 1 : 3; t = Math.floor((-px * ONE) / pz); }
  return (side * SIDE + ONE + t) % (4 * SIDE);
}

// How far the sea must run past the waterline before its bed is all the way down, in centimetres.
export function shelfCm(island: IslandSettings): number {
  const wadeOut = cm(island.wadeOutMeters), wadeDepth = Math.floor((wadeOut * island.beachRisePercent) / 100);
  return wadeOut + Math.ceil(((cm(island.seabedMeters) - wadeDepth) * 100) / island.dropRisePercent);
}

// Each corner's distance from the waterline in centimetres, the same layout as the terrain's heights. The shore is
// also kept far enough in from the map's edge that the whole edge lies on the seabed, so the sea drawn beyond the map
// meets it level.
export function islandCoast(seed: number, meters: number, cell: number, island: IslandSettings): Int32Array {
  const n = cornersFor(meters, cell);
  const half = cm(meters / 2), step = cm(cell);
  const rng = new SeededRng(deriveSeed(seed, ISLAND_SALT));
  const octaves = island.octaves.map((o) => {
    const amp = cm(o.amplitudeMeters), count = 4 * o.perSide;
    const values = new Int32Array(count);
    for (let i = 0; i < count; i++) values[i] = rng.nextInt(2 * amp + 1) - amp;
    return { perSide: o.perSide, values };
  });
  const radius = cm(island.radiusMeters), round = island.roundPercent;
  const inFromEdge = shelfCm(island) + cm(island.openSeaMeters);
  // The furthest out the shore may come before the sea is too narrow, and how gently it is eased in short of that:
  // over as much as the bays and points can add, so a point that would reach too far is rounded off, not cut straight.
  const furthest = half - inFromEdge;
  const ease = Math.max(1, Math.floor(island.octaves.reduce((sum, o) => sum + cm(o.amplitudeMeters), 0) / 2));
  const out = new Int32Array(n * n);
  for (let j = 0; j < n; j++) {
    const pz = j * step - half;
    for (let i = 0; i < n; i++) {
      const px = i * step - half;
      const square = Math.max(Math.abs(px), Math.abs(pz));
      const circle = Math.floor(Math.sqrt(px * px + pz * pz));
      const distance = Math.floor((square * (100 - round) + circle * round) / 100);
      const at = perimeterAt(px, pz);
      let shore = radius;
      for (const o of octaves) {
        // Each octave's bumps are spread evenly round the square, so `perSide` of them fall along each side.
        const pos = at * o.perSide, li = Math.floor(pos / SIDE), w = smooth(pos - li * SIDE, SIDE);
        const a = o.values[li % o.values.length]!, b = o.values[(li + 1) % o.values.length]!;
        shore += Math.floor((a * (ONE - w) + b * w) / ONE);
      }
      // In this direction the sea gets too narrow at `limit` (the same measure as `distance`, so it too is the same
      // all along the line out from the middle, and the island stays one piece).
      const limit = square > 0 ? Math.floor((furthest * distance) / square) : furthest;
      const over = shore - (limit - ease);
      if (over > 0) shore = limit - ease + Math.floor((ease * over) / (ease + over));
      out[j * n + i] = Math.min(shore - distance, half - square - inFromEdge);
    }
  }
  return out;
}

// The ground's height at a corner `coast` cm from the waterline, in centimetres, as the island's shore shapes it: up
// from the water at the beach slope, and out to sea down the same slope to the wading limit, then steeply to the
// seabed. Inland it allows any height (the hills, or flat land at 0).
export function shoreCm(coast: number, island: IslandSettings): number {
  const sea = cm(island.seaLevelMeters), wadeOut = cm(island.wadeOutMeters);
  const wadeDepth = Math.floor((wadeOut * island.beachRisePercent) / 100);
  const beach = sea + Math.floor((coast * island.beachRisePercent) / 100);
  const drop = sea - wadeDepth + Math.floor(((coast + wadeOut) * island.dropRisePercent) / 100);
  return Math.max(sea - cm(island.seabedMeters), Math.min(beach, drop));
}

// Holds the ground at or under the shore's shape, and never below the seabed. With `pastLimitOnly`, only corners
// beyond the wading limit: run again after the hills are shaped round the buildings, it keeps the open sea deep.
export function shapeShore(heights: Int32Array, coast: Int32Array, island: IslandSettings, pastLimitOnly = false): void {
  const limit = -cm(island.wadeOutMeters), seabed = cm(island.seaLevelMeters) - cm(island.seabedMeters);
  for (let k = 0; k < heights.length; k++) {
    const c = coast[k]!;
    if (pastLimitOnly && c >= limit) continue;
    heights[k] = Math.max(seabed, Math.min(heights[k]!, shoreCm(c, island)));
  }
}

// Each corner's reach: how far inside the wading limit it is, in centimetres (0 or more where a mech may go).
export function reachOf(coast: Int32Array, island: IslandSettings): Int32Array {
  const wadeOut = cm(island.wadeOutMeters);
  return coast.map((c) => c + wadeOut);
}

// Whether a rectangle (metres) lies at least `inlandCm` from the waterline: every corner of the cells it touches.
export function onLand(coast: Int32Array, meters: number, cell: number, minX: number, minZ: number, maxX: number, maxZ: number, inlandCm: number): boolean {
  const n = cornersFor(meters, cell), half = meters / 2;
  const i0 = Math.max(0, Math.floor((minX + half) / cell)), i1 = Math.min(n - 1, Math.ceil((maxX + half) / cell));
  const j0 = Math.max(0, Math.floor((minZ + half) / cell)), j1 = Math.min(n - 1, Math.ceil((maxZ + half) / cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (coast[j * n + i]! < inlandCm) return false;
  return true;
}
