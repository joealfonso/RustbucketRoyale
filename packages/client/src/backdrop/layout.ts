import { rng, seedOf } from "../dressing/kinds";

// Where the distant junkyard stands: rows of scrap heaps and junk mountains in a ring round the map, with cranes,
// gantries, smokestacks and cooling towers among them. Pure numbers, no three.js. The same map size always gets the
// same ring (it is seeded from the size, not the match), so it reads as the world the arenas sit in.

type Range = [number, number];

export interface HeapRow {
  spacingMeters: number; // along the ring, roughly
  outMeters: Range; // from the outside of the edge wall
  heightMeters: Range;
  radiusMeters: Range;
  sides: Range;
  junkPerHeap: number;
  paints: string[];
}

export interface BackdropConfig {
  seed: number;
  clearMeters: number; // nothing comes nearer the edge wall than this
  apron: { outMeters: number; paint: string };
  heaps: HeapRow;
  mountains: HeapRow;
  landmarks: {
    spacingMeters: number;
    outMeters: Range;
    kinds: LandmarkKind[];
    crane: { heightMeters: Range; mast: number; jib: Range; paint: string; accent: string };
    gantry: { heightMeters: Range; span: Range; leg: number; paint: string; accent: string };
    stack: { heightMeters: Range; radius: Range; bands: number; paint: string; accent: string };
    cooling: { heightMeters: Range; radius: Range; paint: string; accent: string };
  };
}

export type LandmarkKind = "crane" | "gantry" | "stack" | "cooling";

export interface BackdropItem {
  kind: "heap" | LandmarkKind;
  x: number;
  z: number;
  yaw: number; // radians about y; landmarks are turned to run along their side of the ring
  radius: number; // the item's footprint, from its middle
  height: number;
  seed: number;
  row?: HeapRow; // for heaps, which row's look they take
}

export function parseBackdrop(raw: unknown): BackdropConfig {
  const c = raw as BackdropConfig;
  const range = (r: unknown, label: string) => {
    if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== "number" || !(r[1] >= r[0])) throw new Error(`backdrop.json: ${label} must be [low, high]`);
  };
  if (typeof c?.seed !== "number" || typeof c.clearMeters !== "number" || typeof c.apron?.outMeters !== "number") throw new Error("backdrop.json: backdrop needs seed, clearMeters and apron");
  for (const name of ["heaps", "mountains"] as const) {
    const row = c[name];
    for (const key of ["outMeters", "heightMeters", "radiusMeters", "sides"] as const) range(row?.[key], `${name}.${key}`);
    if (!(row.spacingMeters > 0) || !Array.isArray(row.paints) || row.paints.length === 0) throw new Error(`backdrop.json: ${name} needs spacingMeters and paints`);
  }
  const l = c.landmarks;
  if (!(l?.spacingMeters > 0) || !Array.isArray(l.kinds) || l.kinds.length === 0) throw new Error("backdrop.json: landmarks need spacingMeters and kinds");
  range(l.outMeters, "landmarks.outMeters");
  for (const kind of l.kinds) range(l[kind]?.heightMeters, `landmarks.${kind}.heightMeters`);
  return c;
}

const between = (r: () => number, [lo, hi]: Range) => lo + r() * (hi - lo);

// A point on the square ring `out` metres beyond `edge`, a share `t` (0..1) of the way round, and the direction
// along that side.
function onRing(edge: number, out: number, t: number): { x: number; z: number; yaw: number } {
  const h = edge + out;
  const s = (((t % 1) + 1) % 1) * 8 * h;
  const side = Math.floor(s / (2 * h)), along = (s % (2 * h)) - h;
  if (side === 0) return { x: along, z: -h, yaw: 0 };
  if (side === 1) return { x: h, z: along, yaw: Math.PI / 2 };
  if (side === 2) return { x: -along, z: h, yaw: Math.PI };
  return { x: -h, z: -along, yaw: -Math.PI / 2 };
}

// `edge` is how far the outside of the edge wall is from the map's middle (half the map plus the wall's thickness).
export function backdropLayout(c: BackdropConfig, meters: number, edge: number): BackdropItem[] {
  const r = rng(seedOf(c.seed, Math.round(meters)));
  const items: BackdropItem[] = [];
  const count = (spacing: number, out: Range) => Math.max(4, Math.round((8 * (edge + (out[0] + out[1]) / 2)) / spacing));

  for (const row of [c.mountains, c.heaps]) {
    const n = count(row.spacingMeters, row.outMeters);
    for (let i = 0; i < n; i++) {
      const out = between(r, row.outMeters);
      const at = onRing(edge, out, (i + r() * 0.8) / n);
      const radius = Math.min(between(r, row.radiusMeters), out - c.clearMeters);
      items.push({ kind: "heap", x: at.x, z: at.z, yaw: r() * Math.PI * 2, radius, height: between(r, row.heightMeters), seed: Math.floor(r() * 2 ** 31), row });
    }
  }

  const l = c.landmarks;
  const n = count(l.spacingMeters, l.outMeters);
  for (let i = 0; i < n; i++) {
    const kind = l.kinds[Math.floor(r() * l.kinds.length)]!;
    const out = between(r, l.outMeters);
    const at = onRing(edge, out, (i + 0.25 + r() * 0.5) / n);
    const height = between(r, l[kind].heightMeters);
    const radius = Math.min(out - c.clearMeters, landmarkReach(c, kind));
    items.push({ kind, x: at.x, z: at.z, yaw: at.yaw, radius, height, seed: Math.floor(r() * 2 ** 31) });
  }
  return items;
}

// The most a landmark can reach from its middle, so the layout can keep it clear of the wall.
export function landmarkReach(c: BackdropConfig, kind: LandmarkKind): number {
  const l = c.landmarks;
  if (kind === "crane") return l.crane.jib[1] * 1.35 + l.crane.mast;
  if (kind === "gantry") return l.gantry.span[1] * 0.75 + l.gantry.leg;
  if (kind === "stack") return l.stack.radius[1] * 1.2;
  return l.cooling.radius[1] * 1.05;
}
