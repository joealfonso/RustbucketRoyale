// Builds the Rustbucket (gate 16b): the junkyard mothership every mech rides in before the drop, and the scrap
// cannon that fires them out of it. A long riveted barge hull patched with plates that never matched, containers
// stacked on deck and strapped to its sides, two lattice cranes and a gantry on top, the pilot's bridge at the bow,
// four tired turbofans on outriggers holding it up and two rocket pods pushing it along. Underneath hang the loading
// bay (a gondola where the mechs wait in their cradles) and behind it the cannon: a mass driver of pipes and copper
// coils, about 60 m long, pointing down and back, with hazard stripes on its breech and muzzle.
// Metres, Y up, facing -Z (the bow), right side +X; the origin is the middle of the hull, where the ship flies.
// Run: npx tsx scripts/ships/rustbucket.ts  →  assets/models/ship/Ship_Rustbucket.glb and data/shipKit.json
//
// The look: it is seen from 250 to 900 m below, so the silhouette carries it: the long hull, the four round engines,
// the cranes poking up past the edges and the cannon hanging out underneath, the one shape nothing else has. From
// the bay, where riders sit, it is seen from a few metres, so the bay has the detail: rivets, stripes, lamps, beams.
// Paint is value-split like the mechs (docs/MECH_ROSTER.md): light cream, crane yellow and hazard yellow; mid hull
// grey, faded green, blue and red plates, rust and copper; dark iron, soot and rubber. The lamps are flat lit colour.
//
// Levels of detail: the same build runs three times. The nearest keeps rivets, lattices, fan blades, railings and
// cables; the middle drops those and keeps fewer plates and ribs; the far one keeps the masses (about 1,500
// triangles). Each part is one paint, so the ship is a handful of draw calls.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { parseHardSurfaceLook } from "../assets/hardSurface";
import { convex, empty, prism, triangles, type V3 } from "../../packages/client/src/dressing/shapes";

type UV = [number, number];
type Level = 0 | 1 | 2;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
const round3 = (p: V3): V3 => p.map((v) => Math.round(v * 1000) / 1000) as V3;

// Plate sizes and offsets come from a fixed seed, so every run writes the same ship.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A solid through matching rings of points in order, capped at both ends.
function loft(rings: V3[][]): MeshData {
  const faces: V3[][] = [rings[0]!, rings.at(-1)!];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!, b = rings[r + 1]!;
    for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; faces.push([a[i]!, a[j]!, b[j]!, b[i]!]); }
  }
  return convex(faces);
}

// Unit axes across a run along `dir`: the first as near `side` as it can be, the second square to both.
function across(dir: V3, side: V3): [V3, V3] {
  let w = sub(side, scale(dir, dot(side, dir)));
  if (Math.hypot(...w) < 1e-6) w = cross(dir, Math.abs(dir[1]) < 0.9 ? Y : X);
  w = norm(w);
  return [w, norm(cross(dir, w))];
}

// A straight bar from a to b, `w` across it along the axis nearest `side` and `h` square to that.
function bar(a: V3, b: V3, side: V3, w: number, h: number): MeshData {
  const [ex, ey] = across(norm(sub(b, a)), side);
  const rect = (c: V3) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => add(c, add(scale(ex, (u! * w) / 2), scale(ey, (v! * h) / 2))));
  return loft([rect(a), rect(b)]);
}

// A round bar from a to b (a pipe, a nacelle, a coil), `rb` its radius at b.
function rod(a: V3, b: V3, r: number, sides: number, rb = r): MeshData {
  const d = norm(sub(b, a));
  const [u, v] = across(d, Math.abs(d[1]) < 0.9 ? Y : X);
  const circle = (c: V3, radius: number) => Array.from({ length: sides }, (_, i) => {
    const t = ((i + 0.5) / sides) * Math.PI * 2;
    return add(c, add(scale(u, Math.cos(t) * radius), scale(v, Math.sin(t) * radius)));
  });
  return loft([circle(a, r), circle(b, rb)]);
}

// A box from its min and max corners.
function boxAt(min: V3, max: V3): MeshData {
  return prism([[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]], "z", min[2], max[2]);
}

// A box turned to any frame: `c` its middle, `ex ey ez` its unit axes and `s` its size along them.
function orientedBox(c: V3, ex: V3, ey: V3, ez: V3, s: V3): MeshData {
  const corner = (i: number, j: number, k: number) => add(c, add(scale(ex, (i * s[0]) / 2), add(scale(ey, (j * s[1]) / 2), scale(ez, (k * s[2]) / 2))));
  const p = [-1, 1].flatMap((i) => [-1, 1].flatMap((j) => [-1, 1].map((k) => corner(i, j, k))));
  const [a, b, cc, d, e, f, g, h] = p as [V3, V3, V3, V3, V3, V3, V3, V3];
  return convex([[a, b, d, cc], [e, g, h, f], [a, e, f, b], [cc, d, h, g], [a, cc, g, e], [b, f, h, d]]);
}

// A flat convex polygon on a surface, lifted `t` off it along `n`: a plate, a stripe, a decal.
function plate(points: V3[], n: V3, t: number): MeshData {
  const top = points.map((p) => add(p, scale(n, t)));
  return convex([points, top, ...points.map((_, i) => { const j = (i + 1) % points.length; return [points[i]!, points[j]!, top[j]!, top[i]!]; })]);
}

// Many meshes as one, by loops: the ship's parts are too big for merge's argument spreading.
function joinMeshes(meshes: MeshData[]): MeshData {
  const out = empty();
  for (const m of meshes) {
    const base = out.positions.length / 3;
    for (const v of m.positions) out.positions.push(v);
    for (const v of m.normals) out.normals.push(v);
    for (const i of m.indices) out.indices.push(i + base);
  }
  return out;
}

