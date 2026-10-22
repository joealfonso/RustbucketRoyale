// The tuning for the near ground cover (data/dressing.json, "cover"), checked on load.

export const COVER_KINDS = ["grass", "weeds", "fern", "rubble", "scrap"] as const;
export type CoverKind = (typeof COVER_KINDS)[number];

// The kinds of ground the cover tells apart, each with its own mix of kinds.
export const COVER_GROUNDS = ["open", "slope", "trees", "shore", "pad"] as const;
export type CoverGround = (typeof COVER_GROUNDS)[number];

export interface CoverConfig {
  radiusMeters: number; // cover is drawn this far from the mech you are looking at
  fadeMeters: number; // over the last stretch of the radius it shrinks into the ground
  cellMeters: number; // placed per square cell of this size, each from its own seed
  recheckMeters: number; // the view must move this far before the instances are rewritten
  triesPerCell: number; // spots tried per cell where the ground is at its lushest
  patchMeters: number; // the size of lush and bare patches, so the cover is uneven on purpose
  patchEdge: number[]; // the patch noise is bare below the first value and full above the second: a clear edge, not a fade
  patchFloor: number; // how much of the full density bare ground keeps (0 to 1), a stray clump or two
  pathMeters: number; // the size of the noise whose middle line is a bare path winding through the grass
  pathWidth: number; // how far either side of that line (in noise units, 0 to 0.5) stays bare
  pileMeters: number; // the size of the noise that gathers junk round buildings into piles
  pileEdge: number[]; // like patchEdge, for the piles: no junk below the first value, full above the second
  clearMeters: number; // kept between cover and any box footprint
  padMeters: number; // the level hard ground round a building: rubble and junk, no plants
  padDensity: number; // the share of tries kept on a pad or under a roof
  shoreMeters: number; // ground less than this above the water grows reeds
  slopeAbove: number; // rise per metre past which the ground counts as a slope
  treeMeters: number; // ground this close to a tree trunk is woodland floor
  maxPerKind: number; // instances one kind may draw; the farthest are dropped past this
  dryTint: number[]; // the colour a dry clump is multiplied by, red, green, blue
  grass: GrassLook; // the grass clump model, coverShapes.ts
  kinds: Record<CoverKind, { scale: number[] }>; // each kind's size range, a share of its model's size
  mixes: Record<CoverGround, Record<CoverKind, number>>; // weights per kind on each kind of ground
}

// A grass clump (V16a): a few broad blades in one green close to the ground's, so a field reads as soft tufts, not
// static. Each blade darkens toward its root so the clump sits in the ground.
export interface GrassLook {
  blades: number; // blades per clump
  width: number[]; // blade width at the base, metres at scale 1, least and most
  height: number[]; // blade height, metres at scale 1, least and most
  spread: number; // how far from the clump's middle a blade's foot may stand, metres at scale 1
  lean: number[]; // how far a blade leans out, radians, least and most
  skyward: number; // how far the blades' normals bend toward straight up (0 to 1), so they light like the ground
  rootShade: number; // brightness at the foot of a blade
  tipShade: number; // brightness at `rootMeters` up and above
  rootMeters: number; // the height over which a blade goes from rootShade to tipShade, metres at scale 1
}

const isRange = (v: unknown) => Array.isArray(v) && v.length === 2 && v[0] > 0 && v[1] >= v[0];

export function parseCover(raw: unknown): CoverConfig {
  const c = raw as CoverConfig;
  const fail = (what: string) => { throw new Error(`dressing.json: cover.${what}`); };
  if (!c || typeof c !== "object") fail("is missing");
  for (const key of ["radiusMeters", "fadeMeters", "cellMeters", "recheckMeters", "triesPerCell", "patchMeters", "patchFloor", "pathMeters",
    "pathWidth", "pileMeters", "clearMeters",
    "padMeters", "padDensity", "shoreMeters", "slopeAbove", "treeMeters", "maxPerKind"] as const) {
    if (typeof c[key] !== "number" || !(c[key] >= 0)) fail(`${key} must be a number, 0 or more`);
  }
  if (!(c.fadeMeters < c.radiusMeters)) fail("fadeMeters must be less than radiusMeters");
  if (!(c.cellMeters > 0) || !(c.recheckMeters > 0)) fail("cellMeters and recheckMeters must be above 0");
  if (c.patchFloor > 1 || c.padDensity > 1) fail("patchFloor and padDensity are shares, 0 to 1");
  if (!(c.patchMeters > 0) || !(c.pathMeters > 0) || !(c.pileMeters > 0)) fail("patchMeters, pathMeters and pileMeters must be above 0");
  if (c.pathWidth >= 0.5) fail("pathWidth is in noise units, under 0.5");
  for (const key of ["patchEdge", "pileEdge"] as const) {
    const e = c[key];
    if (!Array.isArray(e) || e.length !== 2 || !(e[0]! >= 0) || !(e[1]! > e[0]!) || e[1]! > 1) fail(`${key} must be [low, high], 0 to 1, low under high`);
  }
  if (!Array.isArray(c.dryTint) || c.dryTint.length !== 3) fail("dryTint must be [r, g, b]");
  const g = c.grass;
  if (!g || !Number.isInteger(g.blades) || g.blades < 1 || !isRange(g.width) || !isRange(g.height) || !isRange(g.lean) || !(g.spread >= 0)) {
    fail("grass needs whole blades of 1 or more, width, height and lean as [low, high] above 0, and spread 0 or more");
  }
  if (!(g.skyward >= 0 && g.skyward <= 1) || !(g.rootShade > 0 && g.rootShade <= g.tipShade) || !(g.rootMeters > 0)) {
    fail("grass needs skyward 0 to 1, rootShade above 0 and at most tipShade, and rootMeters above 0");
  }
  for (const kind of COVER_KINDS) {
    const s = c.kinds?.[kind]?.scale;
    if (!Array.isArray(s) || s.length !== 2 || !(s[0]! > 0) || !(s[1]! >= s[0]!)) fail(`kinds.${kind}.scale must be [low, high]`);
  }
  for (const ground of COVER_GROUNDS) {
    const mix = c.mixes?.[ground];
    if (!mix) fail(`mixes.${ground} is missing`);
    let total = 0;
    for (const kind of COVER_KINDS) {
      if (typeof mix[kind] !== "number" || mix[kind] < 0) fail(`mixes.${ground}.${kind} must be a number, 0 or more`);
      total += mix[kind];
    }
    if (!(total > 0)) fail(`mixes.${ground} needs some weight`);
  }
  return c;
}
