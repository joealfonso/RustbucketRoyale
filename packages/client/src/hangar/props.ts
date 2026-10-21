import * as THREE from "three";
import mechKitsJson from "../../../../data/mechKits.json";
import propsJson from "../../../../data/hangarProps.json";
import { toGeometry } from "../dressing/dressing";
import { box, cylinder, prism, turn, type MeshData, type V3 } from "../dressing/shapes";
import { freeze } from "../freeze";
import type { Toon } from "../toonMaterial";
import { segment } from "./hall";
import { bayCentres, type HangarConfig } from "./layout";

// The story clutter (gate V12), from data/hangarProps.json: each bay dressed to the mech that lives in it, in that
// mech's own paint (data/mechKits.json schemes), general workshop clutter round the bays, and the engineers.
// Everything is merged into one vertex-coloured mesh, so the whole lot costs a fill, an outline, the steady lights
// and the charging lights: four draw calls. Built facing +z (out of the bay, toward you) and turned into place.
// `still` is true when the player asked for reduced motion: the charging lights then hold steady.

const KINDS = ["shieldPlates", "ammoDrums", "fuelCells", "finStand", "mortarShells", "droneCradles", "rifleRack", "weaponRack", "ammoCrates", "armourStand", "toolCart"] as const;
type Kind = (typeof KINDS)[number];
const POSES = ["stand", "tablet", "carry", "point"] as const;
type Pose = (typeof POSES)[number];
const ROLES = ["main", "trim", "dark", "glow"] as const;
type Role = (typeof ROLES)[number];
const PAINTS = ["steel", "dark", "rubber", "hazard", "crate", "cart", "rack", "screen"] as const;
const PERSON_PAINTS = ["boots", "gloves", "belt", "stripe", "goggles"] as const;

// How far each model reaches from its centre on the floor, for the clearance check. Part of the model, like its size.
const REACH: Record<Kind, number> = {
  shieldPlates: 1.0, ammoDrums: 0.8, fuelCells: 0.75, finStand: 0.7, mortarShells: 1.1, droneCradles: 1.0,
  rifleRack: 0.9, weaponRack: 1.25, ammoCrates: 1.0, armourStand: 0.7, toolCart: 0.7,
};
const PERSON_REACH = 0.35;
const WALL_GAP = 0.35; // half the depth of the deepest rack
const COLUMN_FOOT = 0.45; // half the gantry column's foot plate (gantry.ts)

interface Placed { kind: Kind; at: [number, number]; turnDegrees: number }
interface Person { at: [number, number]; turnDegrees: number; pose: Pose; overalls: string; helmet: string; skin: string }
export interface PropsConfig {
  // Props stay this far beyond every mech's walk to the loading bay (its widest half) and outside the loading bay.
  clearance: { walkMeters: number; loadingBayMeters: number };
  paints: Record<(typeof PAINTS)[number], string>;
  // Per mech: which of its scheme colours dress its bay, and what stands there (x, z from the bay's middle).
  bays: Record<string, { accents: Record<Role, string>; items: Placed[] }>;
  workshop: Placed[]; // x, z in the hall
  engineers: { height: number; paints: Record<(typeof PERSON_PAINTS)[number], string>; people: Person[] };
  // The drone cradles' charging lights breathe between `low` and full over `seconds`.
  pulse: { seconds: number; low: number };
}

type Schemes = Record<string, Record<string, string>>;
const schemesOf = (kits: unknown): Schemes =>
  Object.fromEntries(Object.entries((kits as { kits: Record<string, { scheme?: Record<string, string> }> }).kits).map(([id, k]) => [id, k.scheme ?? {}]));

