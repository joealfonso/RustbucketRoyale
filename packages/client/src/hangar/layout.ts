// The hangar behind the title screen, as numbers (data/hangar.json): where the bays, the loading bay and the screens
// are, which roster mech lives in which bay, and how the picked mech walks out. Pure, no three.js, so it is tested.

type V3 = [number, number, number];

export interface ScreenSpot {
  show: "bay" | "selected"; // a bay's mech, or whichever mech is in the loading bay
  bay?: number;
  center: V3;
  size: [number, number];
  turnDegrees: number;
  stand?: boolean; // on a console standing on the floor, rather than hung on the wall
}

export interface HangarConfig {
  hall: { halfWidth: number; backZ: number; frontZ: number; height: number; wallPanel: number; trussSpacing: number };
  floor: { panel: number; seam: number; plate: number };
  loadingBay: { x: number; z: number; halfWidth: number; halfDepth: number; slat: number; slatGap: number; pitDepth: number };
  bays: { order: string[]; spacing: number; z: number; halfWidth: number; halfDepth: number };
  hazard: { width: number; stripe: number; lift: number };
  gantry: {
    column: number; height: number; beam: number; armHeight: number; armLength: number; armThickness: number; clampSize: number;
    openDegrees: number; swingSeconds: number; cableSag: number; cableRadius: number;
  };
  walk: { metersPerSecond: number; clearMeters: number; arriveMeters: number };
  camera: { fov: number; position: V3; target: V3; driftMeters: V3; driftSeconds: V3; near: number; far: number };
  light: {
    fillSky: string; fillGround: string; fillIntensity: number;
    key: { color: string; intensity: number; direction: V3 };
    work: { color: string; intensity: number; height: number; angleDegrees: number; penumbra: number; distance: number };
    fog: { color: string; near: number; far: number };
  };
  lamps: { housing: V3; drop: number };
  screens: ScreenSpot[];
  screen: { line: string; dim: string; glass: string; glassOpacity: number; frame: number; gridLines: number; spinSeconds: number; fill: number };
  // The development grid: hexagons of light strips over the deck, `radius` metres centre to corner, inside a rectangle.
  hexGrid: { radius: number; strip: number; lift: number; color: string; from: [number, number]; to: [number, number] };
  // People at work for scale: dark figures at x, z, facing `degrees`.
  engineers: { paint: string; height: number; spots: [number, number, number][] };
  welder: {
    bench: V3; torch: V3; pool: number; burstEverySeconds: [number, number]; sparksPerBurst: [number, number];
    speed: [number, number]; lifeSeconds: [number, number]; gravity: number; length: number; width: number; color: string; tip: string; seed: number;
  };
  decals: {
    font: string;
    brand: { text: string; center: V3; height: number; color: string; panel: string; panelOpacity: number };
    markSize: number;
    bayNumber: { height: number; color: string; inFront: number };
    loadingBay: { text: string; height: number; color: string; inFront: number };
    floorMark: { size: number; color: string };
  };
  paints: Record<string, string>;
}

const PAINTS = ["floor", "pit", "slat", "wall", "wallTrim", "frame", "gantry", "arm", "cable", "hazard", "hazardDark", "lamp", "bench", "plate"];

export function parseHangar(raw: unknown): HangarConfig {
  const c = raw as HangarConfig;
  const positive = (v: unknown, what: string) => { if (typeof v !== "number" || !(v > 0)) throw new Error(`hangar.json: ${what} must be a number above 0`); };
  if (!c?.hall || !c.floor || !c.loadingBay || !c.bays || !c.gantry || !c.walk || !c.camera || !c.light || !c.screen || !c.welder || !c.decals || !c.paints) {
    throw new Error("hangar.json: needs hall, floor, loadingBay, bays, gantry, walk, camera, light, screen, welder, decals and paints");
  }
  if (!Array.isArray(c.bays.order) || c.bays.order.length === 0) throw new Error("hangar.json: bays.order lists the roster mechs, one per bay");
  if (new Set(c.bays.order).size !== c.bays.order.length) throw new Error("hangar.json: bays.order names a mech twice");
  positive(c.bays.spacing, "bays.spacing");
  positive(c.walk.metersPerSecond, "walk.metersPerSecond");
  positive(c.gantry.swingSeconds, "gantry.swingSeconds");
  positive(c.floor.panel, "floor.panel");
  positive(c.hexGrid?.radius, "hexGrid.radius");
  if (c.bays.halfWidth * 2 >= c.bays.spacing) throw new Error("hangar.json: bays overlap, keep halfWidth under half the spacing");
  // The grating replaces whole floor plates, so its edges have to fall on the plate grid.
  const onGrid = (v: number) => Math.abs(v / c.floor.panel - Math.round(v / c.floor.panel)) < 1e-6;
  const b = c.loadingBay;
  for (const edge of [b.x - b.halfWidth + c.hall.halfWidth, b.x + b.halfWidth + c.hall.halfWidth, b.z - b.halfDepth - c.hall.backZ, b.z + b.halfDepth - c.hall.backZ]) {
    if (!onGrid(edge)) throw new Error("hangar.json: the loading bay's edges must fall on the floor plate grid");
  }
  if (c.welder.pool < 1 || c.welder.burstEverySeconds[0] <= 0) throw new Error("hangar.json: welder needs a pool and a burst time above 0");
  for (const s of c.screens ?? []) {
    if (s.show === "bay" && !(Number.isInteger(s.bay) && s.bay! >= 0 && s.bay! < c.bays.order.length)) throw new Error(`hangar.json: a screen shows bay ${s.bay}, which does not exist`);
  }
  for (const p of PAINTS) if (typeof c.paints[p] !== "string") throw new Error(`hangar.json: paints.${p} is missing`);
  return c;
}

