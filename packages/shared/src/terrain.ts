// The ground of a map: rolling hills as a grid of heights, built from the map seed (generation/terrainGen.ts) so the
// server and every client have exactly the same hills without sending them. Collision, shots, sight lines and the
// drawn mesh all read it from here.
//
// Heights sit on the grid corners, in whole centimetres. Between corners the ground is two flat triangles per cell,
// split along the diagonal from the cell's (+x, -z) corner to its (-x, +z) corner. The drawn mesh must split its quads
// the same way, or feet float or sink where the two disagree.

export interface TerrainSettings {
  cellMeters: number;
  maxRisePercent: number; // the steepest the ground gets: this many metres up per 100 across (57 is about 30 degrees)
  padMarginMeters: number; // ground kept level this far around anything built on it, at least one cell
  apronRisePercent: number; // ground round a level pad eases into it no steeper than this (metres per 100), so no cliffs
  snapMeters: number; // a walking mech stays on the ground when it drops by up to this in one step (downhill)
  // Water fills the lowest ground: `share` of each map's corners (per tier) is under it, and the bed is raised so it
  // is never deeper than maxDepthMeters, so a mech always wades and never goes under.
  water: { maxDepthMeters: number; wadeMeters: number };
  tiers: Record<string, { octaves: { spacingMeters: number; amplitudeMeters: number }[]; waterShare?: number }>;
}

export function parseTerrainSettings(raw: unknown): TerrainSettings {
  const d = raw as TerrainSettings;
  for (const key of ["cellMeters", "maxRisePercent", "padMarginMeters", "apronRisePercent", "snapMeters"] as const) {
    if (typeof d?.[key] !== "number" || !(d[key] > 0)) throw new Error(`terrain.json: ${key} must be a positive number`);
  }
  // A box's edge can fall anywhere in a cell, so the level ground round it must reach that cell's far corner.
  if (d.padMarginMeters < d.cellMeters) throw new Error("terrain.json: padMarginMeters must be at least cellMeters");
  if (!Number.isInteger(d.apronRisePercent) || d.apronRisePercent > d.maxRisePercent) throw new Error("terrain.json: apronRisePercent must be a whole number no steeper than maxRisePercent");
  if (!Number.isInteger(d.maxRisePercent) || d.maxRisePercent > 170) throw new Error("terrain.json: maxRisePercent must be a whole number up to 170");
  if (!(d.water?.maxDepthMeters > 0) || !(d.water.wadeMeters >= 0)) throw new Error("terrain.json: water needs maxDepthMeters above 0 and wadeMeters");
  for (const [tier, t] of Object.entries(d.tiers ?? {})) {
    if (t.waterShare !== undefined && !(t.waterShare >= 0 && t.waterShare < 0.5)) throw new Error(`terrain.json: ${tier} waterShare must be from 0 to under 0.5`);
    for (const o of t.octaves ?? []) {
      if (!(o.spacingMeters > 0) || o.spacingMeters % d.cellMeters !== 0) throw new Error(`terrain.json: ${tier} spacingMeters must be a whole number of cells`);
      if (!(o.amplitudeMeters >= 0)) throw new Error(`terrain.json: ${tier} amplitudeMeters must be 0 or more`);
    }
  }
  return d;
}

export class Terrain {
  // The water surface in metres; -Infinity for a dry map. Everywhere lower than it is under water.
  readonly waterLevel: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly corners: number; // corners per side: cells per side + 1

  // `heights` in centimetres, corners row by row from (-meters/2, -meters/2), +x first.
  // `waterLevelCm` null for a dry map. `wadeMeters`: how far under the surface the feet must be to count as wading.
  constructor(readonly meters: number, readonly cell: number, readonly heights: Int32Array, readonly snapMeters: number, readonly waterLevelCm: number | null = null, readonly wadeMeters = 0.1) {
    this.corners = Math.round(meters / cell) + 1;
    this.waterLevel = waterLevelCm === null ? -Infinity : waterLevelCm / 100;
    if (heights.length !== this.corners * this.corners) throw new Error("Terrain: heights do not match the size");
    let lo = Infinity, hi = -Infinity;
    for (const h of heights) { if (h < lo) lo = h; if (h > hi) hi = h; }
    this.minHeight = lo / 100;
    this.maxHeight = hi / 100;
  }

  // A flat map: every corner at zero.
  static flat(meters: number, cell: number, snapMeters = 0.5): Terrain {
    const n = Math.round(meters / cell) + 1;
    return new Terrain(meters, cell, new Int32Array(n * n), snapMeters);
  }

  // Height in metres of the corner at grid column i, row j.
  corner(i: number, j: number): number {
    return this.heights[j * this.corners + i]! / 100;
  }

  // The ground height under (x, z). Outside the map, the nearest edge.
  heightAt(x: number, z: number): number {
    const n = this.corners - 1;
    let gx = (x + this.meters / 2) / this.cell, gz = (z + this.meters / 2) / this.cell;
    gx = gx < 0 ? 0 : gx > n ? n : gx;
    gz = gz < 0 ? 0 : gz > n ? n : gz;
    let i = Math.floor(gx), j = Math.floor(gz);
    if (i >= n) i = n - 1;
    if (j >= n) j = n - 1;
    const fx = gx - i, fz = gz - j;
    const row = j * this.corners + i;
    const h00 = this.heights[row]!, h10 = this.heights[row + 1]!, h01 = this.heights[row + this.corners]!, h11 = this.heights[row + this.corners + 1]!;
    const cm = fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    return cm / 100;
  }

  // How deep the water is over the ground at (x, z), 0 where it is dry.
  waterDepthAt(x: number, z: number): number {
    return Math.max(0, this.waterLevel - this.heightAt(x, z));
  }

  // Whether something with its feet at height y over (x, z) is wading: standing in water, not flying over it.
  wading(x: number, y: number, z: number): boolean {
    return y < this.waterLevel - this.wadeMeters && this.waterDepthAt(x, z) > this.wadeMeters;
  }

  // The upward surface normal under (x, z), of the triangle there. Writes [x, y, z] into `out`.
  normalAt(x: number, z: number, out: number[]): void {
    const e = this.cell * 0.25;
    const sx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const sz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const length = Math.hypot(sx, 1, sz);
    out[0] = -sx / length; out[1] = 1 / length; out[2] = -sz / length;
  }

  // How far along a ray it first meets the ground, or -1. Direction must be unit length. Marches half a cell at a
  // time and refines the crossing, which is exact to a few millimetres; a ray that stays above the highest hill is
  // turned away at once, so most shots and sight lines cost almost nothing here.
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number): number {
    const top = this.maxHeight;
    if (oy > top && dy >= 0) return -1;
    // Only the stretch of the ray at or under the highest hill can hit.
    let start = 0, end = maxDistance;
    if (dy < 0 && oy > top) start = (oy - top) / -dy;
    if (dy > 0) end = Math.min(end, (top - oy) / dy);
    if (start > end) return -1;
    const above = (t: number) => oy + dy * t - this.heightAt(ox + dx * t, oz + dz * t);
    if (above(start) <= 0) return start;
    const step = this.cell * 0.5;
    let t0 = start;
    for (let t = start + step; ; t += step) {
      const t1 = Math.min(t, end);
      if (above(t1) <= 0) {
        let lo = t0, hi = t1;
        for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (above(mid) > 0) lo = mid; else hi = mid; }
        return hi;
      }
      if (t1 >= end) return -1;
      t0 = t1;
    }
  }
}
