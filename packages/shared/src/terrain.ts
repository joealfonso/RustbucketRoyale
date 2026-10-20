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
  // `outcropSpacingMeters` packs a tier's outcrops closer than outcrops.spacingMeters: a small yard needs them denser.
  // `island` makes the tier an island in the sea instead of a yard inside the edge wall (generation/islandGen.ts).
  tiers: Record<string, { octaves: { spacingMeters: number; amplitudeMeters: number }[]; waterShare?: number; outcropSpacingMeters?: number; island?: IslandSettings }>;
  // Woods of breakable pines on open ground: a slow random mask (from -1000 to 1000) is wooded where above
  // `maskAbove`; trees stand about `spacingMeters` apart, nudged up to `jitterMeters`. Whole metres throughout.
  forest?: { maskSpacingMeters: number; maskAbove: number; spacingMeters: number; jitterMeters: number; clearOfSpawnMeters: number; clearOfEdgeMeters: number; dryAboveWaterMeters: number };
  // Boulders on open ground, the same way, each a solid box partly sunk into the ground.
  rocks?: { maskSpacingMeters: number; maskAbove: number; spacingMeters: number; jitterMeters: number; minSizeMeters: number; maxSizeMeters: number; buriedShare: number; color: string; clearOfSpawnMeters: number; clearOfEdgeMeters: number; dryAboveWaterMeters: number };
  // Rock outcrops (gate 15a): clusters of `minPieces` to `maxPieces` big stone blocks, each up to `spreadMeters` from
  // the cluster's middle, too tall to see or jet over in a hurry, so a fight has something to walk round. Placed
  // before boulders and woods, on the same mask-and-grid scatter.
  outcrops?: {
    maskSpacingMeters: number; maskAbove: number; spacingMeters: number; jitterMeters: number;
    minPieces: number; maxPieces: number; spreadMeters: number;
    minWidthMeters: number; maxWidthMeters: number; minHeightMeters: number; maxHeightMeters: number; buriedMeters: number;
    color: string; clearOfSpawnMeters: number; clearOfEdgeMeters: number; dryAboveWaterMeters: number;
  };
}

// An island tier: land in the middle, a ragged shore and sea all round, which is the map's limit (no edge wall).
// The shore sits `radiusMeters` from the middle, measured part way between a square and a circle (`roundPercent`:
// 0 a square island, 100 a round one), pushed in and out by smooth random bays and points (`octaves`, each with
// `perSide` bumps along each side of the square). The ground falls from the land (at 0) into the water
// (`seaLevelMeters`) at `beachRisePercent`; mechs may wade `wadeOutMeters` past the waterline and no further. Past
// that line the bed drops away at `dropRisePercent` to `seabedMeters` under the surface, and `openSeaMeters` of that
// deep water lie between it and the map's edge. Buildings, props and spawns stand `buildInlandMeters` from the water.
export interface IslandSettings {
  radiusMeters: number;
  roundPercent: number;
  octaves: { perSide: number; amplitudeMeters: number }[];
  seaLevelMeters: number;
  beachRisePercent: number;
  wadeOutMeters: number;
  dropRisePercent: number;
  seabedMeters: number;
  openSeaMeters: number;
  buildInlandMeters: number;
}