export function parseHangarProps(raw: unknown, hangar: HangarConfig, schemes: Schemes): PropsConfig {
  const c = raw as PropsConfig;
  const fail = (why: string): never => { throw new Error(`hangarProps.json: ${why}`); };
  if (!c?.clearance || !c.paints || !c.bays || !Array.isArray(c.workshop) || !c.engineers || !c.pulse) fail("needs clearance, paints, bays, workshop, engineers and pulse");
  const number = (v: unknown, what: string, min = -Infinity) => { if (typeof v !== "number" || !Number.isFinite(v) || v < min) fail(`${what} must be a number of at least ${min}`); };
  number(c.clearance.walkMeters, "clearance.walkMeters", 0);
  number(c.clearance.loadingBayMeters, "clearance.loadingBayMeters", 0);
  number(c.engineers.height, "engineers.height", 0.5);
  number(c.pulse.seconds, "pulse.seconds", 0.1);
  if (!(c.pulse.low >= 0 && c.pulse.low <= 1)) fail("pulse.low is a share of full brightness, 0 to 1");
  for (const p of PAINTS) if (typeof c.paints[p] !== "string") fail(`paints.${p} is missing`);
  for (const p of PERSON_PAINTS) if (typeof c.engineers.paints?.[p] !== "string") fail(`engineers.paints.${p} is missing`);

  const centres = bayCentres(hangar);
  const homeOf = (mech: string) => centres[hangar.bays.order.indexOf(mech)]!;
  // Where a prop must not stand: on a walk from a bay to the loading bay, in the loading bay, on a gantry column, in a wall.
  const clear = (x: number, z: number, reach: number, what: string) => {
    const { halfWidth, backZ, frontZ } = hangar.hall;
    // Racks stand with their backs to a wall, so against the walls only their depth counts, not their reach.
    if (Math.abs(x) + WALL_GAP > halfWidth || z - WALL_GAP < backZ || z > frontZ) fail(`${what} at ${x}, ${z} is through a wall`);
    const b = hangar.loadingBay;
    const pad = c.clearance.loadingBayMeters + reach;
    if (Math.abs(x - b.x) < b.halfWidth + pad && Math.abs(z - b.z) < b.halfDepth + pad) fail(`${what} at ${x}, ${z} is in the loading bay`);
    for (const home of centres) {
      if (distanceToSegment(x, z, home.x, home.z, b.x, b.z) < c.clearance.walkMeters + reach) fail(`${what} at ${x}, ${z} is in a mech's way to the loading bay`);
      for (const side of [-1, 1]) {
        if (Math.hypot(x - (home.x + side * hangar.bays.halfWidth), z - home.z) < COLUMN_FOOT + reach) fail(`${what} at ${x}, ${z} is on a gantry column`);
      }
    }
  };
  const placed = (p: Placed, x0: number, z0: number, what: string) => {
    if (!KINDS.includes(p?.kind)) fail(`${what} is a ${p?.kind}, which is not one of ${KINDS.join(", ")}`);
    if (!Array.isArray(p.at) || p.at.length !== 2) fail(`${what} needs at: [x, z]`);
    number(p.at[0], `${what} x`); number(p.at[1], `${what} z`); number(p.turnDegrees, `${what} turnDegrees`);
    clear(x0 + p.at[0], z0 + p.at[1], REACH[p.kind], `${what} (${p.kind})`);
  };
  for (const [mech, bay] of Object.entries(c.bays)) {
    if (!hangar.bays.order.includes(mech)) fail(`bays.${mech} has no bay in hangar.json`);
    const scheme = schemes[mech] ?? fail(`bays.${mech} has no paint scheme in mechKits.json`);
    for (const role of ROLES) if (typeof scheme[bay.accents?.[role] ?? ""] !== "string") fail(`bays.${mech}.accents.${role} names ${bay.accents?.[role]}, which is not in its scheme`);
    const home = homeOf(mech);
    bay.items.forEach((p, i) => placed(p, home.x, home.z, `bays.${mech}.items[${i}]`));
  }
  c.workshop.forEach((p, i) => placed(p, 0, 0, `workshop[${i}]`));
  c.engineers.people.forEach((p, i) => {
    const what = `engineers.people[${i}]`;
    if (!POSES.includes(p?.pose)) fail(`${what} pose must be one of ${POSES.join(", ")}`);
    for (const k of ["overalls", "helmet", "skin"] as const) if (typeof p[k] !== "string") fail(`${what} needs ${k}`);
    number(p.at?.[0], `${what} x`); number(p.at?.[1], `${what} z`); number(p.turnDegrees, `${what} turnDegrees`);
    clear(p.at[0], p.at[1], PERSON_REACH, what);
  });
  return c;
}

