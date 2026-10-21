// Builds the Ironclad-IV, the heavy brawler (docs/MECH_ROSTER.md, section 1): a square-shouldered block of dark grey
// plating with yellow and black hazard stripes on the shoulders and shins, a small head sunk deep in the torso with
// one red eye, a rotary autocannon in the right forearm, a blunt-edged siege shield with a pile driver on the left,
// two missile pods set into the upper torso blocks, and stocky reverse-jointed legs with exposed pistons.
// Every part is built in place on the assembled mech (metres, Y up, facing -Z, right side +X, feet at y 0), one merged
// mesh per part and one paint per part. Zones, paints and flags are in scripts/mechs/ironclad.kit.json.
// Run: npx tsx scripts/mechs/ironclad.ts
//
// The look (gate V7c): big calm armour masses built as separate chamfered plates, so the outline draws a seam wherever
// two plates meet, and the detail kept to a few places that do a job: bolts where a plate is held on, the hydraulics
// at the knee and the gun arm's ammo feed. The shoulder walls and the tall shield are the shape that reads from far.
//
// Gate V8 (more complex geometry): the same masses, now built the way a heavy machine is: armour in layers (a plate
// bolted over a plate, the shield's fronts faced with applique plates and a hardened ramming edge), the hydraulics out
// in the open (a second knee ram inside each leg, the shield arm's lifting ram, the pile driver's clamps, accumulator
// and return guides), hoses and cables that run from where the pressure or power is made to where it is used, a real
// rotary gun (rotor, bored barrels, motor) and missile pods with their launch tubes.
//
// Gate V9 (readability): the shape before the detail. Seen as a flat black cut-out at 50 and 150 m the V8 build was a
// crate, so the shoulders now overhang wider and stand taller than the head, the torso narrows to the waist, the gun is
// fatter with a shroud over its barrels, the reverse knee kicks back to a point, and the feet are longer and wider. The
// bolts, rivets, slats and fins that were gone by 20 m came out: the painted atlas draws rivets and plate seams on every
// mech up close. The shield's caps and middle band are hazard yellow, so the slab reads as the Ironclad's from far off.
//
// Gate V10 (near budget 10k to 15k): the extra triangles went into big round forms and real depth that read at 5 to
// 25 m, not detail. The autocannon's barrels are round, with muzzle collars, bores and a stepped clamp ring, under a
// shroud that is a curved plate; the pods' launch tubes stand in a recess behind a raised frame, with bores; the eye
// is a lens standing out of a collared housing; the jet nozzles are bells with throats; the shield is built in steps (a lipped back
// plate, layered appliques, ribbed caps and band, a bevelled steel blade); the leg rams are thicker, turned, with
// collars; the ankle armour is layered; and the joints, drums and hoses have more sides. The middle level keeps the
// same outline: the barrels' drum reaches the new muzzle, the shield's yellow is cut back the same way and its ribs
// and back plate are there as plain blocks.
//
// Levels of detail: the same build runs three times. The nearest keeps the bevels, bolts, hoses and rivets; the middle
// (past 25 m, data/mechKits.json lodDistances) keeps the new plates, rams and the pile driver's housing as plain shapes
// but drops the small parts and turns the gun's six barrels into one drum; the far one (past 80 m) keeps only plain
// blocks for the masses that make the silhouette.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { bothLegs } from "./joints";
import { leftOf, piston } from "./motion";
import { box, convex, cylinder, empty, merge, mirrorX, prism, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

type UV = [number, number];
type Axis = "x" | "y" | "z";
type Level = 0 | 1 | 2;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const along = (a: V3, d: V3, s: number): V3 => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
// The point `s` metres from `a` toward `b`.
const toward = (a: V3, b: V3, s: number): V3 => along(a, norm(sub(b, a)), s);

// Both sides of a pair from the right-hand (+X) version.
const pair = (right: MeshData) => merge(right, mirrorX(right));

// A bevelled box from its min and max corners, which reads more easily than centre and size for stacked plating.
function slab(min: V3, max: V3, bevel = 0): MeshData {
  return box([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], [max[0] - min[0], max[1] - min[1], max[2] - min[2]], bevel);
}

// A mesh built upright round y = z = 0 (its long axis on +Y), tilted in the side view and moved so it runs from the
// lower point `b` up to the upper point `a`. The legs are made of these, since the knee bends back.
function between(a: V3, b: V3, mesh: MeshData): MeshData {
  const tilt = Math.atan2(a[2] - b[2], a[1] - b[1]);
  return turn(mesh, [tilt, 0, 0], [0, 0, 0], [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}
const length = (a: V3, b: V3) => Math.hypot(a[1] - b[1], a[2] - b[2]);

const signedArea = (o: UV[]) => o.reduce((s, p, i) => { const q = o[(i + 1) % o.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const area = (o: UV[]) => Math.abs(signedArea(o));

// A convex outline with every edge moved inward by `c` (outward when negative), corners kept sharp.
function inset(outline: UV[], c: number): UV[] {
  if (c === 0) return outline;
  const turnSign = signedArea(outline) > 0 ? 1 : -1;
  const lines = outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length]!;
    const d: UV = [q[0] - p[0], q[1] - p[1]];
    const l = Math.hypot(d[0], d[1]);
    return { p: [p[0] - (d[1] / l) * c * turnSign, p[1] + (d[0] / l) * c * turnSign] as UV, d };
  });
  return lines.map((line, i) => {
    const prev = lines[(i - 1 + lines.length) % lines.length]!;
    const t = ((line.p[0] - prev.p[0]) * line.d[1] - (line.p[1] - prev.p[1]) * line.d[0]) / (prev.d[0] * line.d[1] - prev.d[1] * line.d[0]);
    return [prev.p[0] + prev.d[0] * t, prev.p[1] + prev.d[1] * t];
  });
}

// The outline with its two points farthest along -z (the blade's front corners) each cut off by `c` along both edges.
function bevelTip(outline: UV[], c: number): UV[] {
  const tips = outline.map((p, i) => [p[0], i] as const).sort((a, b) => a[0] - b[0]).slice(0, 2).map(([, i]) => i);
  return outline.flatMap((p, i) => {
    if (!tips.includes(i)) return [p];
    const prev = outline[(i - 1 + outline.length) % outline.length]!, next = outline[(i + 1) % outline.length]!;
    const toward = (q: UV): UV => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]); return [p[0] + ((q[0] - p[0]) / l) * c, p[1] + ((q[1] - p[1]) / l) * c]; };
    return [toward(prev), toward(next)];
  });
}

// The outward unit normal of an outline's edge `i` (from point i to point i + 1).
function edgeOut(outline: UV[], i: number): UV {
  const p = outline[i]!, q = outline[(i + 1) % outline.length]!;
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const s = signedArea(outline) > 0 ? 1 : -1;
  return [((q[1] - p[1]) / l) * s, (-(q[0] - p[0]) / l) * s];
}

// A rectangle u0..u1 by v0..v1 with its corners cut off at 45 degrees, the cut sizes in corner order (u0 v0), (u1 v0),
// (u1 v1), (u0 v1). Cut corners are what make a block of plating read as angled armour rather than a crate.
function cut(u0: number, u1: number, v0: number, v1: number, cuts: number | [number, number, number, number]): UV[] {
  const [a, b, c, d] = typeof cuts === "number" ? [cuts, cuts, cuts, cuts] : cuts;
  const out: UV[] = [];
  const corner = (k: number, first: UV, second: UV, at: UV) => { if (k > 0) out.push(first, second); else out.push(at); };
  corner(a, [u0, v0 + a], [u0 + a, v0], [u0, v0]);
  corner(b, [u1 - b, v0], [u1, v0 + b], [u1, v0]);
  corner(c, [u1, v1 - c], [u1 - c, v1], [u1, v1]);
  corner(d, [u0 + d, v1], [u0, v1 - d], [u0, v1]);
  // Two cuts that meet along one side leave one corner, not two on the same spot: a zero-length edge has no direction,
  // and the chamfer in `block` would turn the whole part into NaN.
  return out.filter((p, i) => { const q = out[(i + out.length - 1) % out.length]!; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9; });
}

