import type { TerrainSettings } from "../terrain";
import { SeededRng, deriveSeed } from "./SeededRng";

// Builds a map's hills from its seed, in whole centimetres with integer math only, so every machine gets the same
// ground. Three steps:
//  1. Rolling noise: a few octaves of smoothly blended random heights on a coarse lattice.
//  2. Level pads: ground under and around anything built is held at its chunk's pad height, and the pads of
//     neighbouring chunks are pulled close enough that the ground between them stays walkable.
//  3. A slope limit: everything else is squeezed between "no steeper than the limit up from any pad" and "no steeper
//     down", which keeps the pads exact and the hills walkable. The map's outer edge is a pad at height 0, so the
//     edge wall and the junkyard beyond it stand on level ground.

const ONE = 4096; // fixed point 1 for blend weights
const FAR = 1 << 30;

// Corners per side for a map.
export const cornersFor = (meters: number, cell: number) => Math.round(meters / cell) + 1;

// Step 1: the rolling hills before anything is built, in centimetres.
export function noiseHeights(seed: number, tier: string, meters: number, settings: TerrainSettings): Int32Array {
  const n = cornersFor(meters, settings.cellMeters);
  const out = new Int32Array(n * n);
  const octaves = settings.tiers[tier]?.octaves ?? [];
  octaves.forEach((o, k) => {
    const rng = new SeededRng(deriveSeed(seed, 1000 + k));
    const spacing = o.spacingMeters / settings.cellMeters; // corners between lattice points
    const amp = Math.round(o.amplitudeMeters * 100);
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
        out[j * n + i]! += Math.floor((top * (ONE - wz) + bottom * wz) / (ONE * ONE));
      }
    }
  });
  return out;
}

// Smoothstep of step/steps, in fixed point: 0 to ONE, easing in and out, so lattice cells blend without creases.
function smooth(step: number, steps: number): number {
  const t = Math.floor((step * ONE) / steps);
  return Math.floor((t * t * (3 * ONE - 2 * t)) / (ONE * ONE));
}

// The most the ground may rise or fall over `meters`, in centimetres. An integer percentage, not an angle: tan() is
// not promised to give the same last bit in every browser, and a map must be the same everywhere.
export function riseOver(meters: number, settings: TerrainSettings): number {
  return Math.floor(meters * settings.maxRisePercent);
}

// Step 2: each built chunk's pad height, from the hills at its middle, then lowered where needed so no two
// neighbouring pads (sides or corners) differ by more than the slope allows across the gap between them. `built`
// marks the chunks with anything on them; the rest get no pad. Returns centimetres per chunk.
export function padHeights(noise: Int32Array, meters: number, chunkSize: number, built: Uint8Array, settings: TerrainSettings): Int32Array {
  const n = cornersFor(meters, settings.cellMeters);
  const chunks = meters / chunkSize;
  const perChunk = chunkSize / settings.cellMeters;
  const pads = new Int32Array(chunks * chunks);
  for (let z = 0; z < chunks; z++) for (let x = 0; x < chunks; x++) {
    const ci = Math.min(n - 1, x * perChunk + Math.floor(perChunk / 2)), cj = Math.min(n - 1, z * perChunk + Math.floor(perChunk / 2));
    pads[z * chunks + x] = noise[cj * n + ci]!;
  }
  const step = riseOver(settings.padGapMeters, settings);
  // The highest each pad may be: no higher than any built neighbour allows (step per chunk apart), and the outer ring
  // no higher than the edge (held at 0) allows. Lowering only, so it settles.
  for (let z = 0; z < chunks; z++) for (let x = 0; x < chunks; x++) {
    if (x === 0 || z === 0 || x === chunks - 1 || z === chunks - 1) pads[z * chunks + x] = Math.min(pads[z * chunks + x]!, step);
  }
  for (let pass = 0; pass < chunks * chunks; pass++) {
    let changed = false;
    for (let z = 0; z < chunks; z++) for (let x = 0; x < chunks; x++) {
      const a = z * chunks + x;
      if (!built[a]) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if ((dx === 0 && dz === 0) || nx < 0 || nz < 0 || nx >= chunks || nz >= chunks) continue;
        const b = nz * chunks + nx;
        if (!built[b]) continue;
        if (pads[a]! > pads[b]! + step) { pads[a] = pads[b]! + step; changed = true; }
      }
    }
    if (!changed) break;
  }
  // And no lower than the edge allows: one step down per chunk in from the outer ring. Both bounds change by at most
  // one step between neighbours, so the larger of them still does.
  for (let z = 0; z < chunks; z++) for (let x = 0; x < chunks; x++) {
    const ring = Math.min(x, z, chunks - 1 - x, chunks - 1 - z);
    pads[z * chunks + x] = Math.max(pads[z * chunks + x]!, -step * (ring + 1));
  }
  return pads;
}

// One level area: corners inside the rectangle (metres, already widened by the pad margin) are held at `height` cm.
export interface Pad {
  minX: number; minZ: number; maxX: number; maxZ: number;
  height: number;
}

// Step 3: the final ground. Pads (and the map's edge, at 0) are kept exactly; the noise fills the rest, squeezed so
// nothing is steeper than the slope limit.
export function shapeTerrain(noise: Int32Array, meters: number, pads: readonly Pad[], settings: TerrainSettings): Int32Array {
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
  // The edge is always 0, even where a pad's margin reaches it: it lies outside every building, and the edge wall
  // and the junkyard beyond stand on it.
  for (let i = 0; i < n; i++) for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) { value[k] = 0; fixed[k] = 1; }

  // Upper and lower bounds: from every held corner, the highest and lowest the ground may be at each other corner.
  // Two sweeps of a 3x3 chamfer (straight and diagonal steps), forward then back, reach every corner.
  const straight = riseOver(cell, settings), diagonal = riseOver(cell * Math.SQRT2, settings);
  const upper = new Int32Array(n * n).fill(FAR), lower = new Int32Array(n * n).fill(-FAR);
  for (let k = 0; k < n * n; k++) if (fixed[k]) { upper[k] = value[k]!; lower[k] = value[k]!; }
  const relax = (k: number, from: number, rise: number) => {
    if (upper[from]! + rise < upper[k]!) upper[k] = upper[from]! + rise;
    if (lower[from]! - rise > lower[k]!) lower[k] = lower[from]! - rise;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (i > 0) relax(k, k - 1, straight);
    if (j > 0) relax(k, k - n, straight);
    if (i > 0 && j > 0) relax(k, k - n - 1, diagonal);
    if (i < n - 1 && j > 0) relax(k, k - n + 1, diagonal);
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = j * n + i;
    if (i < n - 1) relax(k, k + 1, straight);
    if (j < n - 1) relax(k, k + n, straight);
    if (i < n - 1 && j < n - 1) relax(k, k + n + 1, diagonal);
    if (i > 0 && j < n - 1) relax(k, k + n - 1, diagonal);
  }

  const out = new Int32Array(n * n);
  for (let k = 0; k < n * n; k++) out[k] = fixed[k] ? value[k]! : Math.min(upper[k]!, Math.max(lower[k]!, noise[k]!));
  return out;
}