// ---- The layout every level shares.
// The hull's cross-section: a flat keel, chamfered bilges (seen from below), straight sides and a chamfered deck edge.
const HULL: UV[] = [[-10, -8], [10, -8], [15, -3], [15, 9], [13, 11], [-13, 11], [-15, 9], [-15, -3]];
const PROW: UV[] = [[-3, 1], [3, 1], [6, 4], [6, 11], [4, 13], [-4, 13], [-6, 11], [-6, 4]];
const HULL_BOW = -50, HULL_STERN = 56, PROW_TIP = -72, DECK = 11;
// The loading bay hangs under the front half; the cannon's breech sits just behind it.
// Its back end (`port` to z1) is the gun port: no floor, no back wall, open below and behind round the cannon's
// breech. The cradles face it, the way their mechs will go.
const BAY = { x: 10, z0: -36, port: -5, z1: 4, floor: -17, ceiling: -8, keel: -20 };
const CRADLE_X = [-4.5, 4.5], CRADLE_Z = [-32.5, -27.5, -22.5, -17.5, -12.5, -7.5];
const BAY_MIDDLE: V3 = [0, BAY.floor, (CRADLE_Z[0]! + CRADLE_Z.at(-1)!) / 2];
// The cannon: down and back at 25 degrees, from the breech to the end of its muzzle brake.
const AIM = norm([0, -Math.sin((25 * Math.PI) / 180), Math.cos((25 * Math.PI) / 180)]);
// The breech sits low and behind the bay, small enough that riders see past it from the gun port.
const BREECH: V3 = [0, -14, 7], BREECH_R = 3.6;
const along = (t: number): V3 => add(BREECH, scale(AIM, t));
// A rider's eye over the gun port's lip, beside the breech, looking down the barrel at the ground it fires at.
// Beside the breech rather than behind it (from behind, the breech fills the view), high and back from the lip.
const BAY_CAMERA: V3 = [7, BAY.ceiling - 2, BAY.port - 1];
// Turned a little out from the barrel and down, so the barrel runs down the right of the frame to the ground.
const BAY_LOOK = norm([0.15, -0.5, 0.85]);
const BARREL_END = 56, MUZZLE_END = 60;
// Turbofans: exhaust down and a little back, as if they both hold it up and push it.
const THRUST = norm([0, -Math.cos((20 * Math.PI) / 180), Math.sin((20 * Math.PI) / 180)]);
const FANS: V3[] = [[-27, 3, -26], [27, 3, -26], [-27, 3, 30], [27, 3, 30]];
const FAN_R = 6.2;
const ROCKETS: V3[] = [[-7, 3, 58], [7, 3, 58]];
const ROCKET_LENGTH = 14, BELL_LENGTH = 4;

interface PartLook { paint: string; finish?: "paint" | "metal" | "rubber"; glow?: true }
const PARTS = {
  Hull: { paint: "hull", finish: "paint" },
  Plates_Green: { paint: "green", finish: "paint" },
  Plates_Blue: { paint: "blue", finish: "paint" },
  Plates_Red: { paint: "red", finish: "paint" },
  Plates_Cream: { paint: "cream", finish: "paint" },
  Crane: { paint: "crane", finish: "paint" },
  Hazard: { paint: "hazard", finish: "paint" },
  Stripes: { paint: "stripe", finish: "paint" },
  Rust: { paint: "rust", finish: "metal" },
  Coils: { paint: "coil", finish: "metal" },
  Iron: { paint: "iron", finish: "metal" },
  Soot: { paint: "soot", finish: "metal" },
  Steel: { paint: "steel", finish: "metal" },
  Glass: { paint: "glass", finish: "metal" },
  Rubber: { paint: "rubber", finish: "rubber" },
  Lamps: { paint: "lamp", glow: true },
  Nav_Red: { paint: "navRed", glow: true },
  Nav_Green: { paint: "navGreen", glow: true },
} satisfies Record<string, PartLook>;
type PartName = keyof typeof PARTS;
const PLATE_PARTS: PartName[] = ["Plates_Green", "Plates_Blue", "Plates_Red", "Plates_Cream", "Rust"];

const scheme = {
  hull: "#77736A", // weathered grey, the mid value most of the ship sits at
  green: "#5F7C63",
  blue: "#4A7896",
  red: "#A23B2C",
  cream: "#DCCFA8",
  crane: "#D9A324",
  hazard: "#FFC93C",
  stripe: "#1E1C1A",
  rust: "#C4622D",
  coil: "#B5793F",
  iron: "#3B3633",
  soot: "#26231F",
  steel: "#9AA1A4",
  glass: "#2B3438",
  rubber: "#1F2123",
  lamp: "#FFD27A",
  navRed: "#E8442E",
  navGreen: "#5BD46A",
};