export function distanceToSegment(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0, dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
}

// Meshes with a colour each, in three buckets by how they are drawn; every mesh added is turned into the current place.
interface Bucket { meshes: MeshData[]; colors: string[] }
class Brush {
  readonly solid: Bucket = { meshes: [], colors: [] };
  readonly light: Bucket = { meshes: [], colors: [] };
  readonly charge: Bucket = { meshes: [], colors: [] };
  private x = 0; private z = 0; private yaw = 0; private scale = 1;

  place(x: number, z: number, degrees: number, scale = 1): void {
    this.x = x; this.z = z; this.yaw = (degrees * Math.PI) / 180; this.scale = scale;
  }
  paint(color: string, ...meshes: MeshData[]): void { this.add(this.solid, color, meshes); }
  glow(color: string, ...meshes: MeshData[]): void { this.add(this.light, color, meshes); }
  pulse(color: string, ...meshes: MeshData[]): void { this.add(this.charge, color, meshes); }

  private add(bucket: Bucket, color: string, meshes: MeshData[]): void {
    for (const m of meshes) {
      const sized = this.scale === 1 ? m : { ...m, positions: m.positions.map((v) => v * this.scale) };
      bucket.meshes.push(turn(sized, [0, this.yaw, 0], [0, 0, 0], [this.x, 0, this.z]));
      bucket.colors.push(color);
    }
  }
}

type Colors = Record<string, string>; // the shared paints, plus main / trim / dark / glow for a bay's mech
type Builder = (b: Brush, p: Colors) => void;

// A slice of a ring round the y axis at (cx, cz): the stripes painted on a drum, standing proud of its faces.
function arc(cx: number, cz: number, r0: number, r1: number, a0: number, a1: number, y0: number, y1: number): MeshData {
  // Angles as cylinder() lays its corners: x = sin, z = cos. A prism along y takes (z, x) pairs.
  const at = (r: number, a: number): [number, number] => [cz + Math.cos(a) * r, cx + Math.sin(a) * r];
  return prism([at(r0, a0), at(r0, a1), at(r1, a1), at(r1, a0)], "y", y0, y1);
}

// Ironclad: spare siege shield slabs, capped and banded in hazard yellow like the one on its arm, leaning on a stand.
const shieldPlates: Builder = (b, p) => {
  b.paint(p.dark!, box([0, 0.06, -0.3], [1.9, 0.12, 1.2]));
  for (const side of [-1, 1]) b.paint(p.dark!, segment([side * 0.78, 0.12, -0.85], [side * 0.78, 2.25, -0.52], 0.09));
  b.paint(p.dark!, segment([-0.78, 2.25, -0.52], [0.78, 2.25, -0.52], 0.08));
  const slab = (x: number, z: number, lean: number) => {
    const at = (m: MeshData) => turn(m, [lean, 0, 0], [0, 0, 0], [x, 0.12, z]);
    b.paint(p.main!, at(box([0, 1.3, 0], [1.3, 2.6, 0.16], 0.04)));
    b.paint(p.trim!, at(box([0, 2.46, 0], [1.34, 0.26, 0.2])), at(box([0, 0.14, 0], [1.34, 0.26, 0.2])), at(box([0, 1.3, 0], [1.34, 0.2, 0.2])));
    b.paint(p.steel!, at(box([0, 2.62, 0], [1.2, 0.06, 0.1])));
  };
  slab(0.1, -0.05, -0.18);
  slab(-0.14, 0.2, -0.2);
};