// The middle of each bay on the floor, left to right, spaced evenly about the loading bay's line.
export function bayCentres(c: HangarConfig): { x: number; z: number }[] {
  const n = c.bays.order.length;
  return c.bays.order.map((_, i) => ({ x: c.loadingBay.x + (i - (n - 1) / 2) * c.bays.spacing, z: c.bays.z }));
}

// Which bay each roster mech stands in, by its roster number. Throws if a roster mech has no bay or a bay names a
// mech that is not in the roster, so a new mech cannot quietly go missing from the title screen.
export function bayOfMech(c: HangarConfig, rosterIds: readonly string[]): number[] {
  const bays = rosterIds.map((id) => c.bays.order.indexOf(id));
  const missing = rosterIds.filter((_, i) => bays[i]! < 0);
  if (missing.length > 0) throw new Error(`hangar.json: no bay for ${missing.join(", ")}`);
  const unknown = c.bays.order.filter((id) => !rosterIds.includes(id));
  if (unknown.length > 0) throw new Error(`hangar.json: bays name ${unknown.join(", ")}, which is not in the roster`);
  return bays;
}

// One mech's walk this frame: from (x, z) toward its goal at `speed`, never past it. Writes the new spot and the
// velocity (for the walk cycle) into `out`.
export interface Step { x: number; z: number; vx: number; vz: number }
export function stepToward(x: number, z: number, goalX: number, goalZ: number, speed: number, dt: number, out: Step): Step {
  const dx = goalX - x, dz = goalZ - z;
  const left = Math.hypot(dx, dz);
  const move = Math.min(left, speed * dt);
  if (left < 1e-6 || move <= 0) {
    out.x = left < 1e-6 ? goalX : x; out.z = left < 1e-6 ? goalZ : z; out.vx = 0; out.vz = 0;
    return out;
  }
  out.x = x + (dx / left) * move;
  out.z = z + (dz / left) * move;
  out.vx = (dx / left) * (move / dt);
  out.vz = (dz / left) * (move / dt);
  return out;
}

// A mech heading out to the loading bay waits until every other mech is at least `clearMeters` from it, so the one
// going back and the one coming out never walk through each other.
export function loadingBayClear(c: HangarConfig, others: readonly { x: number; z: number }[]): boolean {
  return others.every((o) => Math.hypot(o.x - c.loadingBay.x, o.z - c.loadingBay.z) >= c.walk.clearMeters);
}

// Hazard stripes along a line on the floor: parallelograms leaning 45 degrees (corner points x, z), cut square at
// both ends of the band. Every other stripe is painted; the dark ones are the band underneath.
export function hazardStripes(x0: number, z0: number, x1: number, z1: number, width: number, stripe: number): [number, number][][] {
  const length = Math.hypot(x1 - x0, z1 - z0);
  if (length <= 0 || stripe <= 0) return [];
  const ux = (x1 - x0) / length, uz = (z1 - z0) / length; // along the band
  const nx = -uz, nz = ux; // across it
  const h = width / 2;
  const out: [number, number][][] = [];
  for (let s = -width; s < length; s += stripe * 2) {
    // In band space (along, across); the far edge is shifted by the width, which makes the 45 degree lean.
    let poly: [number, number][] = [[s, -h], [s + stripe, -h], [s + stripe + width, h], [s + width, h]];
    poly = clipAlong(poly, 0, 1);
    poly = clipAlong(poly, length, -1);
    if (poly.length >= 3) out.push(poly.map(([a, c]) => [x0 + ux * a + nx * c, z0 + uz * a + nz * c]));
  }
  return out;
}

// Keeps the part of a convex polygon where (along - edge) * side >= 0.
function clipAlong(poly: [number, number][], edge: number, side: number): [number, number][] {
  const out: [number, number][] = [];
  const inside = (p: [number, number]) => (p[0] - edge) * side >= -1e-9;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (edge - a[0]) / (b[0] - a[0]);
      out.push([edge, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// The edges of a flat-topped hexagon grid with one hexagon centred on (0, 0), every edge whose both ends lie inside the
// rectangle from `from` to `to` (x, z), each edge once. An edge is its two ends: x0, z0, x1, z1.
export function hexEdges(radius: number, from: [number, number], to: [number, number]): [number, number, number, number][] {
  const inside = (x: number, z: number) => x >= from[0] - 1e-6 && x <= to[0] + 1e-6 && z >= from[1] - 1e-6 && z <= to[1] + 1e-6;
  const seen = new Set<string>();
  const out: [number, number, number, number][] = [];
  const reach = Math.ceil(Math.max(...from.map(Math.abs), ...to.map(Math.abs)) / radius) + 1;
  for (let q = -reach; q <= reach; q++) {
    for (let r = -reach * 2; r <= reach * 2; r++) {
      const cx = radius * 1.5 * q, cz = radius * Math.sqrt(3) * (r + q / 2);
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k, b = (Math.PI / 3) * (k + 1);
        const x0 = cx + radius * Math.cos(a), z0 = cz + radius * Math.sin(a);
        const x1 = cx + radius * Math.cos(b), z1 = cz + radius * Math.sin(b);
        if (!inside(x0, z0) || !inside(x1, z1)) continue;
        // Shared edges are met twice, once from each hexagon: keyed by their middle.
        const key = `${Math.round((x0 + x1) * 500)},${Math.round((z0 + z1) * 500)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([x0, z0, x1, z1]);
      }
    }
  }
  return out;
}