function build(lv: Level): Record<PartName, MeshData> {
  const near = lv === 0, far = lv === 2;
  const parts = Object.fromEntries(Object.keys(PARTS).map((k) => [k, [] as MeshData[]])) as Record<PartName, MeshData[]>;
  const put = (part: PartName, mesh: MeshData) => parts[part].push(mesh);
  const sides = (n: number) => [n, Math.max(6, Math.round(n * 0.6)), Math.max(5, Math.round(n * 0.4))][lv]!;
  const random = rng(16_2);

  // Yellow and black diagonal stripes in a band on a surface: a yellow strip with black parallelograms on it.
  // `o` is the band's start, `u` along it, `v` across it, `n` out of the surface.
  const hazardBand = (o: V3, u: V3, v: V3, n: V3, length: number, width: number, stripe: number) => {
    const p = (a: number, b: number) => add(o, add(scale(u, a), scale(v, b)));
    put("Hazard", plate([p(0, 0), p(length, 0), p(length, width), p(0, width)], n, 0.12));
    const lift = add(o, scale(n, 0.12));
    const q = (a: number, b: number) => add(lift, add(scale(u, a), scale(v, b)));
    // At the far level the stripes are under a pixel: the yellow alone says "danger".
    if (far) return;
    for (let a = stripe * 0.5; a + stripe + width * 0.6 < length; a += stripe * 2) {
      put("Stripes", plate([q(a, 0), q(a + stripe, 0), q(a + stripe + width * 0.6, width), q(a + width * 0.6, width)], n, 0.04));
    }
  };

  // ---- Hull: the long barge body, the raised prow and the stern block that carries the rockets.
  put("Hull", prism(HULL, "z", HULL_BOW, HULL_STERN));
  put("Hull", loft([HULL.map(([x, y]) => [x, y, HULL_BOW] as V3), PROW.map(([x, y]) => [x, y, PROW_TIP] as V3)]));
  put("Iron", prism(HULL.map(([x, y]) => [x * 0.8, y * 0.8 + 1] as UV), "z", HULL_STERN, HULL_STERN + 4));
  // The keel strip and a bumper bar across the prow's tip: dark lines that draw the hull's length from below.
  put("Iron", boxAt([-4, -8.7, -48], [4, -7.9, 54]));
  put("Iron", boxAt([-6.4, 1.5, PROW_TIP - 0.8], [6.4, 4.5, PROW_TIP + 0.4]));
  hazardBand([-6, 5, PROW_TIP - 0.01], X, Y, [0, 0, -1], 12, 3.5, 1.4);

  // Frame ribs every few metres round the sides and bilges, the riveted seams of a hull plated in sections.
  const ribEvery = [7, 14, 0][lv]!;
  if (ribEvery > 0) for (let z = HULL_BOW + 4; z < HULL_STERN - 2; z += ribEvery) {
    for (const s of [-1, 1]) {
      put("Iron", bar([s * 15.15, -3, z], [s * 15.15, 9, z], Z, 0.6, 0.35));
      put("Iron", bar([s * 10, -8.1, z], [s * 15.1, -3, z], Z, 0.6, 0.35));
    }
  }
  // Seam straps along the bilge and deck edges.
  if (!far) for (const s of [-1, 1]) {
    put("Iron", bar([s * 15.1, -3, HULL_BOW], [s * 15.1, -3, HULL_STERN], Y, 0.7, 0.4));
    put("Iron", bar([s * 15.1, 9, HULL_BOW], [s * 15.1, 9, HULL_STERN], Y, 0.7, 0.4));
  }

  // Patch plates that never matched: on the sides, on the bilges (what the ground sees) and on the keel flat.
  // The far level keeps the biggest few, enough to break the hull into colours.
  const sideFrame = (s: number) => ({ u: Z, v: Y, n: [s, 0, 0] as V3, at: (a: number, b: number): V3 => [s * 15, b, a] });
  const bilgeFrame = (s: number) => {
    const n = norm([s, -1, 0]);
    const v = norm([s * 5, 5, 0]);
    return { u: Z, v, n, at: (a: number, b: number): V3 => add([s * 10, -8, a], scale(v, b)) };
  };
  const keelFrame = { u: Z, v: X, n: [0, -1, 0] as V3, at: (a: number, b: number): V3 => [b, -8, a] };
  const patch = (f: { u: V3; v: V3; n: V3; at: (a: number, b: number) => V3 }, a0: number, a1: number, b0: number, b1: number, part: PartName) => {
    const tilt = (random() - 0.5) * 0.3; // a plate tacked on a little crooked
    const pts = [f.at(a0, b0), f.at(a1, b0 + tilt), f.at(a1, b1 + tilt), f.at(a0, b1)];
    put(part, plate(pts, f.n, 0.2 + random() * 0.15));
  };
  const plateCount = [26, 14, 3][lv]!;
  for (const s of [-1, 1]) {
    for (let i = 0; i < plateCount; i++) {
      const w = 6 + random() * 9, a0 = HULL_BOW + random() * (HULL_STERN - HULL_BOW - w);
      const h = 3 + random() * 6, b0 = -2.5 + random() * (11 - h);
      patch(sideFrame(s), a0, a0 + w, b0, b0 + h, PLATE_PARTS[(i + (s > 0 ? 2 : 0)) % PLATE_PARTS.length]!);
    }
    for (let i = 0; i < Math.ceil(plateCount / 2); i++) {
      const w = 7 + random() * 10, a0 = HULL_BOW + random() * (HULL_STERN - HULL_BOW - w);
      patch(bilgeFrame(s), a0, a0 + w, 0.4 + random() * 1.2, 4.5 + random() * 2, PLATE_PARTS[(i * 3 + (s > 0 ? 1 : 0)) % PLATE_PARTS.length]!);
    }
  }
  for (let i = 0; i < Math.ceil(plateCount / 3); i++) {
    const w = 8 + random() * 12, a0 = 2 + random() * (HULL_STERN - 4 - w); // behind the bay, between the struts
    const b0 = -9 + random() * 10;
    patch(keelFrame, a0, a0 + w, b0, b0 + 3 + random() * 4, PLATE_PARTS[(i + 1) % PLATE_PARTS.length]!);
  }
  // Rust streaks running down from the deck edge, where water has run for years.
  if (!far) for (let i = 0; i < [18, 8, 0][lv]!; i++) {
    const s = i % 2 ? 1 : -1, z = HULL_BOW + 3 + random() * (HULL_STERN - HULL_BOW - 6), len = 3 + random() * 5, w = 0.5 + random() * 0.8;
    put("Rust", plate([[s * 15, 9 - len, z], [s * 15, 9 - len, z + w * 0.6], [s * 15, 9, z + w], [s * 15, 9, z]], [s, 0, 0], 0.42));
  }

  // Running lamps along both deck edges, and the port and starboard lights at the prow.
  const lampEvery = [16, 16, 200][lv]!; // far: one pair, the rest are under a pixel
  for (let z = HULL_BOW + 6; z < HULL_STERN; z += lampEvery) for (const s of [-1, 1]) put("Lamps", boxAt([s > 0 ? 15.2 : -15.6, 9.8, z - 0.4], [s > 0 ? 15.6 : -15.2, 10.4, z + 0.4]));
  put("Nav_Red", boxAt([-6.6, 10, PROW_TIP + 1], [-5.8, 11.2, PROW_TIP + 2.6]));
  put("Nav_Green", boxAt([5.8, 10, PROW_TIP + 1], [6.6, 11.2, PROW_TIP + 2.6]));

  // ---- Deck: containers in stacks of one to three, a gantry over them and two lattice cranes.
  const containerParts: PartName[] = ["Plates_Blue", "Plates_Red", "Plates_Green", "Plates_Cream", "Rust"];
  const columns = [-10.6, -7.8, -5, 5, 7.8, 10.6], rows = [-24, -11, 14, 27, 40];
  rows.forEach((z, r) => columns.forEach((x, c) => {
    const height = 1 + Math.floor(random() * 3), skew = (random() - 0.5) * 0.8;
    if (random() < 0.18) return; // a gap where a container was lifted out
    for (let k = 0; k < height; k++) {
      const part = containerParts[(r * 7 + c * 3 + k) % containerParts.length]!;
      const y = DECK + k * 2.6;
      // The far level draws each stack as one block, the colour of its bottom container.
      if (far && k > 0) continue;
      const top = far ? y + height * 2.6 : y + 2.55;
      const shift = k * skew * 0.4;
      put(part, boxAt([x - 1.25, y, z - 6.1 + shift], [x + 1.25, top, z + 6.1 + shift]));
      if (near) put("Iron", boxAt([x - 1.3, y, z - 6.15 + shift], [x + 1.3, y + 2.55, z - 5.9 + shift])); // door end frame
    }
  }));

  // Containers strapped to the hull sides, low where the ground sees them.
  for (const s of [-1, 1]) for (const z of [-40, 2, 44]) {
    const part = s < 0 ? (z > 0 ? "Plates_Red" : "Plates_Blue") : (z > 0 ? "Plates_Green" : "Plates_Cream");
    put(part, boxAt([s > 0 ? 15.2 : -17.8, -1, z - 6.1], [s > 0 ? 17.8 : -15.2, 1.6, z + 6.1]));
    if (!far) for (const dz of [-3.5, 3.5]) put("Iron", boxAt([s > 0 ? 15.1 : -18, -1.2, z + dz - 0.25], [s > 0 ? 18 : -15.1, 1.8, z + dz + 0.25]));
  }

  // The gantry: a portal frame across the deck, iron with a hazard band on its beam and a trolley under it.
  const gz = 0.5, gTop = DECK + 13;
  for (const s of [-1, 1]) put("Iron", bar([s * 13.5, DECK, gz], [s * 13.5, gTop, gz], Z, 1.6, 1.6));
  put("Iron", boxAt([-14.4, gTop - 0.4, gz - 1], [14.4, gTop + 1.6, gz + 1]));
  hazardBand([-12, gTop - 0.2, gz - 1.01], X, Y, [0, 0, -1], 24, 1.6, 1);
  put("Crane", boxAt([2, gTop - 2.6, gz - 1.4], [5, gTop - 0.4, gz + 1.4]));
  if (!far) put("Steel", rod([3.5, gTop - 2.6, gz], [3.5, DECK + 6, gz], 0.08, 4));

  // Lattice cranes: a square tower, a cab that slews, a jib out over the side and a counter-jib with its weight.
  const crane = (base: V3, heading: number, jibLength: number, hang: "container" | "magnet") => {
    const towerTop = DECK + 16, w = 1.6;
    const out: V3 = [Math.cos(heading), 0, Math.sin(heading)];
    const legs: V3[] = [[-w, 0, -w], [w, 0, -w], [w, 0, w], [-w, 0, w]];
    if (far) put("Crane", boxAt([base[0] - w, DECK, base[2] - w], [base[0] + w, towerTop, base[2] + w]));
    else {
      legs.forEach((l) => put("Crane", bar(add(base, [l[0], DECK, l[2]]), add(base, [l[0], towerTop, l[2]]), X, 0.4, 0.4)));
      if (near) for (let y = DECK; y < towerTop - 1; y += 4) legs.forEach((l, i) => {
        const m = legs[(i + 1) % 4]!;
        put("Crane", bar(add(base, [l[0], y, l[2]]), add(base, [m[0], y + 4, m[2]]), Y, 0.22, 0.22));
      });
    }
    const pivot = add(base, [0, towerTop, 0]);
    put("Plates_Cream", orientedBox(add(pivot, [0, 1.4, 0]), out, Y, cross(out, Y), [5, 2.8, 3.6]));
    if (near) put("Glass", orientedBox(add(pivot, add(scale(out, 2.55), [0, 1.8, 0])), out, Y, cross(out, Y), [0.1, 1.1, 3]));
    const jibRoot = add(pivot, add(scale(out, 2), [0, 2.4, 0]));
    const tip = add(jibRoot, add(scale(out, jibLength * Math.cos(0.2)), [0, jibLength * Math.sin(0.2), 0]));
    const side = cross(out, Y);
    if (near) {
      // Three chords and zigzag braces: a triangle-section lattice.
      const chords = [add(scale(side, 0.8), [0, -0.7, 0]), add(scale(side, -0.8), [0, -0.7, 0]), [0, 0.7, 0] as V3];
      chords.forEach((c) => put("Crane", bar(add(jibRoot, c), add(tip, scale(c, 0.4)), Y, 0.3, 0.3)));
      for (let t = 0; t < 1; t += 0.12) {
        const a = lerp(jibRoot, tip, t), b = lerp(jibRoot, tip, t + 0.12), k = 1 - t * 0.6;
        put("Crane", bar(add(a, scale(chords[0]!, k)), add(b, scale(chords[2]!, k)), side, 0.16, 0.16));
        put("Crane", bar(add(a, scale(chords[1]!, k)), add(b, scale(chords[2]!, k)), side, 0.16, 0.16));
      }
    } else put("Crane", bar(jibRoot, tip, side, 1.6, 1.4));
    const back = add(pivot, add(scale(out, -9), [0, 2.4, 0]));
    put("Crane", bar(add(pivot, [0, 2.4, 0]), back, side, 1.2, 0.9));
    put("Iron", orientedBox(add(back, [0, -0.6, 0]), out, Y, side, [2.4, 2.6, 2.4]));
    // The cable and what hangs on it: a container over the side, or a scrap magnet.
    const hookY = DECK + 2;
    const hook: V3 = [tip[0], hookY, tip[2]];
    put("Steel", rod(tip, hook, far ? 0.25 : 0.12, far ? 4 : 5));
    put("Iron", boxAt(add(hook, [-0.8, -1.2, -0.8]), add(hook, [0.8, 0, 0.8])));
    if (hang === "container") {
      put("Plates_Red", orientedBox(add(hook, [0, -3.4, 0]), out, Y, side, [2.5, 2.6, 12.2]));
      if (!far) for (const c of [-1, 1]) put("Steel", rod(add(hook, [0, -1.2, 0]), add(hook, add(scale(side, c * 5.8), [0, -2.1, 0])), 0.06, 4));
    } else {
      put("Iron", rod(add(hook, [0, -1.4, 0]), add(hook, [0, -2.4, 0]), 2.2, sides(12)));
      put("Rust", rod(add(hook, [0, -2.4, 0]), add(hook, [0, -2.6, 0]), 2.0, sides(12)));
    }
  };
  crane([-5, 0, 8], Math.PI, 30, "container");
  crane([6, 0, 34], -0.5, 26, "magnet");

  // The bridge at the bow: a cream block with a wider cab on top, its windows a dark band, a mast with a beacon.
  put("Plates_Cream", boxAt([-8, DECK, -44], [8, DECK + 8, -30]));
  put("Plates_Cream", loft([
    [[-10, DECK + 8, -32], [10, DECK + 8, -32], [10, DECK + 14, -32], [-10, DECK + 14, -32]],
    [[-10, DECK + 8, -45], [10, DECK + 8, -45], [10, DECK + 14, -47], [-10, DECK + 14, -47]],
  ]));
  put("Glass", plate([[-9.6, DECK + 10.6, -45.4], [9.6, DECK + 10.6, -45.4], [9.6, DECK + 13.2, -46.85], [-9.6, DECK + 13.2, -46.85]], norm([0, 0.5, -0.9]), 0.1));
  for (const s of [-1, 1]) put("Glass", boxAt([s > 0 ? 10 : -10.1, DECK + 10.5, -43], [s > 0 ? 10.1 : -10, DECK + 13, -34]));
  put("Iron", boxAt([-10.6, DECK + 14, -47.6], [10.6, DECK + 14.8, -31.4]));
  for (const s of [-1, 1]) put("Iron", boxAt([s > 0 ? 10 : -14, DECK + 9.4, -44], [s > 0 ? 14 : -10, DECK + 10, -40])); // bridge wings
  put("Steel", rod([0, DECK + 14.8, -38], [0, DECK + 26, -38], 0.3, sides(6), 0.15));
  put("Steel", bar([-3, DECK + 23, -38], [3, DECK + 23, -38], Z, 0.2, 0.2));
  put("Nav_Red", boxAt([-0.4, DECK + 26, -38.4], [0.4, DECK + 26.8, -37.6]));
  if (near) for (let x = -8; x <= 8; x += 4) put("Lamps", boxAt([x - 0.4, DECK + 6, -44.25], [x + 0.4, DECK + 6.5, -44.05]));

  // Two stovepipe funnels at the stern, leaning back, rust with sooty mouths.
  for (const s of [-1, 1]) {
    const foot: V3 = [s * 5, DECK, 46], mouth: V3 = [s * 5.4, DECK + 11, 48];
    put("Rust", rod(foot, mouth, 2.2, sides(12), 2.0));
    put("Soot", rod(mouth, add(mouth, [0, 1.4, 0.25]), 2.3, sides(12)));
  }

  // ---- Engines. Turbofans on outriggers: a fat nacelle, a steel intake lip with its fan, a sooty nozzle with a
  // plug, a hazard band and a rust ring. Each is a little different, being salvage.
  const nacelleParts: PartName[] = ["Hull", "Plates_Green", "Plates_Blue", "Hull"];
  FANS.forEach((c, i) => {
    const s = Math.sign(c[0]);
    const top = add(c, scale(THRUST, -6)), bottom = add(c, scale(THRUST, 5));
    put(nacelleParts[i]!, rod(top, bottom, FAN_R, sides(18)));
    put("Steel", rod(add(c, scale(THRUST, -6.9)), add(c, scale(THRUST, -5.6)), FAN_R + 0.6, sides(18)));
    if (!far) put("Soot", rod(add(c, scale(THRUST, -5.7)), add(c, scale(THRUST, -5.5)), FAN_R - 0.3, sides(18))); // fan face
    if (!far) put("Steel", rod(add(c, scale(THRUST, -5.6)), add(c, scale(THRUST, -7.4)), 1.6, sides(10), 0.2)); // spinner
    if (near) for (let b = 0; b < 14; b++) {
      const [u, v] = across(THRUST, X), t = (b / 14) * Math.PI * 2;
      const dir = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
      const hub = add(c, scale(THRUST, -5.8));
      put("Steel", orientedBox(add(hub, scale(dir, 3.4)), dir, cross(THRUST, dir), THRUST, [4.6, 1.1, 0.12]));
    }
    put("Soot", rod(bottom, add(c, scale(THRUST, 8)), FAN_R - 0.8, sides(18), FAN_R - 1.8));
    put("Iron", rod(add(c, scale(THRUST, 6)), add(c, scale(THRUST, 9.6)), 2.5, sides(10), 0.6)); // exhaust plug
    if (!far) {
      put("Hazard", rod(add(c, scale(THRUST, -4.6)), add(c, scale(THRUST, -3.4)), FAN_R + 0.12, sides(18)));
      put("Rust", rod(add(c, scale(THRUST, 2 + (i % 2))), add(c, scale(THRUST, 3.2 + (i % 2))), FAN_R + 0.1, sides(18)));
    }
    if (near && i === 2) put("Plates_Red", plate( // a patch bolted over a hole on one tired engine
      [add(c, [s * -FAN_R * 0.2, -1, -FAN_R - 0.05]), add(c, [s * FAN_R * 0.5, -1, -FAN_R + 0.3]), add(c, [s * FAN_R * 0.5, 2.5, -FAN_R + 0.3]), add(c, [s * -FAN_R * 0.2, 2.5, -FAN_R - 0.05])],
      [0, 0, -1], 0.2));
    // The outrigger: a box beam out of the hull and a brace under it, both into the nacelle's side.
    put("Iron", bar([s * 14.5, 3, c[2]], [s * (Math.abs(c[0]) - FAN_R + 0.5), 3, c[2]], Z, 6, 2.4));
    put("Iron", bar([s * 14.5, -3.5, c[2]], [s * (Math.abs(c[0]) - FAN_R + 0.8), 0.5, c[2]], Z, 1.4, 1.2));
    if (!far) hazardBand([s * 15.2, 4.21, c[2] - 3], [s, 0, 0], Z, Y, Math.abs(c[0]) - FAN_R - 15.5, 6, 0.9);
    // A lamp under the nacelle lip, so the four engines read at dusk.
    put(i % 2 ? "Nav_Green" : "Nav_Red", boxAt(add(c, [s * FAN_R - 0.4, -0.4, -0.4]), add(c, [s * FAN_R + 0.4 * s + (s > 0 ? 0 : 0.8), 0.4, 0.4])));
  });

  // Rocket pods on the stern: long cans with flared bells and hazard rings.
  ROCKETS.forEach((c, i) => {
    const end = add(c, [0, 0, ROCKET_LENGTH]);
    put(i ? "Plates_Red" : "Plates_Blue", rod(c, end, 3, sides(14)));
    put("Soot", rod(end, add(end, [0, 0, BELL_LENGTH]), 2.2, sides(14), 3.4));
    put("Steel", rod(add(c, [0, 0, -1]), c, 2.4, sides(14), 3)); // nose cap
    if (!far) put("Hazard", rod(add(c, [0, 0, 9]), add(c, [0, 0, 10.5]), 3.1, sides(14)));
    if (!far) put("Iron", bar([c[0], c[1] - 3, c[2] + 6], [c[0] * 0.6, -2, HULL_STERN + 1], X, 1.2, 1.2));
  });

  // Fuel tanks slung under the bow, forward of the bay.
  for (const s of [-1, 1]) {
    put("Plates_Cream", rod([s * 5, -10.4, -48], [s * 5, -10.4, -38.5], 2.2, sides(12)));
    if (!far) for (const z of [-45, -41]) put("Iron", bar([s * 5, -8, z], [s * 5, -8.6, z], X, 1.4, 1.6));
  }

  // ---- The loading bay: a gondola under the hull, open at the sides above a railing and open below and behind
  // round the breech (the gun port), so riders see the barrel and the world they are about to be fired into. A floor
  // of cradles, hazard edges, girders and lamps overhead.
  const { x: bx, z0, port, z1, floor, ceiling, keel } = BAY;
  put("Plates_Green", prism([[-bx, floor], [bx, floor], [bx - 2, keel], [-bx + 2, keel]], "z", z0, port));
  if (!far) put("Steel", boxAt([-bx, floor - 0.3, z0], [bx, floor, port])); // the deck plate
  hazardBand([-bx + 2, keel - 0.01, z0 + 1], Z, X, [0, -1, 0], port - z0 - 2, 2 * bx - 4, 2.4); // seen from the ground
  // The gun port's lip: a striped edge to the floor and a dark lip under it, so the drop reads as a drop.
  hazardBand([-bx + 0.4, floor, port - 1.6], X, Z, Y, 2 * bx - 0.8, 1.6, 0.7);
  put("Iron", boxAt([-bx, keel, port], [bx, floor - 0.3, port + 0.5]));
  for (const s of [-1, 1]) {
    // Floor edges: a stripe band each side, inside, where riders look down.
    hazardBand([s * (bx - 1.6), floor, z0 + 0.5], Z, [s, 0, 0], Y, port - z0 - 2.3, 1.4, 0.6);
    // Wall plating up to the railing along the whole bay (past the floor too, so the gun port is a well and not a
    // gap), a different paint each side, and the rail.
    put(s < 0 ? "Plates_Blue" : "Plates_Red", boxAt([s > 0 ? bx - 0.4 : -bx, floor, z0], [s > 0 ? bx : -bx + 0.4, floor + 3.4, z1]));
    put("Plates_Green", boxAt([s > 0 ? bx - 0.4 : -bx, keel + 1, port], [s > 0 ? bx : -bx + 0.4, floor, z1]));
    if (!far) put("Steel", rod([s * (bx - 0.2), floor + 4.2, z0], [s * (bx - 0.2), floor + 4.2, z1], 0.12, 6));
    // Posts from the wall's foot to the hull every few metres.
    const postEvery = far ? 20 : 6.6;
    for (let z = z0; z <= z1 + 0.01; z += postEvery) put("Iron", boxAt([s > 0 ? bx - 0.6 : -bx, z > port ? keel + 1 : floor, Math.min(z, z1 - 0.6)], [s > 0 ? bx : -bx + 0.6, ceiling, Math.min(z + 0.6, z1)]));
  }
  // The front wall, a slit window across it; a striped beam across the open back, under the hull.
  put("Plates_Cream", boxAt([-bx, floor, z0 - 0.4], [bx, floor + 5, z0]));
  put("Plates_Cream", boxAt([-bx, floor + 7, z0 - 0.4], [bx, ceiling, z0]));
  put("Glass", boxAt([-bx, floor + 5, z0 - 0.3], [bx, floor + 7, z0 - 0.1]));
  put("Iron", boxAt([-bx, ceiling - 1.2, z1 - 0.8], [bx, ceiling, z1]));
  hazardBand([-bx, ceiling - 1.2, z1 + 0.01], X, Y, Z, 2 * bx, 1.2, 0.6);
  // The loading tray, down which a mech in its shell slides from the port's lip into the breech.
  put("Iron", bar([0, floor - 0.2, port], along(-4.4), Y, 4.6, 0.6));
  // Ceiling girders across the bay, lamps hung between them, two pipes and a crane rail along it.
  if (!far) for (let z = z0 + 2; z < z1 - 1; z += 4) put("Iron", boxAt([-bx, ceiling - 0.9, z - 0.35], [bx, ceiling, z + 0.35]));
  // Inside the bay is out of sight from the ground, so the far level leaves out what only riders see.
  if (!far) for (let z = z0 + 4; z < port; z += 8) for (const x of [-5, 5]) {
    put("Lamps", boxAt([x - 0.9, ceiling - 1.6, z - 0.4], [x + 0.9, ceiling - 1.3, z + 0.4]));
    put("Iron", boxAt([x - 1.1, ceiling - 1.3, z - 0.55], [x + 1.1, ceiling - 0.9, z + 0.55]));
  }
  if (!far) {
    put("Rust", rod([-8, ceiling - 0.6, z0], [-8, ceiling - 0.6, z1], 0.35, sides(8)));
    put("Steel", rod([-7.1, ceiling - 0.5, z0], [-7.1, ceiling - 0.5, z1], 0.22, sides(8)));
    put("Crane", boxAt([-0.3, ceiling - 1.6, z0 + 1], [0.3, ceiling - 0.9, port]));
    put("Crane", boxAt([-1.2, ceiling - 2.4, -24], [1.2, ceiling - 1.6, -22]));
  }
  // The cradles: a low pad, a back frame and two clamp arms that hold a mech by the shoulders until it is fired.
  if (!far) for (const x of CRADLE_X) for (const z of CRADLE_Z) {
    put("Iron", boxAt([x - 1.8, floor, z - 1.8], [x + 1.8, floor + 0.3, z + 1.8]));
    put("Crane", boxAt([x - 1.9, floor, z - 2.3], [x - 1.4, floor + 4.6, z - 1.8]));
    put("Crane", boxAt([x + 1.4, floor, z - 2.3], [x + 1.9, floor + 4.6, z - 1.8]));
    put("Crane", boxAt([x - 1.9, floor + 4.2, z - 2.3], [x + 1.9, floor + 4.6, z - 1.8]));
    if (near) {
      for (const s of [-1, 1]) put("Iron", bar([x + s * 1.65, floor + 3.6, z - 2], [x + s * 1.3, floor + 3.6, z + 0.4], Y, 0.3, 0.3));
      hazardBand([x - 1.8, floor + 0.3, z + 1.2], X, Z, Y, 3.6, 0.6, 0.35);
      put("Lamps", boxAt([x - 0.2, floor + 4.6, z - 2.2], [x + 0.2, floor + 4.9, z - 1.9]));
    }
  }
  // Rivets along the floor edges and the gun port's lip: they are seen from a few metres.
  if (near) {
    for (let z = z0 + 0.6; z < port; z += 1.2) for (const s of [-1, 1]) put("Iron", boxAt([s * (bx - 1.9) - 0.08, floor, z - 0.08], [s * (bx - 1.9) + 0.08, floor + 0.08, z + 0.08]));
    for (let x = -bx + 0.6; x < bx; x += 1.2) put("Iron", boxAt([x - 0.08, floor - 1.2, port + 0.5], [x + 0.08, floor - 1.04, port + 0.6]));
  }

  // ---- The scrap cannon: a breech block, a long iron barrel with copper coils every few metres and four rails
  // along it, collars and struts that hang it from the hull, cables to the breech, and a striped muzzle brake.
  put("Plates_Red", rod(along(-4), along(5), BREECH_R, sides(16)));
  if (!far) put("Iron", rod(along(-4.6), along(-3.6), BREECH_R + 0.4, sides(16)));
  if (!far) put("Iron", rod(along(4.6), along(5.6), BREECH_R + 0.4, sides(16)));
  // A stripe band down each flat side of the breech, square to the barrel.
  const upAlong: V3 = [0, AIM[2], -AIM[1]];
  for (const s of [-1, 1]) hazardBand(add(along(-2.5), add([s * (BREECH_R + 0.05), 0, 0], scale(upAlong, -1.2))), AIM, upAlong, [s, 0, 0], 6, 2.4, 0.8);
  put("Iron", rod(along(5), along(BARREL_END), 2.4, sides(14)));
  // The coils are what makes it read as a cannon from the ground, so even the far level keeps every other one.
  const coilEvery = [3.5, 5, 7][lv]!;
  for (let t = 8; t < BARREL_END - 4; t += coilEvery) put("Coils", rod(along(t), along(t + 1.8), 3.6, sides(14)));
  if (!far) {
    const [u, v] = across(AIM, X);
    for (const a of [0.25, 0.75, 1.25, 1.75]) {
      const off = add(scale(u, Math.cos(a * Math.PI) * 3), scale(v, Math.sin(a * Math.PI) * 3));
      put("Steel", rod(add(along(5), off), add(along(BARREL_END), off), 0.35, sides(6)));
    }
    for (const t of [20, 38]) put("Crane", orientedBox(along(t + 1), u, v, AIM, [7.4, 7.4, 1.8])); // collars
  }
  // Struts from the keel down to the barrel at a third and two thirds along it.
  for (const [t, z] of [[21, 22], [40, 46]] as const) for (const s of [-1, 1]) put("Iron", bar([s * 7, -8, z], add(along(t + 1), [s * 3.2, 0, 0]), Z, 1.2, 1.2));
  // Muzzle brake: a flared can banded yellow, black, yellow, with ports cut along its sides.
  put("Iron", rod(along(BARREL_END), along(MUZZLE_END), 3, sides(14), 4));
  put("Hazard", rod(along(BARREL_END - 3), along(BARREL_END - 2), 2.9, sides(14)));
  put("Stripes", rod(along(BARREL_END - 2), along(BARREL_END - 1), 2.9, sides(14)));
  put("Hazard", rod(along(BARREL_END - 1), along(BARREL_END), 2.9, sides(14)));
  if (near) for (const s of [-1, 1]) for (const t of [56.8, 58.2]) put("Soot", orientedBox(add(along(t), [s * 3.45, 0, 0]), X, cross(AIM, X), AIM, [0.4, 1.4, 0.8]));
  // Cables from the hull to the breech, sagging.
  // The far level keeps one, so the hoses have a simpler level at all.
  for (const x of far ? [0] : [-2.4, 0, 2.4]) {
    const a: V3 = [x, -8, -2 + Math.abs(x)], b = add(along(1), [x, BREECH_R - 0.4, 0]);
    const m = add(lerp(a, b, 0.5), [0, -1.2, 0]);
    put("Rubber", joinMeshes([rod(a, m, 0.35, far ? 4 : sides(6)), rod(m, b, 0.35, far ? 4 : sides(6))]));
  }

  return Object.fromEntries(Object.entries(parts).map(([k, list]) => [k, joinMeshes(list)])) as Record<PartName, MeshData>;
}

