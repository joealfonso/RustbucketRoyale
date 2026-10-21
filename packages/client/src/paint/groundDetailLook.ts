// The `ground` and `groundTile` blocks of data/paint.json: how the close-range ground detail is painted into its atlas
// layer (groundTile.ts) and how the ground shader reads it (groundDetail.ts). Kept apart from paintLook.ts so the ground
// can change without touching the metal, concrete and wood settings.

export interface GroundDetailLook {
  // Size of one tile on the ground. The tile is read twice: once at this size, once `secondScale` times it and turned
  // `secondTurnDegrees`, so the two grids never line up. A second read a few times larger turns the pebbles and tufts
  // into stones and clumps big enough to read out to the fade, where the first read's marks are under a pixel.
  metersPerTile: number;
  secondScale: number;
  secondTurnDegrees: number;
  // Full strength nearer than `startMeters`, gone past `endMeters`.
  fade: { startMeters: number; endMeters: number };
  // How strongly each kind of detail shows, 0 hides it.
  strength: { grass: number; dirt: number; rock: number };
  // The detail crosses each grass, dirt or rock patch edge in a ragged band `meters` wide (the patch colours stay hard
  // edged). `softness` is how soft the ragged edge inside that band is, in blend-noise units: small is crisp.
  blend: { meters: number; softness: number };
  // Every tile cell gets its own turn and shift; within `band` (a share of a cell) of a cell edge it blends into a
  // second grid half a cell over, so no seam or repeat shows.
  tiling: { band: number };
}

// How much of each mark the generator paints, positions and sizes in tile widths (see groundTile.ts).
export interface GroundTileLook {
  grit: number;
  pebbles: number;
  stones: number;
  cracks: number;
  soilSpecks: number;
  grassPebbles: number;
  tufts: number;
  rockFacets: number;
  fissures: number;
  rockSpecks: number;
  // The blend noise's two octaves, in noise cells across the tile.
  blendCoarseCells: number;
  blendFineCells: number;
}

const isShare = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;

export function parseGroundDetailLook(raw: unknown): GroundDetailLook {
  const g = raw as GroundDetailLook;
  if (!g?.fade || !g.strength || !g.blend || !g.tiling) throw new Error("paint.json: ground needs fade, strength, blend and tiling");
  if (!(g.metersPerTile > 0 && g.secondScale > 0 && typeof g.secondTurnDegrees === "number")) throw new Error("paint.json: ground metersPerTile and secondScale above 0, secondTurnDegrees a number");
  if (!(g.fade.startMeters >= 0 && g.fade.endMeters > g.fade.startMeters)) throw new Error("paint.json: ground fade must end after it starts");
  for (const k of ["grass", "dirt", "rock"] as const) if (!isShare(g.strength[k])) throw new Error(`paint.json: ground strength ${k} must be between 0 and 1`);
  if (!(g.blend.meters > 0 && g.blend.softness > 0 && g.blend.softness < 0.25)) throw new Error("paint.json: ground blend meters above 0, softness above 0 and below 0.25");
  if (!(g.tiling.band > 0 && g.tiling.band <= 0.5)) throw new Error("paint.json: ground tiling band above 0, at most 0.5 (half a cell)");
  return g;
}

export function parseGroundTileLook(raw: unknown): GroundTileLook {
  const t = raw as GroundTileLook;
  if (!t) throw new Error("paint.json: needs groundTile");
  const keys = ["grit", "pebbles", "stones", "cracks", "soilSpecks", "grassPebbles", "tufts", "rockFacets", "fissures", "rockSpecks", "blendCoarseCells", "blendFineCells"] as const;
  for (const k of keys) if (!(Number.isInteger(t[k]) && t[k] >= 0)) throw new Error(`paint.json: groundTile ${k} must be a whole number, 0 or more`);
  if (!(t.blendCoarseCells >= 1 && t.blendFineCells > t.blendCoarseCells)) throw new Error("paint.json: groundTile blendFineCells must be more than blendCoarseCells, at least 1");
  return t;
}