// Ironclad: autocannon ammo drums with diagonal hazard stripes, three standing and one stacked on the back one.
const ammoDrums: Builder = (b, p) => {
  const drum = (cx: number, y: number, cz: number) => {
    const r = 0.32, h = 0.86, sides = 12;
    b.paint(p.dark!, cylinder([cx, y + h / 2, cz], r, h, "y", sides));
    b.paint(p.steel!, cylinder([cx, y + 0.03, cz], r + 0.015, 0.06, "y", sides), cylinder([cx, y + h - 0.03, cz], r + 0.015, 0.06, "y", sides));
    b.paint(p.steel!, cylinder([cx + 0.14, y + h + 0.015, cz + 0.08], 0.05, 0.03, "y", 6));
    // Rows of slices, each row one slice round from the last, so the stripes run at a slant like painted hazard tape.
    const rows = 4, rowHeight = 0.08, bottom = y + 0.3;
    for (let k = 0; k < rows; k++) {
      for (let i = 0; i < sides; i++) {
        if ((i + k) % 4 >= 2) continue;
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        b.paint(p.trim!, arc(cx, cz, r - 0.06, r + 0.016, a0, a1, bottom + k * rowHeight, bottom + (k + 1) * rowHeight));
      }
    }
  };
  drum(-0.36, 0, 0.22);
  drum(0.38, 0, 0.26);
  drum(0.02, 0, -0.38);
  drum(0.02, 0.88, -0.38);
};

// Stiletto: jump-jet fuel cells in a rack, white with its blue band, the fuel showing through in its conduit orange.
const fuelCells: Builder = (b, p) => {
  b.paint(p.dark!, box([0, 0.05, 0], [1.3, 0.1, 0.8]));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.paint(p.dark!, box([sx * 0.62, 0.5, sz * 0.36], [0.06, 0.9, 0.06]));
  for (const sz of [-1, 1]) b.paint(p.dark!, box([0, 0.82, sz * 0.36], [1.3, 0.05, 0.05]));
  for (const x of [-0.4, 0, 0.4]) {
    for (const z of [-0.18, 0.18]) {
      b.paint(p.trim!, cylinder([x, 0.5, z], 0.16, 0.8, "y", 10));
      b.paint(p.main!, cylinder([x, 0.66, z], 0.166, 0.12, "y", 10));
      b.paint(p.steel!, cylinder([x, 0.93, z], 0.09, 0.06, "y", 8));
      b.glow(p.glow!, cylinder([x, 0.34, z], 0.168, 0.06, "y", 10));
    }
  }
};

// Stiletto: a spare stabiliser fin off its jump pack, on a stand, its broad side to you.
const finStand: Builder = (b, p) => {
  b.paint(p.dark!, box([0, 0.04, 0], [0.9, 0.08, 0.9]), cylinder([0, 0.62, 0], 0.07, 1.1, "y", 8));
  b.paint(p.steel!, box([0, 1.18, 0], [0.3, 0.12, 0.26]));
  const fin = (outline: [number, number][], half: number) => prism(outline.map(([x, y]) => [x - 0.25, y + 1.22]), "z", -half, half);
  b.paint(p.main!, fin([[-0.13, 0], [0.58, 0], [1.3, 2.08], [0.91, 2.28]], 0.05));
  b.paint(p.trim!, fin([[-0.26, 0], [-0.13, 0], [0.91, 2.28], [0.8, 2.28]], 0.06));
  b.paint(p.dark!, box([0, 1.26, 0], [0.62, 0.08, 0.16]));
};