// Each part at its nearest level, then each simpler level while it has fewer triangles than the one before. The game
// reads <Part>_LOD1 and then <Part>_LOD2, stopping at the first missing one, and a part keeps its last level farther out.
function withLevels(levels: Record<PartName, MeshData>[]): { nodes: NodeData[]; totals: number[] } {
  const nodes: NodeData[] = [];
  const totals = [0, 0, 0];
  for (const name of Object.keys(PARTS) as PartName[]) {
    let last = levels[0]![name];
    // Indices are written as 16-bit, so no part may hold more than 65,536 corners.
    for (const lv of levels) if (lv[name].positions.length / 3 > 65535) throw new Error(`${name} has too many corners for 16-bit indices`);
    if (triangles(last) === 0) throw new Error(`${name} is empty at the nearest level`);
    nodes.push({ name, mesh: last });
    totals[0]! += triangles(last);
    let simpler = true;
    for (const lv of [1, 2] as const) {
      const mesh = levels[lv]![name];
      simpler &&= triangles(mesh) > 0 && triangles(mesh) < triangles(last);
      if (simpler) { nodes.push({ name: `${name}_LOD${lv}`, mesh }); last = mesh; }
      totals[lv]! += triangles(last);
    }
  }
  return { nodes, totals };
}

// The named points the game hangs things on. The ship's nose is -Z, like the mechs'. Directions go in data/shipKit.json beside them, because the model's
// nodes carry no turn (glbWrite writes positions only); Mount_Cannon_Breech also gives the barrel's line in the model.
const muzzle = along(MUZZLE_END);
const fanExhausts = FANS.map((c) => add(c, scale(THRUST, 8)));
const rocketExhausts = ROCKETS.map((c) => add(c, [0, 0, ROCKET_LENGTH + BELL_LENGTH]));
const engines = [...fanExhausts.map((at) => ({ at, direction: THRUST })), ...rocketExhausts.map((at) => ({ at, direction: Z }))];
const slots = CRADLE_Z.flatMap((z) => CRADLE_X.map((x) => [x, BAY.floor + 0.3, z] as V3));
const markers: NodeData[] = [
  { name: "Mount_Cannon_Muzzle", translation: round3(muzzle) },
  { name: "Mount_Cannon_Breech", translation: round3(BREECH) },
  { name: "Mount_Bay", translation: round3(BAY_MIDDLE) },
  { name: "Mount_Camera", translation: round3(BAY_CAMERA) },
  ...slots.map((at, i) => ({ name: `Mount_Slot_${i + 1}`, translation: round3(at) })),
  ...engines.map((e, i) => ({ name: `Mount_Engine_${i + 1}`, translation: round3(e.at) })),
];