// A convex outline swept along an axis, as `prism` in shapes.ts, with every edge chamfered by `c`: the caps are the
// outline moved in by `c`, so a plate has no razor edge and its face stays flat (the serial numbers sit on faces).
function block(outline: UV[], axis: Axis, from: number, to: number, c = 0): MeshData {
  if (c <= 0) return prism(outline, axis, from, to);
  const at = (u: number, v: number, w: number): V3 => (axis === "x" ? [w, u, v] : axis === "y" ? [v, w, u] : [u, v, w]);
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const small = inset(outline, c);
  const rings = ([[small, lo], [outline, lo + c], [outline, hi - c], [small, hi]] as [UV[], number][]).map(([o, w]) => o.map(([u, v]) => at(u, v, w)));
  const faces: V3[][] = [rings[0]!, rings[3]!];
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      faces.push([rings[k]![i]!, rings[k]![j]!, rings[k + 1]![j]!, rings[k + 1]![i]!]);
    }
  }
  return convex(faces);
}

// A round bar from `a` to `b` in any direction (a hose, a piston, a bolt), `rb` its radius at `b`.
function rod(a: V3, b: V3, r: number, sides: number, rb = r): MeshData {
  const d = norm(sub(b, a));
  const u = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const v = cross(d, u);
  const ring = (c: V3, radius: number) => Array.from({ length: sides }, (_, i) => {
    const t = ((i + 0.5) / sides) * Math.PI * 2;
    return along(along(c, u, Math.cos(t) * radius), v, Math.sin(t) * radius);
  });
  const ra = ring(a, r), rb2 = ring(b, rb);
  return convex([ra, rb2, ...ra.map((_, i) => { const j = (i + 1) % sides; return [ra[i]!, ra[j]!, rb2[j]!, rb2[i]!]; })]);
}