function checkIsland(tier: string, island: IslandSettings, maxRisePercent: number, waterShare: number | undefined): void {
  const where = `terrain.json: ${tier} island`;
  for (const key of ["radiusMeters", "beachRisePercent", "wadeOutMeters", "dropRisePercent", "seabedMeters", "openSeaMeters", "buildInlandMeters"] as const) {
    if (!(typeof island[key] === "number" && island[key] > 0)) throw new Error(`${where}: ${key} must be above 0`);
  }
  if (!(typeof island.seaLevelMeters === "number" && island.seaLevelMeters < 0)) throw new Error(`${where}: seaLevelMeters must be below 0, under the land`);
  if (!(Number.isInteger(island.roundPercent) && island.roundPercent >= 0 && island.roundPercent <= 100)) throw new Error(`${where}: roundPercent must be a whole number from 0 to 100`);
  for (const key of ["beachRisePercent", "dropRisePercent"] as const) {
    if (!Number.isInteger(island[key]) || island[key] > maxRisePercent) throw new Error(`${where}: ${key} must be a whole number no steeper than maxRisePercent`);
  }
  if (!(island.seabedMeters > (island.wadeOutMeters * island.beachRisePercent) / 100)) throw new Error(`${where}: the seabed must be deeper than the water at the wading limit`);
  if (!Array.isArray(island.octaves)) throw new Error(`${where}: needs octaves`);
  for (const o of island.octaves) {
    if (!(Number.isInteger(o.perSide) && o.perSide > 0 && o.amplitudeMeters >= 0)) throw new Error(`${where}: each octave needs a whole perSide above 0 and amplitudeMeters`);
  }
  // The sea is the island's only water; ponds would need a second water level.
  if (waterShare) throw new Error(`terrain.json: ${tier} is an island, so its waterShare must be 0`);
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
  for (const [name, section] of [["forest", d.forest], ["rocks", d.rocks], ["outcrops", d.outcrops]] as const) {
    if (!section) continue;
    for (const [key, value] of Object.entries(section)) {
      if (key === "color" ? typeof value !== "string" : typeof value !== "number" || !Number.isFinite(value)) throw new Error(`terrain.json: ${name}.${key} is not valid`);
    }
    if (section.maskSpacingMeters % d.cellMeters !== 0 || !(section.spacingMeters > 0)) throw new Error(`terrain.json: ${name} spacing must be positive, the mask a whole number of cells`);
  }
  const o = d.outcrops;
  if (o && !(Number.isInteger(o.minPieces) && o.minPieces >= 1 && Number.isInteger(o.maxPieces) && o.maxPieces >= o.minPieces && o.minWidthMeters > 0
    && o.maxWidthMeters >= o.minWidthMeters && o.minHeightMeters > 0 && o.maxHeightMeters >= o.minHeightMeters && o.buriedMeters >= 0 && o.buriedMeters < o.minHeightMeters)) {
    throw new Error("terrain.json: outcrops needs whole minPieces 1 or more up to maxPieces, widths and heights low to high, and buriedMeters under minHeightMeters");
  }
  for (const [tier, t] of Object.entries(d.tiers ?? {})) {
    if (t.waterShare !== undefined && !(t.waterShare >= 0 && t.waterShare < 0.5)) throw new Error(`terrain.json: ${tier} waterShare must be from 0 to under 0.5`);
    if (t.outcropSpacingMeters !== undefined && !(Number.isInteger(t.outcropSpacingMeters) && t.outcropSpacingMeters > 0)) throw new Error(`terrain.json: ${tier} outcropSpacingMeters must be a whole number above 0`);
    if (t.island !== undefined) checkIsland(tier, t.island, d.maxRisePercent, t.waterShare);
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
  // On an island, `coast` holds each corner's distance from the waterline in centimetres (inland positive, out to sea
  // negative, the same layout as `heights`), and mechs keep within `wadeOutCm` of it out to sea. Null elsewhere.
  constructor(
    readonly meters: number, readonly cell: number, readonly heights: Int32Array, readonly snapMeters: number, readonly waterLevelCm: number | null = null, readonly wadeMeters = 0.1,
    readonly coast: Int32Array | null = null, readonly wadeOutCm = 0,
  ) {
    this.corners = Math.round(meters / cell) + 1;
    this.waterLevel = waterLevelCm === null ? -Infinity : waterLevelCm / 100;
    if (heights.length !== this.corners * this.corners) throw new Error("Terrain: heights do not match the size");
    if (coast && coast.length !== heights.length) throw new Error("Terrain: coast does not match the size");
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
    return this.sample(this.heights, x, z) / 100;
  }

  // Whether this is an island in the sea, whose shore is the map's limit.
  get island(): boolean {
    return this.coast !== null;
  }

  // How far (x, z) is inland from the waterline, in metres; negative out to sea. Outside the map, the nearest edge,
  // which is always open sea. Infinity on a map with no shore.
  coastAt(x: number, z: number): number {
    return this.coast ? this.sample(this.coast, x, z) / 100 : Infinity;
  }

  // Whether a mech may stand at (x, z): not past the wading limit out to sea.
  mayStand(x: number, z: number): boolean {
    return !this.coast || this.sample(this.coast, x, z) + this.wadeOutCm >= 0;
  }

  // Whether a mech may move from one spot to another: the sea is a hard limit, but one already past it (put there by
  // the server) may still come back in rather than being stuck.
  mayMove(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    if (!this.coast) return true;
    const to = this.sample(this.coast, toX, toZ);
    return to + this.wadeOutCm >= 0 || to >= this.sample(this.coast, fromX, fromZ);
  }

  // A corner value interpolated at (x, z) over the same two triangles per cell as the ground.
  private sample(field: Int32Array, x: number, z: number): number {
    const n = this.corners - 1;
    let gx = (x + this.meters / 2) / this.cell, gz = (z + this.meters / 2) / this.cell;
    gx = gx < 0 ? 0 : gx > n ? n : gx;
    gz = gz < 0 ? 0 : gz > n ? n : gz;
    let i = Math.floor(gx), j = Math.floor(gz);
    if (i >= n) i = n - 1;
    if (j >= n) j = n - 1;
    const fx = gx - i, fz = gz - j;
    const row = j * this.corners + i;
    const h00 = field[row]!, h10 = field[row + 1]!, h01 = field[row + this.corners]!, h11 = field[row + this.corners + 1]!;
    return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
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
