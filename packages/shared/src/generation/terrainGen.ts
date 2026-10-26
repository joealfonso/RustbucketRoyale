import type { TerrainSettings } from "../terrain";
import { SeededRng, deriveSeed } from "./SeededRng";

// Builds a map's hills from its seed, in whole centimetres with integer math only, so every machine gets the same
// ground. Three steps:
//  1. Rolling noise: a few octaves of smoothly blended random heights on a coarse lattice.
//  2. Level pads: ground under and around anything built is held at its chunk's pad height, and the pads of
//     neighbouring chunks are pulled close enough that the ground between them can ease from one to the other.
//  3. Aprons: everything else is squeezed between "no steeper than the apron slope up from any pad" and "no steeper
//     down", which keeps the pads exact and eases the hills into them instead of cutting cliffs. The noise (and an
//     island's shore) can be steeper than the slope cap where its bumps line up, so it is first cut down to the cap;
//     then nothing anywhere is steeper than the cap. The map's outer edge is a pad at height 0, so the edge wall and
//     the junkyard beyond it stand on level ground.

export const ONE = 4096; // fixed point 1 for blend weights
const FAR = 1 << 30;

// Corners per side for a map.
export const cornersFor = (meters: number, cell: number) => Math.round(meters / cell) + 1;

// Step 1: the rolling hills before anything is built, in centimetres.
export function noiseHeights(seed: number, tier: string, meters: number, settings: TerrainSettings): Int32Array {
  const n = cornersFor(meters, settings.cellMeters);
  const out = new Int32Array(n * n);
  const octaves = settings.tiers[tier]?.octaves ?? [];
  octaves.forEach((o, k) => {
    const layer = valueNoise(new SeededRng(deriveSeed(seed, 1000 + k)), n, o.spacingMeters / settings.cellMeters, Math.round(o.amplitudeMeters * 100));
    for (let i = 0; i < out.length; i++) out[i]! += layer[i]!;
  });
  return out;
}

// Smooth random values on an n by n grid: random whole numbers from -amp to amp every `spacing` points, blended
// in between. The hills are a few of these added up; forests and boulder fields use one each as a mask.
export function valueNoise(rng: SeededRng, n: number, spacing: number, amp: number): Int32Array {
  const out = new Int32Array(n * n);
  const lattice = Math.floor((n - 1) / spacing) + 2;
  const values = new Int32Array(lattice * lattice);
  for (let i = 0; i < values.length; i++) values[i] = rng.nextInt(2 * amp + 1) - amp;
  for (let j = 0; j < n; j++) {
    const lj = Math.floor(j / spacing), wz = smooth(j - lj * spacing, spacing);
    for (let i = 0; i < n; i++) {
      const li = Math.floor(i / spacing), wx = smooth(i - li * spacing, spacing);
      const a = values[lj * lattice + li]!, b = values[lj * lattice + li + 1]!;
      const c = values[(lj + 1) * lattice + li]!, d = values[(lj + 1) * lattice + li + 1]!;
      const top = a * (ONE - wx) + b * wx, bottom = c * (ONE - wx) + d * wx;
      out[j * n + i] = Math.floor((top * (ONE - wz) + bottom * wz) / (ONE * ONE));
    }
  }
  return out;
}

// Smoothstep of step/steps, in fixed point: 0 to ONE, easing in and out, so lattice cells blend without creases.
export function smooth(step: number, steps: number): number {
  const t = Math.floor((step * ONE) / steps);
  return Math.floor((t * t * (3 * ONE - 2 * t)) / (ONE * ONE));
}

// The most the ground may rise or fall over `meters`, in centimetres. An integer percentage, not an angle: tan() is
// not promised to give the same last bit in every browser, and a map must be the same everywhere.
export function riseOver(meters: number, settings: TerrainSettings): number {
  return Math.floor(meters * settings.maxRisePercent);
}

// A level area: ground inside it is held at its chunk's pad height. Metres, already widened by the pad margin.
export interface Rect {
  minX: number; minZ: number; maxX: number; maxZ: number;
}

// Shortest distance between two rectangles, 0 when they touch or overlap.
function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX), dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  return Math.sqrt(dx * dx + dz * dz);
}