// Cataclysm: rail mortar shells, nose and base in its rust brown on a tan body, a stack on chocks and two stood up.
const mortarShells: Builder = (b, p) => {
  // One shell from its base along +x or +y. Lengths are the base, the body, the ogive and the fuze.
  const shell = (origin: V3, axis: "x" | "y") => {
    const along = (t: number): V3 => (axis === "x" ? [origin[0] + t, origin[1], origin[2]] : [origin[0], origin[1] + t, origin[2]]);
    const r = 0.2;
    b.paint(p.dark!, cylinder(along(0.05), r, 0.1, axis, 8));
    b.paint(p.trim!, cylinder(along(0.14), r + 0.008, 0.08, axis, 8));
    b.paint(p.main!, cylinder(along(0.5), r, 0.64, axis, 8));
    b.paint(p.trim!, cylinder(along(0.995), r, 0.35, axis, 8, 0.06));
    b.paint(p.steel!, cylinder(along(1.2), 0.055, 0.06, axis, 6));
  };
  for (const x of [-0.25, 0.35]) b.paint(p.dark!, box([x - 0.05, 0.06, 0], [0.14, 0.12, 1.3]));
  const step = 0.42, rise = 0.36;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) shell([-0.65, 0.32 + row * rise, (i - (2 - row) / 2) * step], "x");
  }
  shell([0.95, 0, -0.22], "y");
  shell([0.98, 0, 0.24], "y");
};

// Arbiter: drone charging cradles, a drone asleep in each, the cup's rim lit while it charges.
const droneCradles: Builder = (b, p) => {
  b.paint(p.dark!, box([0, 0.08, 0], [1.95, 0.16, 0.5]));
  for (const x of [-0.64, 0, 0.64]) {
    b.paint(p.dark!, cylinder([x, 0.52, 0], 0.07, 0.72, "y", 6), cylinder([x, 0.9, 0], 0.17, 0.12, "y", 8, 0.26));
    b.pulse(p.glow!, cylinder([x, 0.97, 0], 0.27, 0.025, "y", 8));
    b.paint(p.main!, cylinder([x, 1.12, 0], 0.22, 0.26, "y", 8), cylinder([x, 1.29, 0], 0.22, 0.08, "y", 8, 0.12));
    b.paint(p.trim!, cylinder([x, 1.12, 0], 0.227, 0.07, "y", 8));
    for (const side of [-1, 1]) b.paint(p.dark!, box([x + side * 0.26, 1.12, 0], [0.09, 0.06, 0.06]));
    b.glow(p.glow!, box([x, 1.15, 0.21], [0.1, 0.05, 0.04]));
  }
};

// Longshot: a rack of spare rail rifles stood muzzle up: bone stock and receiver, black rails, slate coils, a red scope.
const rifleRack: Builder = (b, p) => {
  b.paint(p.dark!, box([0, 0.05, -0.05], [1.7, 0.1, 0.6]));
  for (const side of [-1, 1]) b.paint(p.dark!, box([side * 0.78, 1.35, -0.2], [0.1, 2.7, 0.1]));
  for (const y of [0.55, 2.45]) b.paint(p.dark!, box([0, y, -0.2], [1.66, 0.08, 0.08]));
  for (const x of [-0.34, 0.34]) {
    b.paint(p.trim!, box([x, 0.42, 0], [0.12, 0.6, 0.3]), box([x, 0.98, 0.02], [0.16, 0.56, 0.26]));
    b.paint(p.main!, box([x, 0.98, -0.16], [0.2, 0.36, 0.14]));
    for (const side of [-1, 1]) b.paint(p.dark!, box([x + side * 0.05, 1.93, 0.03], [0.05, 1.42, 0.07]));
    b.paint(p.trim!, box([x, 1.93, 0.03], [0.04, 1.38, 0.03]));
    for (const y of [1.45, 1.85, 2.25]) b.paint(p.main!, box([x, y, 0.03], [0.2, 0.1, 0.17]));
    b.paint(p.main!, box([x, 2.72, 0.03], [0.21, 0.2, 0.21], 0.03));
    b.paint(p.dark!, box([x, 1.36, 0.2], [0.07, 0.5, 0.08]));
    b.glow(p.glow!, box([x, 1.62, 0.2], [0.06, 0.03, 0.07]));
  }
};