// A hose or cable through `points`: one straight run between each pair of points, the runs meeting in a ring that lies
// in the plane halfway between them, so a bend has no gap and no overlap. Each run is its own convex piece (a straight
// tube is convex, a bent one is not), and only the two ends are capped.
function hose(points: V3[], r: number, sides: number): MeshData {
  const runs = points.slice(1).map((p, i) => norm(sub(p, points[i]!)));
  let u = norm(cross(runs[0]!, Math.abs(runs[0]![1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const rings = points.map((c, i) => {
    const before = runs[Math.max(0, i - 1)]!, after = runs[Math.min(runs.length - 1, i)]!;
    const mitre = norm(add(before, after));
    // Carried along from the last ring, so the hose does not twist round itself.
    u = norm(sub(u, along([0, 0, 0], before, dot(u, before))));
    const v = cross(before, u);
    return Array.from({ length: sides }, (_, k) => {
      const t = ((k + 0.5) / sides) * Math.PI * 2;
      const p = along(along(c, u, Math.cos(t) * r), v, Math.sin(t) * r);
      return along(p, before, -dot(sub(p, c), mitre) / dot(before, mitre));
    });
  });
  return merge(...runs.map((_, i) => {
    const a = rings[i]!, b = rings[i + 1]!;
    const faces = a.map((_, k) => { const j = (k + 1) % sides; return [a[k]!, a[j]!, b[j]!, b[k]!]; });
    if (i === 0) faces.push(a);
    if (i === runs.length - 1) faces.push(b);
    return convex(faces);
  }));
}

// A round solid turned about the line from `a` to `b`, from its profile: [metres from `a`, radius] pairs walked from
// the `a` end along the outside. A collar or a step is one more pair, and a profile that turns back inward at the far
// end (a smaller radius, then a few centimetres back toward `a`) leaves a real bore with a floor, so a barrel, a tube
// or a nozzle has a mouth with depth instead of a painted disc. It is not convex, so it is wound by hand: each band
// faces out of the profile, the cap at `a` faces back along the axis and the last ring's cap (the end, or the bore's
// floor) faces forward. `caps` leaves either end open.
function lathe(a: V3, b: V3, profile: [number, number][], sides: number, caps: [boolean, boolean] = [true, true]): MeshData {
  const d = norm(sub(b, a));
  const u = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const v = cross(d, u);
  const rings = profile.map(([s, r]) => Array.from({ length: sides }, (_, k) => {
    const t = ((k + 0.5) / sides) * Math.PI * 2;
    return along(along(along(a, d, s), u, Math.cos(t) * r), v, Math.sin(t) * r);
  }));
  const faces: V3[][] = [];
  if (caps[0] && profile[0]![1] > 0) faces.push([...rings[0]!].reverse());
  for (let i = 0; i + 1 < rings.length; i++) {
    const p = rings[i]!, q = rings[i + 1]!;
    for (let k = 0; k < sides; k++) { const j = (k + 1) % sides; faces.push([p[k]!, p[j]!, q[j]!, q[k]!]); }
  }
  if (caps[1] && profile[profile.length - 1]![1] > 0) faces.push(rings[rings.length - 1]!);
  return wound(faces);
}

// A solid from faces already wound counter-clockwise as seen from outside, each a flat convex polygon. `convex` turns
// faces away from the middle, which would turn a bore's walls inside out.
function wound(faces: V3[][]): MeshData {
  const out = empty();
  for (const face of faces) {
    const n = norm(cross(sub(face[1]!, face[0]!), sub(face[2]!, face[0]!)));
    const base = out.positions.length / 3;
    for (const p of face) { out.positions.push(...p); out.normals.push(...n); }
    for (let i = 1; i < face.length - 1; i++) out.indices.push(base, base + i, base + i + 1);
  }
  return out;
}

// A curved plate: the part of a thick ring round the z axis at (`cx`, `cy`) from angle `a0` to `a1` (radians, from
// +x toward +y), radii `ri` to `ro`, from z0 to z1 (z0 < z1). The autocannon's shroud is one, so it has a real
// thickness and an open underside.
function arcShell(cx: number, cy: number, ri: number, ro: number, a0: number, a1: number, z0: number, z1: number, segments: number): MeshData {
  const at = (r: number, t: number, z: number): V3 => [cx + Math.cos(t) * r, cy + Math.sin(t) * r, z];
  const ts = Array.from({ length: segments + 1 }, (_, i) => a0 + ((a1 - a0) * i) / segments);
  const faces: V3[][] = [];
  for (let i = 0; i < segments; i++) {
    const [t0, t1] = [ts[i]!, ts[i + 1]!];
    faces.push([at(ro, t0, z0), at(ro, t1, z0), at(ro, t1, z1), at(ro, t0, z1)]); // outside
    faces.push([at(ri, t0, z0), at(ri, t0, z1), at(ri, t1, z1), at(ri, t1, z0)]); // inside, facing the axis
    faces.push([at(ri, t0, z0), at(ri, t1, z0), at(ro, t1, z0), at(ro, t0, z0)]); // the end at z0
    faces.push([at(ri, t0, z1), at(ro, t0, z1), at(ro, t1, z1), at(ri, t1, z1)]); // the end at z1
  }
  faces.push([at(ri, a0, z0), at(ro, a0, z0), at(ro, a0, z1), at(ri, a0, z1)]);
  faces.push([at(ri, a1, z0), at(ri, a1, z1), at(ro, a1, z1), at(ro, a1, z0)]);
  // Which way round each face is wound depends on the direction the arc runs; flip the lot if the outside faces in.
  const m = wound(faces);
  const n0: V3 = [m.normals[0]!, m.normals[1]!, m.normals[2]!], mid = (a0 + a0 + (a1 - a0) / segments) / 2;
  return dot(n0, [Math.cos(mid), Math.sin(mid), 0]) > 0 ? m : wound(faces.map((f) => [...f].reverse()));
}

// A mesh built flat in a face's own frame (x along the face, y up it, z out of it) and laid onto that face at
// `origin`. The shield's fronts are slanted, so their applique plates are made square and then turned onto them.
function onFace(mesh: MeshData, origin: V3, u: V3, v: V3, n: V3): MeshData {
  const map = (x: number, y: number, z: number, o: V3): V3 => [0, 1, 2].map((k) => o[k]! + u[k]! * x + v[k]! * y + n[k]! * z) as V3;
  const out = empty();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    out.positions.push(...map(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!, origin));
    out.normals.push(...map(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!, [0, 0, 0]));
  }
  // A left-handed frame mirrors the mesh, which would turn its faces inside out.
  const mirrored = dot(cross(u, v), n) < 0;
  for (let i = 0; i < mesh.indices.length; i += 3) out.indices.push(mesh.indices[i]!, mesh.indices[i + (mirrored ? 2 : 1)]!, mesh.indices[i + (mirrored ? 1 : 2)]!);
  return out;
}

// The part of a convex outline where `keep` is not negative (one Sutherland-Hodgman pass against a straight line).
function clip(outline: UV[], keep: (p: UV) => number): UV[] {
  const out: UV[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!, q = outline[(i + 1) % outline.length]!;
    const kp = keep(p), kq = keep(q);
    if (kp >= 0) out.push(p);
    if ((kp >= 0) !== (kq >= 0)) { const t = kp / (kp - kq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

// Hazard stripes: the yellow bands of 45 degree stripes across the rectangle u0..u1 by v0..v1, `width` wide with
// black gaps of the same width. Slivers cut off at the corners are dropped, as they would be thinner than a plate.
function stripes(u0: number, u1: number, v0: number, v1: number, width: number): UV[][] {
  const rect: UV[] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const out: UV[][] = [];
  for (let s = u0 - v1 + width * 0.5; s < u1 - v0; s += width * 2) {
    const band = clip(clip(rect, ([u, v]) => u - v - s), ([u, v]) => s + width - (u - v));
    if (band.length >= 3 && area(band) > width * width * 0.6) out.push(band);
  }
  return out;
}

// A stripe panel on one face: a black backing plate and the yellow stripes standing a little proud of it. `axis` is
// the face's normal, `at` the face's position along it and `out` +1 or -1 for which way the face looks.
function hazardPanel(axis: Axis, at: number, out: number, u: [number, number], v: [number, number], width: number) {
  const back = prism([[u[0], v[0]], [u[1], v[0]], [u[1], v[1]], [u[0], v[1]]], axis, at - out * 0.04, at + out * 0.04);
  const yellow = merge(...stripes(u[0], u[1], v[0], v[1], width).map((o) => prism(o, axis, at - out * 0.02, at + out * 0.07)));
  return { black: back, yellow };
}

// ---- Fixed points the game reads: the gun's muzzle and the leg joints. They are the same at every level of detail.
// Shots leave from the muzzle (scripts/make-hitboxes.ts copies Mount_Gun into data/mechKits.json). Gate V9 moved it
// 0.25 m forward from -1.65: longer barrels, so the gun reads past the forearm in the side view. Gate V10 set the
// clamp ring back and gave each barrel a muzzle collar standing 6 cm past where the ring was, which is where it is now.
const GUN: V3 = [1.2, 2.4, -1.96];
// The hip, a knee that sits well back, and an ankle forward of it, so the knee bends backward and the side view shows
// it. Right side.
const LX = 0.57;
const HIP: V3 = [LX, 1.46, 0], KNEE: V3 = [LX, 0.92, 0.28], ANKLE: V3 = [LX, 0.34, -0.1];
const SHIN_W = 0.5, SHIN_D = 0.44;
const thighLength = length(HIP, KNEE), shinLength = length(KNEE, ANKLE);
// The point a fraction `t` of the way down the bone from `a` to `b` in the side view, moved `back` metres toward the
// back and set at `x` across.
const onBone = (a: V3, b: V3, t: number, back: number, x: number): V3 => [x, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t + back];
// The leg rams' mounts: the knee rams' sleeves hang from the thigh and their rods are pinned to the shin, the calf
// ram's sleeve is on the shin and its rod on the heel. The game aims each end at the other (gate V9b, motion below).
const ramTop = onBone(HIP, KNEE, 0.18, -0.07, 0), ramFoot = onBone(KNEE, ANKLE, 0.62, -0.12, 0);
const calfTop = onBone(KNEE, ANKLE, 0.2, 0.2, LX), calfFoot: V3 = [LX, 0.3, ANKLE[2] + 0.32];
const SHIELD_EDGE_X = -1.4;
const PILE: [number, number] = [SHIELD_EDGE_X, 2.5];
const UP: V3 = [0, 1, 0];

function build(lv: Level): Record<string, MeshData> {
  const near = lv === 0, far = lv === 2;
  const only = (make: () => MeshData) => (near ? make() : empty()); // small detail, nearest level only
  const notFar = (make: () => MeshData) => (far ? empty() : make());
  const bev = (b: number) => (near ? b : 0); // bevels and chamfers are a pixel or two past 25 m
  const sides = (n: number) => [n, Math.min(n, 6), 4][lv]!;
  // A hose: round near (ten-sided), four-sided past 25 m, and past 80 m one straight three-sided run from end to end. The hoses
  // are parts of their own (rubber, not painted metal), and a part needs some mesh at every level, so the far one is
  // the cheapest that is still there.
  const line = (points: V3[], r: number) => (far ? rod(points[0]!, points[points.length - 1]!, r, 3) : hose(points, r, near ? 10 : 4));

  // The bottom edge of each slat in the jet housings' back vents. Three, not more: the slots between them must stay
  // wider than the mech outline (4 cm) or it draws over them.
  const ventSlats = [2.12, 2.27, 2.42];
  // ---- Torso: a core hull wrapped in plates, each its own block so the seams between them show. Two big upper
  // armour blocks at the corners hold the missile pods; the head sits between them, behind a chin guard and under a
  // brow hood, so only a slit shows.
  const torso = merge(
    // Core hull, its lower corners cut well back, so the chest narrows into the waist: broad shoulders over a small
    // waist is the brawler's shape, and it opens a gap between the arms and the legs that the outline shows.
    block(cut(-0.8, 0.8, 1.7, 2.86, [0.24, 0.24, 0.06, 0.06]), "z", -0.5, 0.5, bev(0.06)),
    // Belly in two bands, the lower one narrower and cut back underneath so it sheds shots from below.
    block(cut(1.72, 1.96, -0.6, -0.42, [0.08, 0, 0, 0]), "x", -0.48, 0.48, bev(0.03)),
    block(cut(1.99, 2.24, -0.6, -0.42, [0.03, 0, 0, 0]), "x", -0.66, 0.66, bev(0.03)),
    // Chest: two plates meeting in a seam down the middle, their outer corners cut. The left plate's face carries the
    // serial number, so nothing stands on it.
    pair(block(cut(0.02, 0.9, 2.2, 2.74, [0, 0.16, 0.06, 0]), "z", -0.64, -0.4, bev(0.03))),
    block(cut(2.7, 2.96, -0.7, -0.4, [0, 0.1, 0, 0]), "x", -0.36, 0.36, bev(0.03)), // chin guard, sloped on top
    // Brow hood. Gate V10 brought it 6 cm forward, deepening the recess the head looks out of.
    block(cut(3.1, 3.26, -0.72, 0.04, [0.06, 0.04, 0, 0]), "x", -0.38, 0.38, bev(0.02)),
    pair(block(cut(2.08, 2.6, -0.46, 0.42, far ? 0 : 0.04), "x", 0.79, 0.93, bev(0.02))), // flank plates
    pair(slab([0.33, 2.55, -0.63], [0.95, 3.1, 0.52], bev(0.08))), // upper armour blocks
    // Rear cowl behind each pod. Gate V13 sloped its top back edge, so from over the shoulder the top of the back
    // steps down in layers toward the jets instead of ending in two crates.
    pair(block(cut(3.0, 3.3, 0.08, 0.5, [0, 0, 0.14, 0]), "x", 0.36, 0.94, bev(0.05))),
    // A cowl over the back of the head, sloped the same way, between the two upper armour blocks. Gate V13: without
    // it the head's dark back showed between them as a hole in the middle of the view players see most.
    block(cut(2.84, 3.12, 0.1, 0.5, [0, 0, 0.14, 0]), "x", -0.32, 0.32, bev(0.03)),
    // Jump jet housings on the back, deep and sloped off at the top: the hump behind the shoulders in the side view.
    pair(block(cut(1.9, 2.86, 0.48, 0.96, [0, 0, 0.2, 0.06]), "x", 0.18, 0.64, bev(0.05))),
    notFar(() => block(cut(-0.17, 0.17, 2.0, 2.6, 0.04), "z", 0.46, 0.56, bev(0.02))), // reactor access hatch between the jets
    // A second plate over the back of each jet housing, the face a shot from behind meets first. Gate V13: near, it is
    // a frame round a louvred vent (dark slots, Frame below, between sloped slats), so the back reads as jets rather
    // than two plain slabs; past 25 m it stays one plate of the same outline.
    near
      ? pair(merge(
        slab([0.24, 2.0, 0.95], [0.58, 2.06, 1.0], 0.012), // bottom rail
        slab([0.24, 2.52, 0.95], [0.58, 2.58, 1.0], 0.012), // top rail
        ...[[0.24, 0.29], [0.53, 0.58]].map(([x0, x1]) => slab([x0!, 2.06, 0.95], [x1!, 2.52, 1.0], 0.01)), // side rails
        // Slats sloping down and back, the way a vent sheds rain and hides its slot from behind and above.
        ...ventSlats.map((y) => block([[y, 0.955], [y + 0.06, 0.955], [y + 0.03, 1.0], [y - 0.03, 1.0]], "x", 0.29, 0.53, 0.008)),
      ))
      : notFar(() => pair(block(cut(0.24, 0.58, 2.0, 2.58, [0, 0, 0.05, 0.05]), "z", 0.95, 1.0))),
    // A skirt hung from the belly over the waist, between the legs, where the hip bar would otherwise show.
    notFar(() => block(cut(-0.26, 0.26, 1.5, 1.76, [0.08, 0.08, 0, 0]), "z", -0.5, -0.42, bev(0.02))),
  );

  // Head: small and dark, sunk a full 0.28 m behind the brow. Near, the eye is a lens with a bevelled face standing just out of a
  // collared housing, and the walls of the slot the head sits in are lined in the same dark, so the recess reads deep
  // rather than as a grey gap. The housing is solid round the lens rather than a tube the lens sits down inside: the
  // game's outline pushes every face a few cm out (data/look.json outline.mech), and the walls of a bore that narrow
  // would draw their outline over the eye.
  const head = merge(
    slab([-0.26, 2.8, -0.44], [0.26, 3.14, 0.12], bev(0.05)),
    only(() => lathe([0, 3.02, -0.42], [0, 3.02, -0.52], [[0, 0.1], [0.07, 0.1], [0.07, 0.115], [0.1, 0.115]], 16)),
    only(() => pair(slab([0.305, 2.9, -0.62], [0.33, 3.1, -0.2]))),
  );
  const sensor = near
    ? lathe([0, 3.02, -0.43], [0, 3.02, -0.53], [[0, 0.07], [0.08, 0.07], [0.1, 0.06]], 16)
    : cylinder([0, 3.02, -0.48], 0.07, 0.1, "z", sides(16));

  // Missile pods: one box per side, sunk into the top of its armour block and standing out of its front, with the
  // hatch that closes over the launch cells lying on top. Near, the box's front is a raised frame round a recessed
  // launch face, and six launch tubes stand in that recess, their mouths 2 cm inside the frame. The tubes are open
  // at the mouth; their bores are dark cups in the frame below (the same split as the gun's barrels and bores).
  const cellX = [0.52, 0.65, 0.78], cellY = [3.06, 3.24];
  const tubeMouth = -0.7, tubeBore = 0.044, tubeDepth = 0.07;
  const pods = pair(merge(
    near ? merge(
      slab([0.4, 2.92, -0.6], [0.9, 3.38, 0.05], 0.05),
      // The frame round the launch face: top and bottom rails the full width, side rails between them.
      slab([0.4, 3.305, -0.72], [0.9, 3.38, -0.55], 0.02),
      slab([0.4, 2.92, -0.72], [0.9, 2.995, -0.55], 0.02),
      ...[[0.4, 0.455], [0.845, 0.9]].map(([x0, x1]) => slab([x0!, 2.98, -0.72], [x1!, 3.32, -0.55], 0.015)),
      ...cellX.flatMap((x) => cellY.map((y) => lathe([x, y, -0.6], [x, y, tubeMouth], [[0, 0.058], [0.1, 0.058], [0.1, tubeBore]], 10, [true, false]))),
    ) : slab([0.4, 2.92, -0.72], [0.9, 3.38, 0.05]),
    notFar(() => block(cut(-0.62, 0.0, 0.44, 0.86, 0), "y", 3.37, 3.42, bev(0.015))), // hatch
  ));
  // The pilot's marking: one band round the right pod.
  // It stands just above the pod's hatch, so the hatch never hides the marking.
  const accentBand = slab([0.38, 2.96, -0.42], [0.92, 3.44, -0.3], bev(0.02));

  // Frame: waist, hip bar, the pods' launch cells and the jet nozzles, the dark mechanical bits of the torso.
  // Near, the launch face is a dark plate at the back of the pod's recess and each tube's bore is a dark cup 7 cm deep;
  // farther, a dark cell per tube.
  const podCells: MeshData[] = [];
  if (far) podCells.push(slab([0.455, 2.995, -0.75], [0.845, 3.305, -0.68]));
  else if (!near) for (const x of cellX) for (const y of cellY) podCells.push(slab([x - 0.055, y - 0.065, -0.75], [x + 0.055, y + 0.065, -0.68]));
  else {
    podCells.push(slab([0.457, 2.997, -0.62], [0.843, 3.303, -0.598]));
    for (const x of cellX) for (const y of cellY) podCells.push(lathe([x, y, tubeMouth + tubeDepth], [x, y, tubeMouth], [[tubeDepth + 0.001, tubeBore - 0.001], [0, tubeBore - 0.001]], 10, [false, true]));
  }
  const nozzle: V3 = [0.41, 1.82, 0.72];
  const frame = merge(
    slab([-0.45, 1.4, -0.3], [0.45, 1.8, 0.3], bev(0.04)), // waist
    notFar(() => cylinder([0, 1.74, 0], 0.5, 0.1, "y", sides(24))), // slewing ring the torso sits on
    cylinder([0, 1.48, 0], 0.17, 0.62, "x", sides(16)), // hip bar
    pair(merge(...podCells)),
    // Jet nozzles, flared at the bottom. Near, each is a bell with a lip round its mouth and a throat 14 cm deep.
    near
      ? pair(lathe([nozzle[0], 1.92, nozzle[2]], [nozzle[0], 1.71, nozzle[2]], [[0, 0.15], [0.18, 0.195], [0.18, 0.215], [0.21, 0.215], [0.21, 0.17], [0.07, 0.125]], 16))
      : pair(cylinder(nozzle, 0.2, 0.2, "y", sides(10), 0.15)),
    only(() => pair(cylinder([nozzle[0], 1.91, nozzle[2]], 0.18, 0.04, "y", 20))), // nozzle collars, under the housings
    only(() => pair(slab([0.29, 2.06, 0.955], [0.53, 2.52, 0.968]))), // the jet vents' dark slots, behind their slats
  );

  // ---- Arms. Each has a big square pauldron with its top edges sloped off, a shoulder wall on its outer face that
  // stands well up past the head and hangs down over the upper arm (it guards the pods and the head from the side, and
  // is the square shoulder line that reads from far away), an upper arm, a forearm, and joints in the frame.
  const pauldronR = merge(
    block(cut(2.56, 3.26, -0.54, 0.46, [0.06, 0.16, 0.12, 0.06]), "x", 0.9, 1.74, bev(0.06)),
    // A second, thicker plate over its front, the face that takes the most fire.
    notFar(() => block(cut(0.96, 1.68, 2.62, 3.08, [0.08, 0, 0, 0]), "z", -0.61, -0.53, bev(0.015))),
  );
  const wallR = block(cut(1.74, 1.9, 2.4, 3.66, [0, 0.04, 0.04, 0.1]), "z", -0.52, 0.46, bev(0.03));
  const upperArmR = slab([1.02, 2.26, -0.22], [1.42, 2.62, 0.22], bev(0.05));

  // Hazard stripes on each shoulder wall's outer face and the pauldron's top, the faces seen from the side and above.
  // Wide stripes: past 50 m a narrow one is a smear of khaki rather than yellow and black.
  const stripeWidth = [0.13, 0.17, 0.26][lv]!;
  const outerStripes = hazardPanel("x", 1.9, 1, [2.52, 3.56], [-0.42, 0.36], stripeWidth);
  const topStripes = hazardPanel("y", 3.26, 1, [-0.34, 0.3], [0.96, 1.68], stripeWidth);
  // Gate V13: and on the pauldron's back face. Players see their own mech from behind and above, where the back was
  // all dark hull; the stripes now frame the jet pack from that side too, and say Ironclad from behind at 50 m.
  const backStripes = hazardPanel("z", 0.46, 1, [1.0, 1.66], [2.66, 3.1], stripeWidth);

  // Right arm: the forearm is one long housing that the autocannon comes out of, a top plate over the gun's motor
  // and the ammo drum on the outside.
  const armR = merge(
    pauldronR,
    wallR,
    upperArmR,
    slab([0.96, 2.1, -1.0], [1.46, 2.62, -0.1], bev(0.06)), // forearm housing
    notFar(() => block(cut(0.98, 1.44, 2.6, 2.7, [0, 0, 0.04, 0.04]), "z", -0.96, -0.16, bev(0.02))), // top plate
    notFar(() => block(cut(0.98, 1.44, 2.12, 2.6, 0), "z", -1.04, -0.99, bev(0.015))), // face plate round the gun's hub
    cylinder([1.58, 2.36, -0.5], 0.28, 0.24, "x", sides(24)), // ammo drum, big enough to read as a disc from the side
    only(() => cylinder([1.71, 2.36, -0.5], 0.19, 0.04, "x", 24)), // drum lid
  );

  // Rotary autocannon: a hub at the front of the forearm, a rotor ring that turns the barrels, six barrels round a
  // spindle under a shroud that keeps the heat off the forearm, a clamp ring at the shroud's mouth holding the barrels
  // together, and the spin motor under the hub. Near, each barrel is round, ends in a muzzle collar at the gun mount
  // and has a bore 6 cm deep. Past 25 m the barrels are one drum: six bars that thin are lost there anyway.
  const breechZ = -1.0, barrelLength = breechZ - GUN[2], boreDepth = 0.06, boreRadius = 0.034;
  const shroudFront = -1.7, clampZ = -1.76;
  const barrelAt = Array.from({ length: 6 }, (_, i) => [GUN[0] + Math.cos((i / 6) * Math.PI * 2) * 0.15, GUN[1] + Math.sin((i / 6) * Math.PI * 2) * 0.15] as const);
  const barrels: MeshData[] = [];
  if (near) {
    const L = barrelLength;
    // Open at the mouth: the bore's walls are a dark cup in Autocannon_Bores. The game's outline pushes every face 6 cm
    // out (data/look.json), so walls facing into a bore this narrow cross over inside it; in the barrel's own part they
    // would drag its orange mouth's outline in with them as dark spokes, in the dark part they are lost in the dark.
    for (const [x, y] of barrelAt) barrels.push(lathe([x, y, breechZ], [x, y, GUN[2]], [[0, 0.055], [L - 0.075, 0.055], [L - 0.075, 0.07], [L, 0.07], [L, boreRadius]], 16, [true, false]));
    barrels.push(lathe([GUN[0], GUN[1], breechZ], [GUN[0], GUN[1], GUN[2]], [[0, 0.065], [L - 0.14, 0.065], [L - 0.1, 0.035], [L - 0.1, 0]], 12)); // spindle, its nose inside the barrels
  } else barrels.push(cylinder([GUN[0], GUN[1], (GUN[2] + breechZ) / 2], 0.21, barrelLength, "z", sides(8)));
  // The shroud: an arc over the top two thirds of the barrels, open underneath so the lower barrels show. Near it is
  // a curved plate 3.5 cm thick, so the barrels show inside it; farther, a solid of the same outline.
  const [shroudFrom, shroudTo] = [-0.15 * Math.PI, 1.15 * Math.PI];
  const shroud: UV[] = Array.from({ length: 7 }, (_, i) => {
    const a = shroudFrom + ((shroudTo - shroudFrom) * i) / 6;
    return [GUN[0] + Math.cos(a) * 0.25, GUN[1] + Math.sin(a) * 0.25];
  });
  const autocannon = merge(
    cylinder([GUN[0], GUN[1], -1.08], 0.27, 0.18, "z", sides(24)), // hub
    notFar(() => cylinder([GUN[0], GUN[1], -1.2], 0.22, 0.06, "z", sides(24))), // rotor ring
    near ? arcShell(GUN[0], GUN[1], 0.215, 0.25, shroudFrom, shroudTo, shroudFront, -1.24, 14) : notFar(() => block(shroud, "z", shroudFront, -1.24)),
    // Clamp ring, its edges stepped in so it reads as a band rather than a disc.
    near
      ? lathe([GUN[0], GUN[1], clampZ + 0.05], [GUN[0], GUN[1], clampZ - 0.05], [[0, 0.21], [0.02, 0.235], [0.08, 0.235], [0.1, 0.21]], 24)
      : cylinder([GUN[0], GUN[1], clampZ], 0.235, 0.1, "z", sides(14)),
    only(() => cylinder([GUN[0], 2.13, -1.08], 0.09, 0.18, "z", 16)), // spin motor
    ...barrels,
  );

  // Left arm: a shorter forearm with a fist that grips the back of the shield, and a plate over the forearm's outside,
  // the side a flanker sees.
  const armL = merge(
    mirrorX(pauldronR),
    mirrorX(wallR),
    mirrorX(upperArmR),
    slab([-1.44, 1.9, -0.6], [-0.98, 2.38, 0.15], bev(0.05)), // forearm
    slab([-1.42, 1.94, -0.84], [-1.0, 2.32, -0.58], bev(0.05)), // fist
    notFar(() => block(cut(1.96, 2.32, -0.54, -0.04, 0), "x", -1.5, -1.43, bev(0.015))), // outer forearm plate
  );

  // Siege shield: a tall slab whose front comes to a ramming edge (a narrow flat, so it reads sharp without a razor
  // edge). It is capped top and bottom and banded round the middle, the caps standing proud of the slab; the ramming
  // edge is a hardened strip of its own that runs past the caps, the fronts between the bands are faced with applique
  // plates, and two ribs stiffen the back. The caps and band are hazard yellow, a ladder that says Ironclad at 150 m.
  // It hangs low, from the fist, so the shoulder wall stands clear above it in the outline.
  // Gate V10: the slab is built in steps, the way a thick plate is. A back plate 3 cm wider than the slab makes a lip
  // down each side, each applique plate carries a smaller one, the caps and the band each carry a raised rib, and the
  // ramming edge is a steel blade standing 8 cm out of the slab's tip with its front corners bevelled, the yellow cut
  // back flat just behind the tip so the blade runs past it unbroken while the yellow still wraps both fronts.
  // Outlines are (z, x), swept up the y axis.
  const chevron: UV[] = [[-0.8, -2.0], [-0.8, -0.86], [-1.0, -0.86], [-1.22, SHIELD_EDGE_X + 0.04], [-1.22, SHIELD_EDGE_X - 0.04], [-1.0, -2.0]];
  const behindBlade = ([z]: UV) => z + 1.21; // the yellow stops here, so the blade runs past it unbroken
  const yellow = (out: number) => clip(inset(chevron, -out), behindBlade);
  // An applique plate on front face `edge` between two bands, kept clear of the ramming blade at the tip end, with a
  // smaller plate on it.
  const applique = (edge: 2 | 4, y0: number, y1: number) => {
    const p = chevron[edge]!, q = chevron[(edge + 1) % chevron.length]!;
    const run = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const [nz, nx] = edgeOut(chevron, edge);
    const [from, to] = edge === 2 ? [0.08, run - 0.2] : [0.2, run - 0.08];
    const plate = merge(
      block(cut(from, to, y0, y1, 0), "z", 0, 0.04, bev(0.012)),
      only(() => block(cut(from + 0.05, to - 0.05, y0 + 0.08, y1 - 0.08, 0.03), "z", 0.035, 0.06, 0.01)),
    );
    return onFace(plate, [p[1], 0, p[0]], norm([q[1] - p[1], 0, q[0] - p[0]]), UP, [nx, 0, nz]);
  };
  const shield = merge(
    block(chevron, "y", 1.14, 3.26, bev(0.05)),
    // The back plate, 3 cm wider each side than the slab: the lip that shows down both sides.
    notFar(() => slab([-2.03, 1.3, -0.9], [-0.83, 3.1, -0.79], bev(0.015))),
    ...(far ? [] : ([2, 4] as const).flatMap((edge) => [[1.34, 2.06], [2.34, 3.06]].map(([y0, y1]) => applique(edge, y0!, y1!)))),
    notFar(() => merge(...[-1.9, -1.68].map((x) => block(cut(-0.8, -0.68, x - 0.04, x + 0.04, [0, 0.03, 0.03, 0]), "y", 1.2, 3.2, bev(0.012))))), // back ribs
  );
  const shieldBands = merge(
    block(yellow(0.06), "y", 1.1, 1.3, bev(0.02)),
    block(yellow(0.04), "y", 2.1, 2.3, bev(0.02)),
    block(yellow(0.06), "y", 3.1, 3.3, bev(0.02)),
    // The raised ribs round the caps and the band.
    notFar(() => merge(...([[1.14, 1.26, 0.085], [2.15, 2.25, 0.065], [3.14, 3.26, 0.085]] as const).map(([y0, y1, out]) => block(yellow(out), "y", y0, y1, bev(0.015))))),
  );
  // The blade: narrow, set into the slab's tip and standing 8 cm out of it, its two front corners bevelled near.
  const X = SHIELD_EDGE_X;
  const bladeOutline: UV[] = [[-1.1, X - 0.14], [-1.2, X - 0.1], [-1.3, X - 0.03], [-1.3, X + 0.03], [-1.2, X + 0.1], [-1.1, X + 0.14]];
  const ramEdge = block(near ? bevelTip(bladeOutline, 0.02) : bladeOutline, "y", 1.07, 3.33, bev(0.02));

  // Pile driver: a ram cylinder clamped along the top of the fist, its rod cocked out the back, and the spike standing
  // out of the shield's ramming edge through a bushing. A pressure bottle rides on the ram to give each blow its
  // punch; two guide rods keep the cocked rod's crosshead square, and two hydraulic lines run along the ram.
  const [px, py] = PILE;
  const bottleY = py + 0.235;
  const pileDriver = merge(
    // Ram housing with its front and rear collars; near, one turned shape with a step down into the rod's gland.
    ...(near
      ? [lathe([px, py, 0.07], [px, py, -0.79], [[0, 0.2], [0.1, 0.2], [0.1, 0.16], [0.74, 0.16], [0.74, 0.2], [0.84, 0.2], [0.84, 0.16], [0.86, 0.16]], 20)]
      : [
        cylinder([px, py, -0.36], 0.16, 0.86, "z", sides(14)),
        cylinder([px, py, -0.72], 0.2, 0.1, "z", sides(12)),
        cylinder([px, py, 0.02], 0.2, 0.1, "z", sides(12)),
      ]),
    notFar(() => merge(...[-0.48, -0.22].map((z) => cylinder([px, py, z], 0.18, 0.05, "z", sides(20))))), // clamps to the saddle
    cylinder([px, py, 0.28], 0.075, 0.44, "z", sides(16)), // cocked rod
    near ? block(cut(px - 0.17, px + 0.17, py - 0.07, py + 0.07, 0.03), "z", 0.49, 0.57, 0.012) // crosshead
      : notFar(() => cylinder([px, py, 0.53], 0.12, 0.08, "z", sides(8))), // rod cap
    notFar(() => cylinder([px + 0.19, py - 0.12, -0.4], 0.05, 0.6, "z", near ? 10 : 6)), // outer hydraulic line
    // Pressure bottle; near, one turned shape with domed ends.
    near
      ? lathe([px, bottleY, -0.6], [px, bottleY, -0.08], [[0, 0.03], [0.03, 0.06], [0.07, 0.075], [0.45, 0.075], [0.49, 0.06], [0.52, 0.03]], 16)
      : notFar(() => cylinder([px, bottleY, -0.34], 0.075, 0.36, "z", sides(8))),
    cylinder([px, py, -1.32], 0.13, 0.4, "z", sides(16), 0.04), // spike
    notFar(() => cylinder([px, py, -1.31], 0.16, 0.06, "z", sides(20))), // spike bushing on the ramming blade
    slab([-1.5, 2.3, -0.7], [-1.3, 2.38, 0.0]), // saddle on the fist
    only(() => merge(
      ...[-0.13, 0.13].map((dx) => rod([px + dx, py, 0.06], [px + dx, py, 0.5], 0.025, 8)), // guide rods
      cylinder([px - 0.19, py - 0.12, -0.4], 0.05, 0.6, "z", 10), // inner hydraulic line
    )),
  );

  // Arm frame: shoulder and elbow joints, the ammo feed from the drum to the breech, the pistons that hold each
  // forearm up and the ram that lifts the shield.
  const feed = near
    ? merge(...[-0.76, -0.81, -0.86, -0.91, -0.96].map((z) => block(cut(2.3, 2.46, z - 0.022, z + 0.022, 0.012), "x", 1.43, 1.57, 0.01))) // belt chute, in links
    : slab([1.43, 2.3, -0.98], [1.57, 2.46, -0.74]);
  const armFrame = merge(
    pair(cylinder([0.97, 2.84, 0], 0.22, 0.24, "x", sides(20))), // shoulder joints
    cylinder([1.2, 2.4, 0.02], 0.17, 0.5, "x", sides(16)), // right elbow
    cylinder([-1.2, 2.2, 0.1], 0.17, 0.5, "x", sides(16)), // left elbow
    feed,
    // The shield arm's lifting ram, from under the pauldron to the forearm, in front of the upper arm.
    notFar(() => rod([-1.21, 2.64, -0.3], [-1.21, 2.47, -0.34], 0.06, sides(12))),
    notFar(() => rod([-1.21, 2.49, -0.34], [-1.21, 2.36, -0.38], 0.035, near ? 10 : 6)),
    only(() => merge(
      pair(merge(
        rod([1.21, 2.64, 0.28], [1.21, 2.45, 0.27], 0.06, 12), // forearm piston sleeve, under the pauldron
        rod([1.21, 2.47, 0.27], [1.21, 2.28, 0.24], 0.035, 10), // its rod, down to the forearm
      )),
      cylinder([1.465, 2.4, 0.02], 0.1, 0.04, "x", 16), // elbow hub caps
      cylinder([-1.465, 2.2, 0.1], 0.1, 0.04, "x", 16),
    )),
  );

  // The arms' hoses: the gun's power and coolant lines from the torso to the forearm, and the pile driver's pressure
  // hose from the forearm and the line from its bottle to the rear collar.
  const armHoses = merge(
    line([[0.9, 2.3, 0.3], [1.0, 2.18, 0.34], [1.1, 2.08, 0.18], [1.12, 2.1, -0.16]], 0.04), // gun power line
    line([[0.9, 2.22, 0.36], [1.04, 2.12, 0.38], [1.18, 2.03, 0.2], [1.2, 2.06, -0.16]], 0.04), // gun coolant line
    line([[-1.12, 2.36, -0.12], [-1.13, 2.48, -0.03], [-1.19, 2.56, 0.04], [-1.26, 2.57, 0.05]], 0.04), // pressure hose
    notFar(() => hose([[px, bottleY, -0.09], [px, bottleY + 0.03, -0.03], [px, py + 0.19, 0.03]], 0.03, near ? 10 : 4)), // bottle line
  );

  // ---- Legs, right side, then mirrored. Leg pieces are cut apart at the joints by which bone each shape sits nearest
  // (packages/client/src/legRig.ts), so nothing here may straddle a joint: a piston is a sleeve on one bone and a rod on
  // the next, and a shape near the ankle sits clearly above it (shin) or below it (foot).
  const shinPanel = hazardPanel("z", -SHIN_D / 2, -1, [LX - 0.2, LX + 0.2], [-shinLength / 2 + 0.2, shinLength / 2 - 0.1], stripeWidth); // clear of the ankle armour
  const onThigh = (m: MeshData) => between(HIP, KNEE, m);
  const onShin = (m: MeshData) => between(KNEE, ANKLE, m);
  // The knee guard's outline across the shin (up the shin, then toward the back): a wedge pointing back, the shape
  // that says the knee bends backward. It sits low enough on the shin to ride with it.
  const g = shinLength / 2 - 0.12;
  const kneeGuard: UV[] = [[g - 0.2, -0.04], [g - 0.2, 0.2], [g - 0.02, 0.36], [g + 0.12, 0.22], [g + 0.12, -0.04]];

  const ankleArmour = cut(0.06, 0.52, ANKLE[2] - 0.36, ANKLE[2] + 0.32, [0.04, 0.15, 0.08, 0.04]); // (y, z)
  const legR = merge(
    slab([0.3, 1.28, -0.4], [0.86, 1.64, 0.26], bev(0.07)), // hip armour; Leg_L's carries the serial on its front
    notFar(() => block(cut(1.32, 1.6, -0.34, 0.18, 0), "x", 0.85, 0.91, bev(0.015))), // a plate over its outside
    onThigh(box([LX, 0, 0], [0.5, thighLength + 0.2, 0.46], bev(0.07))), // thigh
    notFar(() => onThigh(block(cut(LX - 0.21, LX + 0.21, -thighLength * 0.36, thighLength * 0.42, 0.05), "z", -0.3, -0.21, bev(0.02)))), // thigh plate
    // A second plate over the thigh plate's lower half, which the hip armour does not shade.
    notFar(() => onThigh(block(cut(LX - 0.15, LX + 0.15, -thighLength * 0.32, 0, 0), "z", -0.34, -0.29, bev(0.012)))),
    onShin(box([LX, 0, 0], [SHIN_W, shinLength, SHIN_D], bev(0.07))), // shin
    onShin(block(kneeGuard, "x", LX - 0.24, LX + 0.24, bev(0.04))),
    // A plate on the outside of the shin's back half; the front half is where the outer knee ram's rod runs.
    notFar(() => onShin(block(cut(-shinLength / 2 + 0.14, shinLength / 2 - 0.2, -0.02, 0.17, 0), "x", LX + 0.24, LX + 0.29, bev(0.012)))),
    // Ankle armour, thick to take the gun's recoil, its front sloped. It rides with the foot. Gate V10 layered it: a
    // plate over its front, narrower than the block so its edges step, and a plate on its outside. Both stay below the
    // ankle, so the leg rig hangs them on the foot with the block (each is a shape of its own, placed by its middle).
    block(ankleArmour, "x", 0.25, 0.89, bev(0.04)),
    notFar(() => block(cut(0.1, 0.34, ANKLE[2] - 0.395, ANKLE[2] - 0.35, [0.02, 0.03, 0, 0]), "x", 0.31, 0.83, bev(0.012))),
    notFar(() => block(cut(0.06, 0.36, ANKLE[2] - 0.3, ANKLE[2] + 0.26, [0.03, 0.1, 0.06, 0.03]), "x", 0.885, 0.93, bev(0.012))),
  );

  // Feet: a heel block and two long toes with a gap between them, planted wide for stability, and a heel spur. Each
  // toe's sloped top has a cap, the part that scrapes when the mech digs in. Big feet are a heavy mech's footing: they
  // are drawn larger than life on purpose.
  const toeCap: UV[] = [[0.16, -0.91], [0.27, -0.8], [0.298, -0.828], [0.188, -0.938]]; // (y, z), on the toe's slope
  const toes: [number, number][] = [[0.24, 0.565], [0.595, 0.92]];
  const footR = far
    ? merge(slab([0.24, 0, -0.9], [0.92, 0.26, 0.38]), slab([0.38, 0.04, 0.34], [0.78, 0.28, 0.56]))
    : merge(
      slab([0.24, 0, -0.32], [0.92, 0.22, 0.38], bev(0.05)), // heel block
      ...toes.map(([x0, x1]) => block(cut(0, 0.28, -0.92, -0.28, [0, 0.13, 0, 0]), "x", x0, x1, bev(0.03))), // toes
      ...toes.map(([x0, x1]) => block(toeCap, "x", x0 + 0.025, x1 - 0.025, bev(0.01))), // toe caps
      // Heel spur. It stops short of the calf ram so its middle stays nearer the foot than the shin, which leans back.
      block(cut(0.04, 0.3, 0.34, 0.56, [0, 0, 0.1, 0]), "x", 0.38, 0.78, bev(0.03)),
    );

  // Pistons: hip, knee and ankle joints, a pair of rams spanning the knee, one down each side of the leg (each a sleeve
  // on the thigh and a rod on the shin), and a calf ram behind the shin.
  // A joint round its own bone sits exactly between two bones, so which piece it lands in would be a coin toss that
  // could differ between levels of detail; 2 cm up its bone settles it (the knee rides the thigh, the ankle the shin).
  const kneeAt = toward(KNEE, HIP, 0.02), ankleAt = toward(ANKLE, KNEE, 0.02);
  // A ram from `a` to `b`, its sleeve `sleeve` long and `r` thick. Near, the sleeve is turned: a collar at its mount and
  // a gland collar where the rod comes out (both inside the motion entry's radius, so the game still lifts the whole
  // sleeve). The rod runs deep into the sleeve, out of sight, so it never pulls out of it as the joint bends (gate V9b:
  // the game slides it).
  const ram = (a: V3, b: V3, sleeve: number, rodFrom: number, r: number, round: number) => merge(
    near
      ? lathe(a, toward(a, b, sleeve), [[0, r + 0.015], [0.05, r + 0.015], [0.05, r], [sleeve - 0.08, r], [sleeve - 0.08, r + 0.02], [sleeve, r + 0.02]], round)
      : rod(a, toward(a, b, sleeve), r, sides(8)),
    rod(toward(a, b, rodFrom), b, r * 0.6, sides(round - 4)),
  );
  // A knee ram at `x` across; thick, since the rams are what the side view shows of the hydraulics.
  const kneeRam = (x: number, r: number, round: number) => ram([x, ramTop[1], ramTop[2]], [x, ramFoot[1], ramFoot[2]], 0.42, 0.15, r, round);
  const pistonsR = merge(
    cylinder([0.36, HIP[1], HIP[2]], 0.21, 0.2, "x", sides(16)), // hip joint
    cylinder([LX, kneeAt[1], kneeAt[2]], 0.24, 0.62, "x", sides(24)), // knee joint
    notFar(() => cylinder([0.9, kneeAt[1], kneeAt[2]], 0.13, 0.06, "x", sides(20))), // knee hub cap
    cylinder([LX, ankleAt[1], ankleAt[2]], 0.19, 0.62, "x", sides(16)), // ankle joint
    kneeRam(0.89, 0.125, 16), // outer, the one the side view shows
    notFar(() => kneeRam(0.24, 0.115, 12)), // inner
    notFar(() => ram(calfTop, calfFoot, 0.3, 0.1, 0.1, 12)), // calf ram
    only(() => merge(
      cylinder([0.89, ramTop[1] + 0.01, ramTop[2]], 0.075, 0.1, "x", 12), // pin at the outer sleeve's top
      cylinder([0.89, ramFoot[1], ramFoot[2]], 0.07, 0.1, "x", 12), // pin at the outer rod's foot
    )),
  );
  // Hydraulic hoses down to each knee ram's sleeve: the outer one from the hip armour, the inner one from the waist.
  // Both stay on the thigh, so neither has to bend at the knee.
  const legHosesR = merge(
    line([[0.82, 1.27, -0.3], [0.96, 1.28, -0.22], [0.98, 1.34, -0.1], [0.93, 1.37, -0.05]], 0.045),
    line([[0.2, 1.62, -0.3], [0.18, 1.46, -0.2], [0.21, 1.4, -0.08], [0.24, 1.38, -0.04]], 0.04),
  );

  return {
    Torso: torso,
    Head: head,
    Sensor: sensor,
    Missile_Pods: pods,
    Accent_Band: accentBand,
    Frame: frame,
    Arm_R: armR,
    Autocannon: autocannon,
    // The barrels' dark bores, a part of their own so they kick back with the gun (data/recoil.json). Past 25 m the
    // barrels are one drum, and the drum's mouth gets one dark bore. Near, each is the wall and floor of its barrel's
    // bore, a cup open at the muzzle, its lip a millimetre inside and ahead of the barrel's mouth so no gap shows.
    Autocannon_Bores: near
      ? merge(...barrelAt.map(([x, y]) => lathe([x, y, GUN[2] + boreDepth], [x, y, GUN[2]], [[boreDepth + 0.001, boreRadius - 0.001], [0, boreRadius - 0.001]], 12, [false, true])))
      : cylinder([GUN[0], GUN[1], GUN[2] - 0.002], 0.12, 0.012, "z", sides(8)),
    Arm_L: armL,
    Shield: shield,
    Shield_Bands: shieldBands,
    Shield_Edge: ramEdge,
    Pile_Driver: pileDriver,
    Arm_Frame: armFrame,
    Arm_Hoses: armHoses,
    Shoulder_Stripes: pair(merge(outerStripes.yellow, topStripes.yellow, backStripes.yellow)),
    Shoulder_Stripes_Black: pair(merge(outerStripes.black, topStripes.black, backStripes.black)),
    Leg_R: legR,
    Leg_L: mirrorX(legR),
    Feet: pair(footR),
    Pistons: pair(pistonsR),
    Leg_Hoses: pair(legHosesR),
    Shin_Stripes: pair(onShin(shinPanel.yellow)),
    Shin_Stripes_Black: pair(onShin(shinPanel.black)),
  };
}

// Each part at its nearest level, then each simpler level while it has fewer triangles than the one before. The game
// reads <Part>_LOD1 and then <Part>_LOD2, stopping at the first missing one, and a part keeps its last level farther out.
const levels = ([0, 1, 2] as const).map(build);
const parts: NodeData[] = [];
const totals = [0, 0, 0];
for (const name of Object.keys(levels[0]!)) {
  let last = levels[0]![name]!;
  parts.push({ name, mesh: last });
  totals[0] += triangles(last);
  let simpler = true;
  for (const lv of [1, 2] as const) {
    const mesh = levels[lv]![name]!;
    simpler &&= triangles(mesh) < triangles(last);
    if (simpler) { parts.push({ name: `${name}_LOD${lv}`, mesh }); last = mesh; }
    totals[lv] += triangles(last);
  }
}
parts.push(
  { name: "Mount_Gun", translation: GUN },
  { name: "Torso_Fx", translation: [0, 3.1, 0.42] },
  { name: "Arm_R_Fx", translation: [1.2, 2.66, -0.45] },
  { name: "Leg_L_Fx", translation: [-0.82, 1.1, 0.05] },
  ...bothLegs(HIP, KNEE, ANKLE),
);

// The rams that slide (gate V9b): both knee rams and the calf ram on each leg, all in the Pistons part.
const kneeRamAt = (x: number) => [[x, ramTop[1], ramTop[2]], [x, ramFoot[1], ramFoot[2]]] as [V3, V3];
const [outerTop, outerFoot] = kneeRamAt(0.89), [innerTop, innerFoot] = kneeRamAt(0.24);
const motionR = [
  piston("Knee_Ram_Outer_R", ["Pistons"], ["thigh_R", outerTop], ["shin_R", outerFoot], 0.16),
  piston("Knee_Ram_Inner_R", ["Pistons"], ["thigh_R", innerTop], ["shin_R", innerFoot], 0.15),
  piston("Calf_Ram_R", ["Pistons"], ["shin_R", calfTop], ["foot_R", calfFoot], 0.13),
];

const root = new URL("../..", import.meta.url).pathname;
const dir = join(root, "assets/models/mechs/ironclad");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Ironclad.glb"), writeGlb(parts, { quantize: true }));
const stored = parts.reduce((s, p) => s + (p.mesh ? triangles(p.mesh) : 0), 0);
console.log(`Wrote ${join(dir, "Mech_Ironclad.glb")}: ${totals.join(" / ")} triangles drawn near / middle / far, ${stored} stored`);
// The Ironclad's zones, paints and flags are kept by hand in its kit file; only the moving parts are written here.
const kitPath = join(root, "scripts/mechs/ironclad.kit.json");
const kitFile = JSON.parse(readFileSync(kitPath, "utf8"));
writeFileSync(kitPath, `${JSON.stringify({ ...kitFile, motion: [...motionR, ...motionR.map(leftOf)] }, null, 2)}\n`);