// Step 2: each built chunk's pad height. It starts from the hills at the chunk's middle, then is bounded so the
// ground between any two neighbouring pads, and between a pad and the map's edge (held at 0), can ease from one to
// the other at the gentle apron slope across the real gap between them. Wide gaps allow big height changes, so the
// hills still roll; buildings packed close together share a level. `held` lists each chunk's level areas (empty for
// an unbuilt chunk). `edgeGap` measures a level area's distance to that 0 edge: by default the map's edge, on an
// island the waterline, so no pad stands so high near the shore that its apron runs off a cliff into the sea.
// Returns centimetres per chunk.
export function padHeights(noise: Int32Array, meters: number, chunkSize: number, held: readonly Rect[][], settings: TerrainSettings, edgeGap?: (r: Rect) => number): Int32Array {
  const n = cornersFor(meters, settings.cellMeters);
  const chunks = meters / chunkSize;
  const perChunk = chunkSize / settings.cellMeters;
  const half = meters / 2;
  const count = chunks * chunks;
  const pads = new Int32Array(count);
  const built = (c: number) => held[c]!.length > 0;
  for (let z = 0; z < chunks; z++) for (let x = 0; x < chunks; x++) {
    const ci = Math.min(n - 1, x * perChunk + Math.floor(perChunk / 2)), cj = Math.min(n - 1, z * perChunk + Math.floor(perChunk / 2));
    pads[z * chunks + x] = noise[cj * n + ci]!;
  }
  const rise = (gap: number) => Math.floor(gap * settings.apronRisePercent);
  // How much each chunk's pad may differ from the edge, and from each built neighbour.
  const fromEdge = new Int32Array(count);
  const neighbours: number[][] = [];
  for (let z = 0; z < chunks; z++) for (let x = 0; x < chunks; x++) {
    const a = z * chunks + x;
    let gapToEdge = Infinity;
    for (const r of held[a]!) gapToEdge = Math.min(gapToEdge, edgeGap ? edgeGap(r) : Math.min(r.minX + half, half - r.maxX, r.minZ + half, half - r.maxZ));
    fromEdge[a] = Number.isFinite(gapToEdge) ? rise(Math.max(0, gapToEdge)) : FAR;
    const list: number[] = [];
    if (built(a)) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if ((dx === 0 && dz === 0) || nx < 0 || nz < 0 || nx >= chunks || nz >= chunks) continue;
        const b = nz * chunks + nx;
        if (!built(b)) continue;
        let gap = Infinity;
        for (const ra of held[a]!) for (const rb of held[b]!) gap = Math.min(gap, gapBetween(ra, rb));
        list.push(b, rise(gap));
      }
    }
    neighbours.push(list);
  }
  // Highest each pad may be (from its own hill, its neighbours and the edge), and lowest (from the edge through its
  // neighbours). Each moves by at most the allowed rise between neighbours, so the larger of the two does too.
  const upper = new Int32Array(count), lower = new Int32Array(count);
  for (let a = 0; a < count; a++) { upper[a] = Math.min(pads[a]!, fromEdge[a]!); lower[a] = -fromEdge[a]!; }
  for (let pass = 0; pass < count; pass++) {
    let changed = false;
    for (let a = 0; a < count; a++) {
      const list = neighbours[a]!;
      for (let k = 0; k < list.length; k += 2) {
        const b = list[k]!, step = list[k + 1]!;
        if (upper[a]! > upper[b]! + step) { upper[a] = upper[b]! + step; changed = true; }
        if (lower[a]! < lower[b]! - step) { lower[a] = lower[b]! - step; changed = true; }
      }
    }
    if (!changed) break;
  }
  for (let a = 0; a < count; a++) pads[a] = Math.max(upper[a]!, lower[a]!);
  return pads;
}

// The water level for a map, in centimetres: the height under which `share` of the corners lie. Null when the share
// is 0. Sorting whole numbers gives the same order on every machine.
export function waterLevelFor(heights: Int32Array, share: number): number | null {
  if (!(share > 0)) return null;
  const sorted = Int32Array.from(heights).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;
}

// Raises the lowest ground to a shallow bed under the water, so it is never deeper than `maxDepth` cm. Raising
// everything below one height to that height cannot make any slope steeper. With `reach` (an island), only the corners
// a mech can reach (reach 0 or more) are raised: the sea past the wading limit keeps its depth.
export function floodBed(heights: Int32Array, level: number, maxDepth: number, reach: Int32Array | null = null): void {
  const bed = level - maxDepth;
  for (let k = 0; k < heights.length; k++) if (heights[k]! < bed && (!reach || reach[k]! >= 0)) heights[k] = bed;
}

