// The look of the woods and how a tree falls, from data/forest.json. Sizes are metres for the 12 m pine in
// data/props.json; each tree is scaled from these by its own height and width.

type Range = [number, number];

export interface Tier {
  bottom: number; // where the tier's widest ring sits, above the foot of the trunk
  height: number; // from that ring to its tip
  radius: number;
}

export interface PineLook {
  trunk: { paint: string; radius: number; topRadius: number; sides: number; sinkMeters: number };
  crown: { sides: number; jag: number; fromMeters: number };
  shapes: { weight: number; tiers: Tier[] }[];
  tierShades: number[]; // brightness of each tier from the bottom, so stacked tiers read apart in one colour
  colors: { paint: string; weight: number }[];
  scale: { height: Range; width: Range };
  far: { beyondMeters: number; hysteresisMeters: number; trunkShade: number };
  stump: { heightMeters: number; cut: string };
  fade: { marginMeters: number; least: number };
}

export interface FallLook {
  seconds: number; // from upright to the ground
  bounceSeconds: number;
  bounceDegrees: number;
  minDegrees: number; // the most and least it tips over from upright, whatever the slope
  maxDegrees: number;
  crownLiftMeters: number; // how far above the ground the crown holds the tip up
  lieSeconds: number;
  sinkSeconds: number;
  sinkMeters: number;
  maxFalling: number;
  hintSeconds: number; // how long a shot or blast counts as what knocked a tree down
  hintShotMeters: number; // how near a shot's line must pass the trunk to count
}

export interface ForestConfig {
  pine: PineLook;
  fall: FallLook;
}

const isRange = (r: unknown): r is Range => Array.isArray(r) && r.length === 2 && typeof r[0] === "number" && typeof r[1] === "number" && r[0] > 0 && r[1] >= r[0];
const positive = (n: unknown) => typeof n === "number" && n > 0;

export function parseForest(raw: unknown): ForestConfig {
  const c = raw as ForestConfig;
  const p = c?.pine;
  if (!p?.trunk || !p.crown || !p.far || !p.stump || !p.fade || !c.fall) throw new Error("forest.json: needs pine (trunk, crown, far, stump, fade) and fall");
  if (!positive(p.trunk.radius) || !positive(p.trunk.topRadius) || !(p.trunk.sides >= 3)) throw new Error("forest.json: pine.trunk needs radius, topRadius and sides");
  if (!(p.crown.sides >= 3) || !(p.crown.jag >= 0 && p.crown.jag < 1)) throw new Error("forest.json: pine.crown needs sides and a jag under 1");
  if (!Array.isArray(p.shapes) || p.shapes.length === 0) throw new Error("forest.json: pine.shapes needs at least one shape");
  for (const s of p.shapes) {
    if (!positive(s.weight) || !Array.isArray(s.tiers) || s.tiers.length === 0) throw new Error("forest.json: each pine shape needs a weight and tiers");
    for (const t of s.tiers) if (!positive(t.height) || !positive(t.radius) || !(t.bottom >= 0)) throw new Error("forest.json: each tier needs bottom, height and radius");
  }
  if (!Array.isArray(p.tierShades) || p.tierShades.length === 0) throw new Error("forest.json: pine.tierShades needs at least one shade");
  if (!Array.isArray(p.colors) || p.colors.length === 0 || p.colors.some((v) => typeof v.paint !== "string" || !positive(v.weight))) throw new Error("forest.json: pine.colors needs paints with weights");
  if (!isRange(p.scale?.height) || !isRange(p.scale.width)) throw new Error("forest.json: pine.scale needs height and width ranges");
  if (!positive(p.far.beyondMeters) || !(p.far.hysteresisMeters >= 0 && p.far.hysteresisMeters < p.far.beyondMeters)) throw new Error("forest.json: pine.far needs beyondMeters and a smaller hysteresisMeters");
  if (!(p.fade.least >= 0 && p.fade.least <= 1) || !positive(p.fade.marginMeters)) throw new Error("forest.json: pine.fade needs least (0 to 1) and marginMeters");
  // The trunk is the only part that collides, so it must stay inside the 1 m box at the widest a tree is drawn.
  if (p.trunk.radius * p.scale.width[1] > 0.5) throw new Error("forest.json: the trunk at its widest scale is wider than its 1 m collision box");
  const f = c.fall;
  for (const k of ["seconds", "bounceSeconds", "lieSeconds", "sinkSeconds", "sinkMeters", "maxFalling", "hintSeconds", "hintShotMeters"] as const) {
    if (!positive(f[k])) throw new Error(`forest.json: fall.${k} must be above 0`);
  }
  if (!(f.minDegrees > 0 && f.maxDegrees >= f.minDegrees && f.maxDegrees < 180)) throw new Error("forest.json: fall needs 0 < minDegrees <= maxDegrees < 180");
  return c;
}
