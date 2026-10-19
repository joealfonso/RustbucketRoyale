import { NOISE_KINDS, type NoiseKind } from "@rustbucket/shared";

// Each sound kind gets a shape, so the radar reads without colour: moving is a hollow ring, gunfire a cross, a blast a
// burst, something smashed a square, picking up or repairing a diamond.
const SHAPES = ["ring", "cross", "burst", "square", "diamond"] as const;
export type MarkShape = (typeof SHAPES)[number];

export interface RadarConfig {
  drawUnits: number; // the radar is drawn as if it were this many units across, then scaled to its size on screen
  discShade: number; // how much darker than the panel the scope's disc is, 0 to 1
  rangeRings: number; // evenly spaced rings out to the edge, the outermost being the edge itself
  sweepSeconds: number; // one full turn of the sweep line
  sweepTrailDegrees: number;
  sweepTrailBands: number; // the trail is flat bands that step down, not a smooth glow
  sweepTrailAlpha: number; // the band nearest the line; each one behind it is a step fainter
  pulseSeconds: number; // how long a heard sound stays on the radar
  maxPulses: number;
  markSize: number; // in draw units
  markGrowth: number; // how much a mark grows over its life, as a share of its size
  mechDotSize: number;
  zoneLineWidth: number;
  zoneDash: number[];
  marks: Record<NoiseKind, MarkShape>;
  warn: NoiseKind[]; // also drawn in warning red; the shape still tells them apart
}

const NUMBERS = ["drawUnits", "discShade", "rangeRings", "sweepSeconds", "sweepTrailDegrees", "sweepTrailBands", "sweepTrailAlpha", "pulseSeconds", "maxPulses", "markSize", "markGrowth", "mechDotSize", "zoneLineWidth"] as const;

// Fails loudly on a bad data file, same as the other tuning files.
export function parseRadar(raw: unknown): RadarConfig {
  const d = raw as Partial<RadarConfig>;
  for (const key of NUMBERS) {
    if (typeof d?.[key] !== "number" || !(d[key] >= 0)) throw new Error(`radar.json: ${key} must be a number, 0 or more`);
  }
  for (const key of ["drawUnits", "sweepSeconds", "pulseSeconds", "sweepTrailBands", "maxPulses"] as const) {
    if (!(d[key]! > 0)) throw new Error(`radar.json: ${key} must be above 0`);
  }
  if (!Array.isArray(d.zoneDash) || d.zoneDash.length !== 2 || !d.zoneDash.every((n) => typeof n === "number" && n > 0)) {
    throw new Error("radar.json: zoneDash must be two numbers above 0, dash then gap");
  }
  for (const kind of NOISE_KINDS) {
    if (!SHAPES.includes(d.marks?.[kind] as MarkShape)) throw new Error(`radar.json: marks.${kind} must be one of ${SHAPES.join(", ")}`);
  }
  if (!Array.isArray(d.warn) || !d.warn.every((k) => NOISE_KINDS.includes(k))) throw new Error("radar.json: warn must list sound kinds");
  return d as RadarConfig;
}

// The shape for each sound by its index in NOISE_KINDS, which is how the server sends it.
export function shapesByKind(config: RadarConfig): MarkShape[] {
  return NOISE_KINDS.map((kind) => config.marks[kind]);
}

export function warnByKind(config: RadarConfig): boolean[] {
  return NOISE_KINDS.map((kind) => config.warn.includes(kind));
}