// One level area: corners inside the rectangle (metres, already widened by the pad margin) are held at `height` cm.
export interface Pad {
  minX: number; minZ: number; maxX: number; maxZ: number;
  height: number;
}

// Step 3: the final ground. Pads (and the map's edge, at 0) are kept exactly; the noise fills the rest, squeezed so
// nothing is steeper than the slope limit. An island has no wall to stand level, so its edge is not held
// (`holdEdge` false): the shore shaping has already put it on the seabed.
export function shapeTerrain(noise: Int32Array, meters: number, pads: readonly Pad[], settings: TerrainSettings, holdEdge = true): Int32Array {
  const n = cornersFor(meters, settings.cellMeters);
  const cell = settings.cellMeters;
  const half = meters / 2;
  const fixed = new Uint8Array(n * n);
  const value = new Int32Array(n * n);
  const hold = (i: number, j: number, h: number) => {
    const k = j * n + i;
    // Where two pads overlap, the lower wins: a box buried a little is better than one floating.
    value[k] = fixed[k] ? Math.min(value[k]!, h) : h;
    fixed[k] = 1;
  };
  for (const p of pads) {
    const i0 = Math.max(0, Math.ceil((p.minX + half) / cell)), i1 = Math.min(n - 1, Math.floor((p.maxX + half) / cell));
    const j0 = Math.max(0, Math.ceil((p.minZ + half) / cell)), j1 = Math.min(n - 1, Math.floor((p.maxZ + half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) hold(i, j, p.height);
  }
  // A held edge is always 0, even where a pad's margin reaches it: it lies outside every building, and the edge wall
  // and the junkyard beyond stand on it.
  if (holdEdge) for (let i = 0; i < n; i++) for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) { value[k] = 0; fixed[k] = 1; }

  // The free ground, cut down wherever it rises faster than the slope cap from any corner near it. Lowering, not
  // raising, so a steep hillside loses its top rather than burying the foot of it.
  const ground = Int32Array.from(noise);
  const capStraight = Math.floor(cell * settings.maxRisePercent), capDiagonal = Math.floor(cell * Math.SQRT2 * settings.maxRisePercent);
  chamferSweeps(n, (k, from, diagonal) => {
    const rise = diagonal ? capDiagonal : capStraight;
    if (ground[from]! + rise < ground[k]!) ground[k] = ground[from]! + rise;
  });

  // Upper and lower bounds: from every held corner, the highest and lowest the ground may be at each other corner.
  const straight = Math.floor(cell * settings.apronRisePercent), diagonal = Math.floor(cell * Math.SQRT2 * settings.apronRisePercent);
  const upper = new Int32Array(n * n).fill(FAR), lower = new Int32Array(n * n).fill(-FAR);
  for (let k = 0; k < n * n; k++) if (fixed[k]) { upper[k] = value[k]!; lower[k] = value[k]!; }
  chamferSweeps(n, (k, from, isDiagonal) => {
    const rise = isDiagonal ? diagonal : straight;
    if (upper[from]! + rise < upper[k]!) upper[k] = upper[from]! + rise;
    if (lower[from]! - rise > lower[k]!) lower[k] = lower[from]! - rise;
  });

  const out = new Int32Array(n * n);
  for (let k = 0; k < n * n; k++) out[k] = fixed[k] ? value[k]! : Math.min(upper[k]!, Math.max(lower[k]!, ground[k]!));
  return out;
}

// Two sweeps of a 3x3 chamfer (straight and diagonal steps) over an n by n grid, forward then back, which carry a
// slope limit from every corner to every other. `visit` pulls corner k into line with its neighbour `from`.
function chamferSweeps(n: number, visit: (k: number, from: number, diagonal: boolean) => void): void {
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (i > 0) visit(k, k - 1, false);
    if (j > 0) visit(k, k - n, false);
    if (i > 0 && j > 0) visit(k, k - n - 1, true);
    if (i < n - 1 && j > 0) visit(k, k - n + 1, true);
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = j * n + i;
    if (i < n - 1) visit(k, k + 1, false);
    if (j < n - 1) visit(k, k + n, false);
    if (i < n - 1 && j < n - 1) visit(k, k + n + 1, true);
    if (i > 0 && j < n - 1) visit(k, k + n - 1, true);
  }
}