// Spare guns on a two-shelf rack: a rotary cannon's barrel cluster on top, a missile pod and ammo boxes below.
const weaponRack: Builder = (b, p) => {
  for (const side of [-1, 1]) b.paint(p.rack!, box([side * 1.1, 1.15, -0.2], [0.1, 2.3, 0.1]), box([side * 1.1, 0.03, 0], [0.12, 0.06, 0.6]));
  for (const y of [0.85, 1.75]) b.paint(p.rack!, box([0, y, 0], [2.3, 0.06, 0.55]));
  const barrelY = 1.98;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.paint(p.steel!, cylinder([0.1, barrelY + Math.sin(a) * 0.1, Math.cos(a) * 0.1], 0.04, 1.6, "x", 6));
  }
  for (const x of [-0.25, 0.45]) b.paint(p.dark!, cylinder([x, barrelY, 0], 0.16, 0.08, "x", 8));
  b.paint(p.dark!, cylinder([-0.85, barrelY, 0], 0.19, 0.32, "x", 8));
  b.paint(p.steel!, box([-0.5, 1.13, 0], [0.85, 0.5, 0.5], 0.03));
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) b.paint(p.dark!, box([-0.75 + k * 0.25, 1.02 + r * 0.22, 0.25], [0.15, 0.15, 0.02]));
  b.paint(p.crate!, box([0.4, 1.05, 0], [0.5, 0.34, 0.42], 0.02), box([0.85, 1.0, 0.02], [0.32, 0.24, 0.36], 0.02));
  b.paint(p.hazard!, box([0.4, 1.08, 0.215], [0.22, 0.08, 0.01]));
};

// A stack of ammunition crates with dark straps and a yellow stencil block on the front.
const ammoCrates: Builder = (b, p) => {
  const crate = (x: number, y: number, z: number, size: V3, yaw: number) => {
    const at = (m: MeshData) => turn(m, [0, yaw, 0], [0, 0, 0], [x, y, z]);
    const [w, h, d] = size;
    b.paint(p.crate!, at(box([0, 0, 0], size, 0.025)));
    for (const s of [-1, 1]) b.paint(p.dark!, at(box([s * w * 0.32, 0, 0], [0.06, h + 0.02, d + 0.02])));
    b.paint(p.hazard!, at(box([0, h * 0.1, d / 2 + 0.005], [w * 0.3, h * 0.28, 0.012])));
  };
  crate(0, 0.3, 0, [1.0, 0.6, 0.65], 0);
  crate(0.06, 0.88, 0.02, [0.85, 0.56, 0.6], 0.18);
  crate(0.95, 0.25, 0.15, [0.7, 0.5, 0.6], -0.25);
};

// A spare chest plate hung on a stand, waiting to be bolted on.
const armourStand: Builder = (b, p) => {
  b.paint(p.dark!, box([0, 0.04, 0], [0.75, 0.08, 0.75]), box([0, 0.9, -0.1], [0.1, 1.75, 0.1]), box([0, 1.75, -0.1], [1.0, 0.1, 0.1]));
  const plate: [number, number][] = [[-0.6, -0.55], [0.6, -0.55], [0.72, 0.25], [0.42, 0.68], [-0.42, 0.68], [-0.72, 0.25]];
  b.paint(p.steel!, prism(plate.map(([x, y]) => [x, y + 1.15]), "z", -0.04, 0.08));
  b.paint(p.hazard!, box([0, 1.6, 0.085], [0.8, 0.09, 0.02]));
  for (const sx of [-1, 1]) for (const y of [0.75, 1.42]) b.paint(p.dark!, box([sx * 0.48, y, 0.09], [0.06, 0.06, 0.03]));
};