// The ship's chamfers are plate edges a few times a mech's, so a wider face still counts as a worn edge.
const look = JSON.parse(readFileSync(new URL("../../data/look.json", import.meta.url), "utf8"));
const mechSurface = parseHardSurfaceLook(look.mech?.normals);
const surface = { ...mechSurface, wearWidthMeters: mechSurface.wearWidthMeters * 4 };

const levels = [build(0), build(1), build(2)];
const ship = withLevels(levels);
const root = new URL("../..", import.meta.url).pathname;
const dir = join(root, "assets/models/ship");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Ship_Rustbucket.glb"), writeGlb([...ship.nodes, ...markers], { quantize: true, hardSurface: surface }));

// The kit in the same form as data/mechKits.json, so the client's kit loader reads it as it is. Every part is in
// the torso zone (the loader needs one) and never hit. The levels switch further out than a mech's: the ship is
// fifty times a mech's length and seen from hundreds of metres.
const kit = {
  lodDistances: [320, 700],
  kits: {
    rustbucket: {
      file: "models/ship/Ship_Rustbucket.glb",
      scheme,
      parts: Object.fromEntries(Object.entries(PARTS as Record<string, PartLook>).map(([name, p]) => [name, { zone: "torso", paint: p.paint, ...(p.finish ? { finish: p.finish } : {}), ...(p.glow ? { glow: true } : {}), rusts: false, noHit: true }])),
    },
  },
  // The same points as the model's Mount_ nodes, with the directions the nodes cannot carry.
  mounts: {
    cannonMuzzle: { at: round3(muzzle), direction: round3(AIM) },
    cannonBreech: { at: round3(BREECH) },
    bay: { at: round3(BAY_MIDDLE) },
    // A rider's eye over the gun port, looking down the barrel.
    camera: { at: round3(BAY_CAMERA), look: round3(BAY_LOOK) },
    slots: slots.map(round3),
    engines: engines.map((e) => ({ at: round3(e.at), direction: round3(e.direction) })),
  },
};
writeFileSync(join(root, "data/shipKit.json"), `${JSON.stringify(kit, null, 2)}\n`);

console.log(`Wrote Ship_Rustbucket.glb to ${dir}: ${ship.totals.join(" / ")} triangles drawn near / middle / far`);
for (const name of Object.keys(PARTS) as PartName[]) console.log(`  ${name.padEnd(14)} ${levels.map((l) => String(triangles(l[name])).padStart(6)).join(" ")}`);
