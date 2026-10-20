// The painted detail on top of the toon colours (data/paint.json, gate V7b): what the generated atlas holds and how
// strongly each kind of surface shows it. Colours are palette names or hex, like everywhere else in the look.

export const LAYERS = ["metal", "concrete", "wood", "ground"] as const;
export type LayerName = (typeof LAYERS)[number];

export const SURFACES = ["metal", "mech", "concrete", "wood"] as const;
export type SurfaceKind = (typeof SURFACES)[number];

// How one kind of surface wears its layer. `shade`, `rust`, `grime` and `bare` are how strongly each mark shows
// (0 hides it). `topRust` scales the rust on faces that look up, where streaks make no sense. `edgeMeters` is how far
// paint chips in from a box's own edges (only for boxes drawn from the unit box, see paintChunk.ts); 0 for none.
export interface SurfaceLook {
  layer: LayerName;
  metersPerTile: number;
  shade: number;
  rust: number;
  grime: number;
  bare: number;
  bareColor: string;
  topRust: number;
  edgeMeters: number;
}

export interface PaintLook {
  seed: number;
  tileSize: number; // pixels per side of each layer, a power of two
  anisotropy: number;
  colors: { rust: string; rustDark: string; grime: string; tape: string };
  // The share of tiles that keep their strip of tape: one on every tile would show the repeat.
  tapeShare: number;
  // The marks are at full strength nearer than `startMeters` and gone past `endMeters`, so they never shimmer far off.
  fade: { startMeters: number; endMeters: number };
  surfaces: Record<SurfaceKind, SurfaceLook>;
  // The ground detail, read twice at two sizes and turns so its tile never shows as a grid.
  ground: {
    metersPerTile: number;
    secondScale: number;
    secondTurnDegrees: number;
    fade: { startMeters: number; endMeters: number };
    grit: number;
    grass: number;
    cracks: number;
    // Grass blades only on ground this green (its green over its red and over its blue), cracks only on the rest.
    grassTest: { greenOverRed: number; greenOverBlue: number };
  };
  // How much of each mark the generator paints into each layer. Positions and sizes are in tile widths.
  metal: { brushStrokes: number; plateColumns: number; plateRows: number; rivetSpacing: number; rivetRadius: number; seamWidth: number; streaks: number; chips: number };
  concrete: { brushStrokes: number; pourLifts: number; boardJoints: number; cracks: number; streaks: number; chips: number };
  wood: { planks: number; grainStrokes: number; knots: number; streaks: number; chips: number };
  groundTile: { grit: number; pebbles: number; stones: number; tufts: number; cracks: number };
  // Which kind of surface each breakable prop model's pieces are (keyed by prop id, then by a piece's paint).
  props: Record<string, { default: SurfaceKind; paints: Record<string, SurfaceKind> }>;
}

const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
const isShare = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;

export function parsePaintLook(raw: unknown): PaintLook {
  const p = raw as PaintLook;
  if (!p?.surfaces || !p.ground || !p.colors || !p.fade || !p.metal || !p.concrete || !p.wood || !p.groundTile) {
    throw new Error("paint.json: needs colors, fade, surfaces, ground, metal, concrete, wood and groundTile");
  }
  if (!Number.isInteger(p.seed)) throw new Error("paint.json: seed must be a whole number");
  if (!(Number.isInteger(p.tileSize) && p.tileSize >= 64 && p.tileSize <= 2048 && (p.tileSize & (p.tileSize - 1)) === 0)) {
    throw new Error("paint.json: tileSize must be a power of two from 64 to 2048");
  }
  if (!isShare(p.tapeShare)) throw new Error("paint.json: tapeShare must be between 0 and 1");
  for (const fade of [p.fade, p.ground.fade]) {
    if (!(fade.startMeters >= 0 && fade.endMeters > fade.startMeters)) throw new Error("paint.json: a fade must end after it starts");
  }
  for (const kind of SURFACES) {
    const s = p.surfaces[kind];
    if (!s) throw new Error(`paint.json: surfaces needs ${kind}`);
    if (!LAYERS.includes(s.layer) || s.layer === "ground") throw new Error(`paint.json: ${kind} names layer ${s.layer}, not metal, concrete or wood`);
    if (!(s.metersPerTile > 0 && s.edgeMeters >= 0)) throw new Error(`paint.json: ${kind} needs metersPerTile above 0 and edgeMeters 0 or more`);
    for (const k of ["shade", "rust", "grime", "bare", "topRust"] as const) if (!isShare(s[k])) throw new Error(`paint.json: ${kind} ${k} must be between 0 and 1`);
  }
  const g = p.ground;
  if (!(g.metersPerTile > 0 && g.secondScale > 0)) throw new Error("paint.json: ground metersPerTile and secondScale above 0");
  for (const k of ["grit", "grass", "cracks"] as const) if (!isShare(g[k])) throw new Error(`paint.json: ground ${k} must be between 0 and 1`);
  for (const [name, counts] of Object.entries({ metal: p.metal, concrete: p.concrete, wood: p.wood, groundTile: p.groundTile })) {
    for (const [k, v] of Object.entries(counts)) {
      const whole = !["rivetSpacing", "rivetRadius", "seamWidth"].includes(k);
      if (whole ? !isCount(v) : !(typeof v === "number" && v > 0 && v < 0.25)) throw new Error(`paint.json: ${name} ${k} is out of range`);
    }
  }
  if (!p.props) throw new Error("paint.json: needs props");
  for (const [id, prop] of Object.entries(p.props)) {
    for (const kind of [prop.default, ...Object.values(prop.paints ?? {})]) {
      if (!SURFACES.includes(kind)) throw new Error(`paint.json: props ${id} names surface ${kind}, not one of ${SURFACES.join(", ")}`);
    }
  }
  if (p.metal.plateColumns < 1 || p.metal.plateRows < 1 || p.concrete.pourLifts < 1 || p.wood.planks < 1) throw new Error("paint.json: plates, lifts and planks need at least one");
  return p;
}

// The kind of surface one piece of a prop model is. A prop not in the table is scrap metal, like most of the yard.
export function propSurface(look: PaintLook, propId: string, paint: string): SurfaceKind {
  const prop = look.props[propId];
  return prop ? (prop.paints[paint] ?? prop.default) : "metal";
}