// A rolling tool chest, drawers to the front, a wrench and a hammer left on top.
const toolCart: Builder = (b, p) => {
  b.paint(p.cart!, box([0, 0.56, 0], [0.95, 0.72, 0.56], 0.02));
  b.paint(p.dark!, box([0, 0.95, 0], [1.0, 0.06, 0.6]));
  for (const y of [0.42, 0.62, 0.8]) {
    b.paint(p.dark!, box([0, y + 0.07, 0.285], [0.86, 0.02, 0.01]));
    b.paint(p.steel!, box([0, y, 0.29], [0.3, 0.03, 0.03]));
  }
  for (const sz of [-1, 1]) b.paint(p.steel!, box([0.56, 0.95, sz * 0.22], [0.16, 0.04, 0.04]));
  b.paint(p.steel!, box([0.64, 0.95, 0], [0.04, 0.04, 0.5]));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.paint(p.dark!, box([sx * 0.38, 0.17, sz * 0.2], [0.06, 0.06, 0.06]));
    b.paint(p.rubber!, cylinder([sx * 0.38, 0.08, sz * 0.2], 0.08, 0.05, "x", 8));
  }
  b.paint(p.steel!, box([-0.18, 1.0, 0.08], [0.42, 0.03, 0.06]), box([-0.4, 1.0, 0.08], [0.08, 0.035, 0.12]));
  b.paint(p.steel!, box([0.22, 1.02, -0.1], [0.08, 0.07, 0.16]));
  b.paint(p.dark!, box([0.22, 1.0, 0.06], [0.04, 0.03, 0.3]));
};

const BUILDERS: Record<Kind, Builder> = { shieldPlates, ammoDrums, fuelCells, finStand, mortarShells, droneCradles, rifleRack, weaponRack, ammoCrates, armourStand, toolCart };

// An engineer in work overalls with a reflective band, gloves, goggles and a hard hat, built 1.8 m tall facing +z.
// Their right hand is on -x. Plain shapes in mid and light colours so they read as people, not as more machinery.
function engineer(b: Brush, who: Person, k: PropsConfig["engineers"]["paints"], tablet: string, crate: string): void {
  const suit = who.overalls;
  for (const s of [-1, 1]) {
    b.paint(k.boots, box([s * 0.11, 0.06, 0.04], [0.16, 0.12, 0.29]));
    b.paint(suit, box([s * 0.11, 0.51, 0], [0.17, 0.8, 0.21]));
    b.paint(k.stripe, box([s * 0.11, 0.3, 0], [0.18, 0.05, 0.22]));
  }
  b.paint(suit, box([0, 1.13, 0], [0.46, 0.58, 0.27], 0.04));
  b.paint(k.belt, box([0, 0.88, 0], [0.47, 0.07, 0.28]));
  b.paint(k.stripe, box([0, 1.24, 0], [0.47, 0.06, 0.28]));
  b.paint(who.skin, box([0, 1.47, 0], [0.1, 0.08, 0.1]), box([0, 1.6, 0.01], [0.2, 0.23, 0.22], 0.04));
  b.paint(k.goggles, box([0, 1.64, 0.115], [0.18, 0.05, 0.02]));
  b.paint(who.helmet, cylinder([0, 1.765, 0], 0.135, 0.11, "y", 10, 0.085), cylinder([0, 1.715, 0.015], 0.165, 0.025, "y", 10));
  // Arms: shoulder to elbow to hand, in the overalls' sleeves, a glove on the end.
  const arm = (side: number, elbow: V3, hand: V3) => {
    const shoulder: V3 = [side * 0.27, 1.38, 0];
    b.paint(suit, segment(shoulder, elbow, 0.12), segment(elbow, hand, 0.11));
    b.paint(k.gloves, box(hand, [0.11, 0.11, 0.11]));
  };
  const down = (side: number) => arm(side, [side * 0.3, 1.1, 0.01], [side * 0.3, 0.82, 0.03]);
  if (who.pose === "stand") { down(-1); down(1); }
  if (who.pose === "tablet") {
    for (const s of [-1, 1]) arm(s, [s * 0.27, 1.08, 0.06], [s * 0.14, 1.14, 0.32]);
    // Held tipped back toward the face, the lit screen on its upper side.
    const tilt = (m: MeshData) => turn(m, [-2.0, 0, 0], [0, 0, 0], [0, 1.2, 0.36]);
    b.paint(k.belt, tilt(box([0, 0, 0], [0.34, 0.24, 0.025])));
    b.glow(tablet, tilt(box([0, 0, 0.015], [0.29, 0.19, 0.01])));
  }
  if (who.pose === "carry") {
    for (const s of [-1, 1]) arm(s, [s * 0.29, 1.08, 0.08], [s * 0.27, 1.02, 0.34]);
    b.paint(crate, box([0, 1.06, 0.36], [0.44, 0.32, 0.36], 0.02));
  }
  if (who.pose === "point") {
    arm(-1, [-0.3, 1.55, 0.25], [-0.32, 1.72, 0.52]);
    arm(1, [0.44, 1.1, -0.04], [0.26, 0.92, 0.06]); // the other hand on the hip
  }
}

export class HangarProps {
  readonly group = new THREE.Group();
  private charge: THREE.MeshBasicMaterial;
  private pulse: PropsConfig["pulse"];

  constructor(config: HangarConfig, toon: Toon) {
    const schemes = schemesOf(mechKitsJson);
    const c = parseHangarProps(propsJson, config, schemes);
    this.pulse = c.pulse;
    const b = new Brush();
    const centres = bayCentres(config);
    for (const [mech, bay] of Object.entries(c.bays)) {
      const home = centres[config.bays.order.indexOf(mech)]!;
      const colors: Colors = { ...c.paints };
      for (const role of ROLES) colors[role] = schemes[mech]![bay.accents[role]]!;
      for (const p of bay.items) {
        b.place(home.x + p.at[0], home.z + p.at[1], p.turnDegrees);
        BUILDERS[p.kind](b, colors);
      }
    }
    for (const p of c.workshop) {
      b.place(p.at[0], p.at[1], p.turnDegrees);
      BUILDERS[p.kind](b, c.paints);
    }
    for (const who of c.engineers.people) {
      b.place(who.at[0], who.at[1], who.turnDegrees, c.engineers.height / 1.8);
      engineer(b, who, c.engineers.paints, c.paints.screen, c.paints.crate);
    }

    // One material per kind of drawing, coloured per corner: the toon fill with its outline, and flat light.
    const fill = toon.ownMaterial("#ffffff");
    fill.vertexColors = true;
    // The shell outline darkens white; coloured per corner it darkens each colour, as the per-paint outlines do.
    const shared = toon.shellOutline("#ffffff");
    const outline = shared.clone();
    outline.onBeforeCompile = shared.onBeforeCompile;
    outline.customProgramCacheKey = shared.customProgramCacheKey;
    outline.vertexColors = true;
    const solid = coloured(b.solid, toon);
    this.group.add(new THREE.Mesh(solid, fill), new THREE.Mesh(solid, outline));
    if (b.light.meshes.length > 0) this.group.add(new THREE.Mesh(coloured(b.light, toon), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
    this.charge = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    if (b.charge.meshes.length > 0) this.group.add(new THREE.Mesh(coloured(b.charge, toon), this.charge));
    freeze(this.group);
  }

  update(seconds: number, _dt: number, still: boolean): void {
    const { low, seconds: period } = this.pulse;
    const wave = still ? 1 : 0.5 + 0.5 * Math.sin((seconds / period) * Math.PI * 2);
    this.charge.color.setScalar(low + (1 - low) * wave);
  }
}

// The meshes as one geometry with each one's colour on its corners (linear, as three expects vertex colours).
function coloured(bucket: Bucket, toon: Toon): THREE.BufferGeometry {
  const geometry = toGeometry(bucket.meshes);
  const colors = new Float32Array(geometry.attributes.position!.count * 3);
  const color = new THREE.Color();
  let v = 0;
  bucket.meshes.forEach((m, i) => {
    color.set(toon.color(bucket.colors[i]!));
    for (let k = 0; k < m.positions.length; k += 3, v += 3) { colors[v] = color.r; colors[v + 1] = color.g; colors[v + 2] = color.b; }
  });
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}
