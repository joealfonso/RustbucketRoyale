// Arbiter, the electronic warfare and command mech (docs/MECH_ROSTER.md, section 4): slender digitigrade legs on broad
// magnetic feet, a narrow white chassis with teal energy strips, an oversized round radome for a head, a comms mast on
// the left shoulder, and four utility drones held round the body on jointed pylons. At range it should read as
// "the big round head and the ring of drones".
// Detail pass (V7c): chamfered plates laid over the main shells with a visible seam, bolt rows where plates are held
// on, and pistons that drive the knees, hocks and elbows. Big calm masses (the dome above all) stay plain.
// Geometry pass (V8): the dome gets a frame ring, ribs over its seams and a window onto its sensor array; the drones
// are flown by ducted fans and gripped by clamps on folding, ram-driven pylons with their tethers run along them;
// armour is layered (lapped plates, lips, backing plates), with motors, rams, cables, vents and a dish where each one
// has a job. The dome's skin itself still stays plain.
// Readability pass (V9): what reads at 50 and 150 m got bigger (the dome, the drones and their pylons, the shoulders,
// the feet and the stance between them); bolts, slats, fins and ports that vanish past 20 m came out of the model,
// because the painted atlas already draws plates, rivets and chips at close range. Their triangles went into hoses
// at the hips, elbows and radome feed, an armoured brow on each drone and chunkier forearms. Every part names its
// finish: painted armour, bare metal (joints, rams, barrels, the dome's glossy skin) or rubber (the hoses).
// Near level pass (V10, budget 15k): the dome, the drone pods and the round joints turn smooth with more sides, so
// the dome's highlight is one curve; the pods get open fan ducts, a ring round their girth and an eye down a housing;
// the pylons' joints are rounder, with pin heads at the elbow; both wrist guns are modelled (sleeved shroud, barrel,
// bored brake) and the mast dish is a real bowl. The simpler levels keep their shapes and sizes.
// Three levels of detail, nearest first: the near one has everything; the middle one drops bolts, fins and piston
// rods, keeps the big new pieces (fan ducts, frame ring, layered plates) and rounds things with fewer sides; the far
// one is plain boxes and the same silhouette.
// Writes the model and scripts/mechs/arbiter.kit.json, the paint and zone of every part.
// Run: npx tsx scripts/mechs/arbiter.ts  →  assets/models/mechs/arbiter/Mech_Arbiter.glb
// Metres, Y up, facing -Z, right side +X, feet at y = 0. Every part is built in place on the assembled mech.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MeshData, NodeData } from "../assets/glbWrite";
import { writeGlb } from "../assets/glbWrite";
import { bothLegs } from "./joints";
import { leftOf, piston, sway } from "./motion";
import { box, convex, cylinder, empty, merge, mirrorX, prism, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

type P2 = [number, number];
type Axis = "x" | "y" | "z";
const deg = Math.PI / 180;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));
const unit = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// A solid through matching rings of points in order, capped at both ends. The rings must describe a convex shape
// and neighbouring rings must have parallel edges, so every side face is flat.
function loft(rings: V3[][]): MeshData {
  const faces: V3[][] = [rings[0]!, rings[rings.length - 1]!];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!, b = rings[r + 1]!;
    for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; faces.push([a[i]!, a[j]!, b[j]!, b[i]!]); }
  }
  return convex(faces);
}

// A convex outline with each corner cut off `c` along both its edges: the chamfer on the long edges of a plate.
function cutCorners(outline: P2[], c: number): P2[] {
  if (c <= 0) return outline;
  return outline.flatMap((p, i) => {
    const toward = (q: P2): P2 => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]), t = Math.min(c, d * 0.4) / d;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    return [toward(outline[(i + outline.length - 1) % outline.length]!), toward(outline[(i + 1) % outline.length]!)];
  });
}

// A convex outline shrunk by moving every edge in by `d`.
function insetOutline(outline: P2[], d: number): P2[] {
  const n = outline.length;
  const mid: P2 = [outline.reduce((s, p) => s + p[0], 0) / n, outline.reduce((s, p) => s + p[1], 0) / n];
  const lines = outline.map((p, i) => {
    const q = outline[(i + 1) % n]!, len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    let nx = (q[1] - p[1]) / len, ny = -(q[0] - p[0]) / len;
    if ((mid[0] - p[0]) * nx + (mid[1] - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
    return { p: [p[0] + nx * d, p[1] + ny * d] as P2, dir: [q[0] - p[0], q[1] - p[1]] as P2 };
  });
  return lines.map((b, i) => {
    const a = lines[(i + n - 1) % n]!;
    const det = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
    if (Math.abs(det) < 1e-9) return b.p;
    const t = ((b.p[0] - a.p[0]) * b.dir[1] - (b.p[1] - a.p[1]) * b.dir[0]) / det;
    return [a.p[0] + a.dir[0] * t, a.p[1] + a.dir[1] * t] as P2;
  });
}

// A convex outline swept along an axis from `from` to `to`, every edge chamfered by `c` (the way `box` bevels):
// corners cut along the sweep, front and back faces shrunk in. Axes map as in `prism`: x → (y, z), y → (z, x), z → (x, y).
function slab(outline: P2[], axis: Axis, from: number, to: number, c: number): MeshData {
  if (c <= 0) return prism(outline, axis, from, to);
  const at = (u: number, v: number, w: number): V3 => (axis === "x" ? [w, u, v] : axis === "y" ? [v, w, u] : [u, v, w]);
  const outer = cutCorners(outline, c), inner = cutCorners(insetOutline(outline, c), c);
  const ring = (pts: P2[], w: number) => pts.map(([u, v]) => at(u, v, w));
  return loft([ring(inner, from), ring(outer, from + c), ring(outer, to - c), ring(inner, to)]);
}

// The two sideways directions of a straight piece from a to b. The first stays horizontal where it can, so a leg
// piece's width stays across x.
function sideways(a: V3, b: V3): [V3, V3] {
  const d = unit(sub(b, a));
  let side = cross(d, [0, 1, 0]);
  if (Math.hypot(...side) < 1e-3) side = cross(d, [1, 0, 0]);
  const u = unit(side);
  return [u, unit(cross(u, d))];
}

// A straight bar from a to b, `size` [wide, deep] at a and `end` at b, its long edges chamfered by `c`.
function bar(a: V3, b: V3, size: P2, c = 0, end: P2 = size): MeshData {
  const [u, v] = sideways(a, b);
  const ring = (p: V3, [w, h]: P2) => cutCorners([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], c)
    .map(([x, y]) => add(p, add(scale(u, x), scale(v, y))));
  return loft([ring(a, size), ring(b, end)]);
}

// A round rod from a to b, `sides` flat faces round, for pistons and bolts at any angle.
function tube(a: V3, b: V3, r: number, sides: number, r2 = r): MeshData {
  const [u, v] = sideways(a, b);
  const ring = (p: V3, radius: number) => Array.from({ length: sides }, (_, i) => {
    const t = (i / sides) * Math.PI * 2;
    return add(p, add(scale(u, Math.cos(t) * radius), scale(v, Math.sin(t) * radius)));
  });
  return loft([ring(a, r), ring(b, r2)]);
}

// A cable through a run of points, one rod per stretch, so it bends where it is clipped down.
const cable = (points: V3[], r: number, sides = 5): MeshData => merge(...points.slice(1).map((p, i) => tube(points[i]!, p, r, sides)));

// A ram from a to b: the fat sleeve at a, the thin rod sliding out of it to b.
const ram = (a: V3, b: V3, r: number, sides: number): MeshData => merge(tube(a, lerp(a, b, 0.6), r, sides), tube(lerp(a, b, 0.5), b, r * 0.5, 6));

// A round solid from latitude rings (degrees, bottom to top) closed by a point at the top. A first latitude of -90 closes
// the bottom with a point too; anything higher leaves a flat bottom, which is where the dome sits in its collar.
function ellipsoid(centre: V3, radii: V3, sides: number, lats: number[]): MeshData {
  const ring = (lat: number): V3[] => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2, c = Math.cos(lat * deg);
    return [centre[0] + Math.cos(a) * c * radii[0], centre[1] + Math.sin(lat * deg) * radii[1], centre[2] + Math.sin(a) * c * radii[2]] as V3;
  });
  const top: V3 = [centre[0], centre[1] + radii[1], centre[2]];
  const bottomPole = lats[0]! <= -90;
  const rings = (bottomPole ? lats.slice(1) : lats).map(ring);
  const faces: V3[][] = [];
  const fan = (r: V3[], tip: V3) => r.forEach((_, i) => faces.push([r[i]!, r[(i + 1) % sides]!, tip]));
  if (bottomPole) fan(rings[0]!, [centre[0], centre[1] - radii[1], centre[2]]); else faces.push(rings[0]!);
  for (let l = 0; l < rings.length - 1; l++) {
    const a = rings[l]!, b = rings[l + 1]!;
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; faces.push([a[i]!, a[j]!, b[j]!, b[i]!]); }
  }
  fan(rings[rings.length - 1]!, top);
  return convex(faces);
}

// Turns every triangle to face the way its corners' normals point. The smooth shapes below are built without minding
// winding, and `along` can mirror one.
function faceOut(mesh: MeshData): MeshData {
  const p = mesh.positions, n = mesh.normals, ix = mesh.indices;
  const at = (i: number): V3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
  const nAt = (i: number): V3 => [n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!];
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t]!, ix[t + 1]!, ix[t + 2]!];
    const face = cross(sub(at(b), at(a)), sub(at(c), at(a)));
    const want = add(add(nAt(a), nAt(b)), nAt(c));
    if (face[0] * want[0] + face[1] * want[1] + face[2] * want[2] < 0) { ix[t + 1] = c; ix[t + 2] = b; }
  }
  return mesh;
}

// A round solid turned from a profile of [radius, height] points about an axis through `centre` (axes as in
// `cylinder`), `sides` round. Gate V10: smooth all the way round, so the toon bands and the metal highlight sweep
// round it as one curve instead of stepping facet by facet. The writer leaves corners like these as they are
// (scripts/assets/hardSurface.ts). Along the profile, stretches turned less than `smooth` degrees apart share their
// corners too (a dome's skin); sharper turns (a rim, a cap) stay hard edges. The profile runs with the solid on its
// left: up the outside, then in across the top. `closed` joins the last point back to the first (a hollow ring), and
// `stretch` squeezes the second radial axis, for an oval. A point on the axis is one corner (a cap's middle, a pole).
function lathe(profile: P2[], centre: V3, axis: Axis, sides: number, o: { closed?: boolean; smooth?: number; stretch?: number } = {}): MeshData {
  const s = o.stretch ?? 1, n = profile.length;
  const at = (u: number, v: number, w: number): V3 => (axis === "x" ? [w, u, v] : axis === "y" ? [v, w, u] : [u, v, w]);
  const [cu, cv, cw] = axis === "x" ? [centre[1], centre[2], centre[0]] : axis === "y" ? [centre[2], centre[0], centre[1]] : [centre[0], centre[1], centre[2]];
  const segs = Array.from({ length: o.closed ? n : n - 1 }, (_, i) => [i, (i + 1) % n] as const);
  const segNormal = segs.map(([i, j]) => {
    const [r1, h1] = profile[i]!, [r2, h2] = profile[j]!;
    const l = Math.hypot(r2 - r1, h2 - h1) || 1;
    return [(h2 - h1) / l, -(r2 - r1) / l] as P2;
  });
  const cosSmooth = Math.cos((o.smooth ?? 0) * deg);
  const out: MeshData = { positions: [], normals: [], indices: [] };
  // One ring of corners per profile point and normal; a point on the axis gets a single corner.
  const ring = (point: P2, normal: P2): number[] => {
    const [r, h] = point, base = out.positions.length / 3;
    const count = Math.abs(r) < 1e-9 ? 1 : sides;
    for (let k = 0; k < count; k++) {
      const a = (k / sides) * Math.PI * 2;
      out.positions.push(...at(cu + Math.cos(a) * r, cv + Math.sin(a) * r * s, cw + h));
      const nn = count === 1 ? ([0, 0, Math.sign(normal[1]) || 1] as V3) : unit([normal[0] * Math.cos(a), (normal[0] * Math.sin(a)) / s, normal[1]]);
      out.normals.push(...at(nn[0], nn[1], nn[2]));
    }
    return Array.from({ length: sides }, (_, k) => base + (count === 1 ? 0 : k));
  };
  // Where two stretches meet smoothly they share one ring with their averaged normal.
  const rings: [number[], number[]][] = segs.map(() => [[], []]);
  segs.forEach(([i, j], g) => {
    const prev = g > 0 ? g - 1 : o.closed ? segs.length - 1 : -1;
    const next = g < segs.length - 1 ? g + 1 : o.closed ? 0 : -1;
    const smoothWith = (h: number) => h >= 0 && segNormal[g]![0] * segNormal[h]![0] + segNormal[g]![1] * segNormal[h]![1] > cosSmooth;
    rings[g]![0] = smoothWith(prev) && rings[prev]![1].length ? rings[prev]![1] : ring(profile[i]!, smoothWith(prev) ? unitP(segNormal[g]!, segNormal[prev]!) : segNormal[g]!);
    rings[g]![1] = smoothWith(next) && next === 0 && rings[0]![0].length ? rings[0]![0] : ring(profile[j]!, smoothWith(next) ? unitP(segNormal[g]!, segNormal[next]!) : segNormal[g]!);
  });
  for (const [a, b] of rings) {
    for (let k = 0; k < sides; k++) {
      const l = (k + 1) % sides;
      for (const tri of [[a[k]!, a[l]!, b[l]!], [a[k]!, b[l]!, b[k]!]]) if (new Set(tri).size === 3) out.indices.push(...tri);
    }
  }
  return faceOut(out);
}
const unitP = (a: P2, b: P2): P2 => { const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

// A mesh built along +z from the origin, laid along the line from a to b.
function along(mesh: MeshData, a: V3, b: V3): MeshData {
  const [u, v] = sideways(a, b), d = unit(sub(b, a));
  const move = (x: number, y: number, z: number): V3 => add(add(scale(u, x), scale(v, y)), scale(d, z));
  const out: MeshData = { positions: [], normals: [], indices: [...mesh.indices] };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    out.positions.push(...add(a, move(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!)));
    out.normals.push(...move(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!));
  }
  return faceOut(out);
}

// A smooth round hose through a run of points, one skin bent at each point (its ring there faces halfway between the
// stretches either side), capped flat at both ends.
function sweep(points: V3[], r: number, sides: number): MeshData {
  const dirs = points.slice(1).map((p, i) => unit(sub(p, points[i]!)));
  const out: MeshData = { positions: [], normals: [], indices: [] };
  const [u0] = sideways(points[0]!, points[1]!);
  let u = u0;
  const rings = points.map((p, i) => {
    const d = unit(add(dirs[Math.max(0, i - 1)]!, dirs[Math.min(dirs.length - 1, i)]!));
    // Carry the side direction along so the hose does not twist, and stretch the ring across a bend so it stays round.
    u = unit(sub(u, scale(d, u[0] * d[0] + u[1] * d[1] + u[2] * d[2])));
    const v = cross(d, u);
    const inDir = dirs[Math.max(0, i - 1)]!;
    const stretch = 1 / Math.max(0.5, inDir[0] * d[0] + inDir[1] * d[1] + inDir[2] * d[2]);
    const base = out.positions.length / 3;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const n = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
      // Only the part of the ring across the bend is stretched: that is the part the mitre cuts at a slant.
      const bendAxis = unit(sub(inDir, scale(d, inDir[0] * d[0] + inDir[1] * d[1] + inDir[2] * d[2])));
      const across = Number.isFinite(bendAxis[0]) ? n[0] * bendAxis[0] + n[1] * bendAxis[1] + n[2] * bendAxis[2] : 0;
      out.positions.push(...add(p, add(scale(n, r), scale(bendAxis, across * r * (stretch - 1) || 0))));
      out.normals.push(...n);
    }
    return base;
  });
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < sides; k++) {
      const l = (k + 1) % sides, a = rings[i]!, b = rings[i + 1]!;
      out.indices.push(a + k, a + l, b + l, a + k, b + l, b + k);
    }
  }
  // Flat caps, with corners of their own so their edge stays sharp.
  [[0, -1], [rings.length - 1, 1]].forEach(([i, sign]) => {
    const d = scale(dirs[sign! < 0 ? 0 : dirs.length - 1]!, sign!), base = out.positions.length / 3, ring = rings[i!]!;
    for (let k = 0; k < sides; k++) { out.positions.push(...out.positions.slice((ring + k) * 3, (ring + k) * 3 + 3)); out.normals.push(...d); }
    for (let k = 1; k + 1 < sides; k++) out.indices.push(base, base + k, base + k + 1);
  });
  return faceOut(out);
}

// A bent bar through a run of matching cross-sections (each a convex ring of points, the same count), one skin with
// flat faces and a cap at each end. Unlike bars laid end to end, nothing pokes out at the bends.
function bent(rings: V3[][]): MeshData {
  const out: MeshData = { positions: [], normals: [], indices: [] };
  const middle = (r: V3[]) => scale(r.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / r.length);
  const face = (points: V3[], away: V3) => {
    let n = unit(cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!)));
    if (n[0] * away[0] + n[1] * away[1] + n[2] * away[2] < 0) { n = scale(n, -1); points = [...points].reverse(); }
    const base = out.positions.length / 3;
    for (const p of points) { out.positions.push(...p); out.normals.push(...n); }
    for (let i = 1; i + 1 < points.length; i++) out.indices.push(base, base + i, base + i + 1);
  };
  for (let r = 0; r + 1 < rings.length; r++) {
    const a = rings[r]!, b = rings[r + 1]!, mid = scale(add(middle(a), middle(b)), 0.5);
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length, quad = [a[i]!, a[j]!, b[j]!, b[i]!];
      face(quad, sub(middle(quad), mid));
    }
  }
  face(rings[0]!, sub(middle(rings[0]!), middle(rings[1]!)));
  face(rings[rings.length - 1]!, sub(middle(rings[rings.length - 1]!), middle(rings[rings.length - 2]!)));
  return out;
}

// Profiles for `lathe`: a solid cylinder (or cone, from r to r2) and a hollow ring, `length` long about the middle.
const solidProfile = (r: number, length: number, r2 = r): P2[] => [[0, -length / 2], [r, -length / 2], [r2, length / 2], [0, length / 2]];
const ringProfile = (outer: number, inner: number, length: number): P2[] => [[outer, -length / 2], [outer, length / 2], [inner, length / 2], [inner, -length / 2]];
// A hollow ring about an axis: a duct, a lens housing, a muzzle. Its depth shows as a shaded inside wall. The game's
// outline shell swells every face out by an even width on screen, about 1.5 to 4 cm between 10 and 25 m (data/look.json
// outline.mech), so an inside wall closer than that to the axis would swell right through it and show as a dark stick
// in the hole: keep `inner` at 6.1 cm or more, which also covers the old fixed 6 cm.
const hollow = (centre: V3, outer: number, inner: number, length: number, axis: Axis, sides: number, stretch = 1) =>
  lathe(ringProfile(outer, inner, length), centre, axis, sides, { closed: true, stretch });

// ---- Leg joints. Digitigrade: the thigh runs down and forward to the knee, the shin back to a raised hock, a short
// bone forward to the ankle, then a broad flat magnetic foot. The game cuts each leg at these points by which bone
// each shape sits nearest (packages/client/src/legRig.ts), so every shape below is placed clearly on one bone.
// The legs stand a little wider than the hull, for a planted, heroic stance on the broad feet.
const legX = 0.46;
const hip: V3 = [legX, 1.52, 0.02], knee: V3 = [legX, 1.02, -0.2], hock: V3 = [legX, 0.42, 0.22], ankle: V3 = [legX, 0.17, 0.0];
const thighDir = unit(sub(knee, hip)), shinDir = unit(sub(hock, knee));
const thighFront: V3 = [0, -thighDir[2], thighDir[1]]; // faces forward and a little up
const shinFront: V3 = [0, -shinDir[2], shinDir[1]]; // faces forward and down
// The leg rams' mounts, right leg. The knee actuator rides on the outside of the thigh: its sleeve hangs from below the
// hip cap, its rod ends on a lug at the knee drum. The calf actuator runs down the back of the shin to the hock and
// lifts the foot.
const legPoint = (a: V3, b: V3, front: V3) => (t: number, out = 0) => add(lerp(a, b, t), scale(front, out));
const thighRam: [V3, V3] = [add(legPoint(hip, knee, thighFront)(0.36), [0.19, 0, 0]), add(legPoint(hip, knee, thighFront)(0.92), [0.18, 0, 0])];
const calfRam: [V3, V3] = [legPoint(knee, hock, shinFront)(0.14, -0.17), legPoint(knee, hock, shinFront)(0.9, -0.14)];

// The radome: a small round sensor head sat low and tight in its collar on the yoke (gate V13, Joseph: "change the head
// for the arbiter to something smaller"; it was 1.52 m across). The ring of drones round it is the silhouette now.
const domeCentre: V3 = [0, 3.52, 0];
const domeRadii: V3 = [0.42, 0.38, 0.42];
// A point on the radome's skin, `out` metres proud of it, `round` degrees from straight ahead toward +x, at a latitude.
const onDome = (round: number, lat: number, out = 0): V3 => [
  Math.sin(round * deg) * Math.cos(lat * deg) * (domeRadii[0] + out),
  domeCentre[1] + Math.sin(lat * deg) * (domeRadii[1] + out),
  -Math.cos(round * deg) * Math.cos(lat * deg) * (domeRadii[2] + out),
];
// The sensor window looks out of the front of the dome above the ring, tilted up to its surface there.
const windowLat = 24;
const lensXs = [-0.085, 0, 0.085];
const windowTilt = Math.atan2(Math.sin(windowLat * deg) / domeRadii[1], Math.cos(windowLat * deg) / domeRadii[2]);
// Comms mast on the left shoulder, behind the dome, on a bracket off the yoke. The asymmetry has a job: the mast
// relays the drones, and it sits on the side away from the gun so it stays out of the line of fire. It stands clear
// of the dome's rim and well above its top, so the two shapes never merge into one at range. With the smaller head
// (gate V13) it stands closer in and shorter, so it reads as the head's aerial rather than a pole beside the mech.
const mastX = -0.68, mastZ = 0.46;
const mastTop = 4.42;
// The chest plate carrying the serial number (data/mechKits.json serials: "04" at x 0.12, y 2.5 from the front). Its
// face stays flat and clear of bolts over the whole number.
const chestPivot: V3 = [0.12, 2.54, -0.33];
const chestTilt: V3 = [-0.12, 0, 0];

interface DronePlace { at: V3; mount: V3; elbow: V3 }
// Four pods at different heights round the body, so the ring looks like it is turning.
const dronePlaces: DronePlace[] = [
  { at: [1.92, 3.35, -0.2], mount: [0.5, 3.12, 0.12], elbow: [1.15, 3.7, 0.25] },
  { at: [1.3, 3.95, 1.3], mount: [0.22, 2.88, 0.45], elbow: [0.75, 3.55, 0.95] },
  { at: [-1.95, 3.55, -0.3], mount: [-0.48, 3.12, 0.0], elbow: [-1.15, 3.85, 0.0] },
  { at: [-1.25, 2.7, 1.42], mount: [-0.22, 2.5, 0.56], elbow: [-0.7, 2.85, 1.1] },
];
// A pod is built at the origin facing -Z, then turned so its eye looks out from the chassis, leaning forward so the
// eyes show from the front.
const facing = (p: DronePlace) => Math.atan2(-p.at[0], -(p.at[2] - 1.0));
const placed = (mesh: MeshData, p: DronePlace) => turn(mesh, [0, facing(p), 0], [0, 0, 0], p.at);
// The front of a pod's eye housing, where its sway path ends, so the eye and brow sway with the pod (gate V10: the
// path stopped at the pod's middle, which left them behind).
const eyeOf = (p: DronePlace): V3 => add(p.at, scale([-Math.sin(facing(p)), 0, -Math.cos(facing(p))], 0.385));
// A mesh built round the origin, made bigger. The far level draws the pods a size up: past 80 m a pod is two or
// three pixels, and the ring of drones is the read, so it is worth exaggerating where the growth cannot be seen to pop.
const grown = (mesh: MeshData, s: number): MeshData => ({ ...mesh, positions: mesh.positions.map((v) => v * s) });

// Every part's mesh at one level of detail (0 nearest).
function build(lod: 0 | 1 | 2): Record<string, MeshData> {
  const pick = <T>(near: T, mid: T, far: T): T => [near, mid, far][lod]!;
  const nearOnly = (m: () => MeshData) => (lod === 0 ? m() : empty());
  const notFar = (m: () => MeshData) => (lod < 2 ? m() : empty());
  // Chamfer size. From the middle level out a chamfer is under a pixel wide, so only the nearest has them.
  const c = (near: number) => pick(near, 0, 0);
  const round = (near: number) => pick(near, Math.max(6, near - 4), 6);
  // Gate V10: the near level turns its drums, collars and rods smooth with more sides (`lathe`); the simpler levels
  // keep the flat ones they had, with `sides` [near, middle, far], so their size does not change.
  const drum = (centre: V3, r: number, length: number, axis: Axis, sides: [number, number, number], r2 = r): MeshData =>
    lod === 0 ? lathe(solidProfile(r, length, r2), centre, axis, sides[0]) : cylinder(centre, r, length, axis, sides[lod], r2);
  const rod = (a: V3, b: V3, r: number, sides: [number, number, number], r2 = r): MeshData =>
    lod === 0 ? along(lathe([[0, 0], [r, 0], [r2, Math.hypot(...sub(b, a))], [0, Math.hypot(...sub(b, a))]], [0, 0, 0], "z", sides[0]), a, b) : tube(a, b, r, sides[lod], r2);
  // A hose through a run of points, bent where it is clipped down: one smooth skin near, one rod per stretch further out.
  const hoseRun = (points: V3[], r: number, sides: [number, number, number]): MeshData =>
    lod === 0 ? sweep(points, r, sides[0]) : cable(points, r, sides[lod]);
  // A ram from a to b: the fat sleeve at a, the thin rod sliding out of it to b.
  const ramLod = (a: V3, b: V3, r: number, sides: [number, number, number]): MeshData =>
    merge(rod(a, lerp(a, b, 0.6), r, sides), rod(lerp(a, b, 0.5), b, r * 0.5, [Math.max(6, sides[0] - 2), 6, 6]));

  // ---- Right leg, mirrored for the left. White shells and plates (Leg_R), the dark joints and rams (Leg_Frame), a
  // rubber hose (Leg_Hoses). Thick enough to read as legs, not stilts, at 50 m.
  const thighAt = (t: number, front = 0) => add(lerp(hip, knee, t), scale(thighFront, front));
  const shinAt = (t: number, front = 0) => add(lerp(knee, hock, t), scale(shinFront, front));
  // The rod runs deep into the sleeve, out of sight, so it never pulls out as the joint bends (gate V9b: the game
  // slides it, the thigh ram's rod with the shin and the calf ram's with the foot).
  const ramSleeve = ([a, b]: [V3, V3]) => rod(a, lerp(a, b, 0.58), 0.055, [12, 6, 6]);
  const ramRod = ([a, b]: [V3, V3]) => rod(lerp(a, b, 0.2), b, 0.03, [8, 6, 6]);

  const legShellR = merge(
    bar(thighAt(-0.08), thighAt(0.92), [0.3, 0.38], c(0.05), [0.25, 0.28]), // thigh
    notFar(() => bar(thighAt(0.1, 0.2), thighAt(0.76, 0.15), [0.28, 0.08], c(0.025), [0.23, 0.08])), // thigh plate
    // A second plate lapped over the lower half of the thigh plate, where shots from the front land most.
    nearOnly(() => bar(thighAt(0.45, 0.215), thighAt(0.78, 0.19), [0.2, 0.04], c(0.012), [0.17, 0.04])),
    notFar(() => drum(add(hip, [0.17, 0, 0]), 0.19, 0.06, "x", [16, 6, 6])), // hip cap over the drum
    // Knee guard, hung off the bottom of the thigh and jutting well past the knee: the lip that reads from the side.
    slab([[1.3, -0.27], [1.17, -0.45], [0.98, -0.44], [0.92, -0.33], [1.14, -0.21]], "x", legX - 0.13, legX + 0.13, c(0.03)),
    bar(shinAt(-0.04), shinAt(1), [0.24, 0.26], c(0.04), [0.2, 0.21]), // shin
    notFar(() => bar(shinAt(0.14, 0.14), shinAt(0.82, 0.12), [0.26, 0.07], c(0.02), [0.21, 0.07])), // shin guard
    // Armour on the outside of the shin, the side that faces the enemy when the mech strafes.
    notFar(() => bar(add(shinAt(0.2), [0.132, 0, 0]), add(shinAt(0.76), [0.118, 0, 0]), [0.04, 0.19], c(0.012), [0.04, 0.15])),
    notFar(() => merge(ramSleeve(calfRam), ramSleeve(thighRam))),
    bar(hock, add(ankle, [0, -0.02, -0.03]), [0.19, 0.19], c(0.03), [0.16, 0.16]), // hock to ankle
    // The feet are broad and long on purpose: magnetic locks need area, and they plant the slim body at range.
    box([legX, 0.13, -0.08], [0.52, 0.12, 0.74], c(0.04)), // foot
    notFar(() => box([legX, 0.21, -0.22], [0.38, 0.05, 0.3], c(0.015))), // top plate over the lock's coils
    notFar(() => slab([[0.07, -0.42], [0.19, -0.42], [0.14, -0.58], [0.07, -0.58]], "x", legX - 0.24, legX + 0.24, c(0.025))), // toe
    notFar(() => bar([legX, 0.17, 0.2], [legX, 0.08, 0.38], [0.24, 0.12], c(0.03), [0.2, 0.09])), // heel spur
  );
  const legFrameR = merge(
    drum(hip, 0.15, 0.32, "x", [16, 6, 6]),
    drum(knee, 0.13, 0.3, "x", [16, 6, 6]),
    notFar(() => merge(drum(hock, 0.11, 0.26, "x", [12, 6, 6]), drum(ankle, 0.095, 0.24, "x", [12, 6, 6]))),
    // The knee's bearing caps stand out of the drum on both sides, a step down in size, so the joint reads as a
    // pin through a housing rather than a plain can.
    nearOnly(() => merge(...[-1, 1].map((s) => drum(add(knee, [0.164 * s, 0, 0]), 0.085, 0.03, "x", [12, 6, 6])))),
    // The magnetic pad is a little wider than the foot, so the locking plate shows as a dark rim at ground level.
    box([legX, 0.035, -0.08], [0.58, 0.07, 0.8], c(0.02)),
    notFar(() => merge(ramRod(thighRam), ramRod(calfRam))),
    nearOnly(() => merge(
      drum(thighRam[1], 0.05, 0.06, "x", [10, 6, 6]), // rod lug on the knee drum
      bar(shinAt(0.1, -0.07), calfRam[0], [0.07, 0.08]), // sleeve lug off the back of the shin
      bar(shinAt(0.86, -0.05), calfRam[1], [0.07, 0.08]), // rod lug above the hock
      // The toe lock: a short ram from the ankle bone presses the front of the foot down onto its pad.
      ramLod(add(lerp(hock, ankle, 0.35), [0.11, 0, 0]), [legX + 0.2, 0.22, -0.28], 0.036, [10, 6, 6]),
      box([legX + 0.2, 0.205, -0.28], [0.05, 0.04, 0.08]), // its lug on the foot
    )),
  );
  // Power to the knee motor: a hose out of the back of the hip drum, down the back of the thigh to the knee.
  const legHoseR = notFar(() => hoseRun([add(hip, [0.07, 0.06, 0.17]), add(thighAt(0.45, -0.2), [0.07, 0, 0]), add(thighAt(0.9, -0.15), [0.06, 0, 0])], 0.035, [8, 5, 4]));
  // A teal conduit down the front of each shin feeds the magnetic foot, and the lock glows along the pad when it holds.
  const legGlowR = merge(
    bar(shinAt(0.28, 0.185), shinAt(0.72, 0.165), [0.07, 0.03]),
    notFar(() => merge(box([legX + 0.29, 0.05, -0.08], [0.025, 0.03, 0.66]), box([legX - 0.29, 0.05, -0.08], [0.025, 0.03, 0.66]))),
  );

  // ---- Torso. Narrow and a little lopsided: the right (gun) side of the chest carries a raised armour plate with the
  // serial, the left side shows the dark conduit channel that feeds the radome and the mast.
  const chestBox = box(chestPivot, [0.58, 0.64, 0.1], c(0.035));
  const chestFace = chestPivot[2] - 0.05;
  const onChest = (m: MeshData) => turn(m, chestTilt, chestPivot);
  const torso = merge(
    slab([[-0.22, 1.9], [0.22, 1.9], [0.42, 2.35], [0.4, 2.92], [-0.36, 2.92], [-0.4, 2.35]], "z", -0.28, 0.28, c(0.05)), // hull
    onChest(chestBox),
    slab([[-0.56, 2.9], [0.56, 2.9], [0.56, 3.05], [0.38, 3.16], [-0.38, 3.16], [-0.56, 3.05]], "z", -0.22, 0.3, c(0.05)), // shoulder yoke
    box([0, 1.55, -0.2], [0.3, 0.2, 0.06], c(0.02)), // guard over the front of the hip drive
    // A gorget rising off the back of the yoke behind the collar (gate V13): it seats the smaller head on the body, so
    // seen from behind, where players mostly see their own mech, the head sits on white armour rather than a neck.
    slab([[2.95, 0.3], [3.36, 0.4], [3.36, 0.47], [2.95, 0.54]], "x", -0.3, 0.3, c(0.035)),
    // The lip round the intake under the chest, standing proud of its dark grille so the grille reads as sunk in.
    nearOnly(() => merge(
      ...[1.952, 2.088].map((y) => box([0, y, -0.29], [0.3, 0.025, 0.04])),
      ...[-0.1375, 0.1375].map((x) => box([x, 2.02, -0.29], [0.025, 0.16, 0.04])),
    )),
  );
  const torsoFrame = merge(
    box([0, 1.56, 0.02], [0.66, 0.26, 0.4], c(0.05)), // pelvis, between the hip drums
    box([0, 1.73, 0.02], [0.34, 0.12, 0.3], c(0.03)), // waist segments, so the chest can turn
    box([0, 1.85, 0.02], [0.4, 0.12, 0.34], c(0.03)),
    box([0, 2.5, 0.42], [0.6, 0.72, 0.26], c(0.05)), // electronics pack
    drum([0.66, 2.9, 0.02], 0.13, 0.24, "x", [16, 6, 6]), // shoulder joints
    drum([-0.66, 2.9, 0.02], 0.13, 0.24, "x", [16, 6, 6]),
    box([-0.26, 2.54, -0.295], [0.2, 0.68, 0.05], c(0.015)), // conduit channel up the left chest
    // The chest plate sits on a dark backing a little bigger than itself, so its edge shows as a second layer.
    notFar(() => onChest(box(add(chestPivot, [0, 0, 0.04]), [0.63, 0.69, 0.06], c(0.02)))),
    notFar(() => box([0, 2.02, -0.282], [0.26, 0.12, 0.03])), // grille of the intake that cools the hip drive
  );
  // The radome's data feed, two hoses from the top of the electronics pack up behind the yoke into the collar, and
  // the mast's, across the back of the pack to the mast foot. Thick enough to show from behind at mid range.
  const torsoHoses = notFar(() => merge(
    ...[0.03, 0.15].map((x) => hoseRun([[x, 2.8, 0.5], [x, 2.9, 0.52], [x, 3.0, 0.48]], 0.038, [8, 5, 4])), // up into the gorget
    hoseRun([[-0.22, 2.84, 0.53], [-0.48, 3.0, 0.55], [mastX + 0.06, 3.16, mastZ + 0.07]], 0.034, [8, 5, 4]),
  ));
  const torsoTrim = merge(
    box([0.425, 2.62, 0], [0.07, 0.42, 0.36], c(0.025)), // flank panels
    box([-0.395, 2.62, 0], [0.07, 0.42, 0.36], c(0.025)),
    // Most of the back of the pack is covered, so from behind the body reads as two clean light plates, not dark clutter.
    box([0, 2.52, 0.565], [0.5, 0.56, 0.06], c(0.02)), // pack cover
    notFar(() => box([0, 3.03, -0.235], [0.76, 0.08, 0.04], c(0.015))), // livery stripe on the yoke
  );
  const torsoGlow = merge(
    box([-0.31, 2.54, -0.315], [0.05, 0.56, 0.04]),
    box([-0.21, 2.54, -0.315], [0.05, 0.56, 0.04]),
    onChest(box([0.12, 2.17, chestFace + 0.03], [0.34, 0.05, 0.05])), // under the chest plate
  );

  // ---- Radome head. Round in plan so the glowing ring round its middle stands proud by the same amount all the way
  // round. The collar's bolts are painted on (the atlas's rivets), not modelled.
  // The dome is the silhouette, so it gets the most sides: its outline stays round even close up. Near and middle it
  // is smooth (gate V10), so its glossy highlight is one soft-edged curve rather than a lit facet; the middle level
  // keeps its old number of sides, so the outline does not jump at the switch. Far off it is a plain flat ball.
  const domeSkin = (sides: number, lats: number[], smooth: number) => lathe([
    [0, Math.sin(lats[0]! * deg) * domeRadii[1]], // the flat bottom it sits on in the collar
    ...lats.map((lat): P2 => [Math.cos(lat * deg) * domeRadii[0], Math.sin(lat * deg) * domeRadii[1]]),
  ], domeCentre, "y", sides, { smooth });
  const sensor = pick(
    domeSkin(36, [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90], 20),
    domeSkin(14, [-50, -20, 10, 40, 70, 90], 35),
    ellipsoid(domeCentre, domeRadii, 8, [-50, -10, 35, 70]),
  );
  // The dome is opaque, so the sensor array inside it looks out through a window in the front: a row of lenses (one
  // glowing strip from the middle level out) in a dark bezel, sunk into the skin.
  const windowAt = onDome(0, windowLat, -0.02);
  const onWindow = (m: MeshData) => turn(m, [windowTilt, 0, 0], windowAt);
  const sensorRing = merge(
    drum(domeCentre, pick(0.455, 0.455, 0.45), pick(0.05, 0.05, 0.07), "y", [36, 14, 8]), // the far level has no frame ring round it
    // Each lens is the face of a barrel standing out of the bezel (Sensor_Frame). Not sunk into it: the outline
    // shell would swell out of a hole that small.
    nearOnly(() => merge(...lensXs.map((x) => onWindow(drum(add(windowAt, [x, 0, -0.07]), 0.029, 0.01, "z", [14, 8, 8]))))),
    pick(empty(), onWindow(box(add(windowAt, [0, 0, -0.035]), [0.23, 0.04, 0.02])), empty()),
  );
  // The ribs follow the dome's curve in short stretches, so they lie on the smooth skin all the way up.
  const ribLats = [6, 18, 30, 42, 54, 66, 80];
  const sensorFrame = merge(
    drum([0, 3.2, 0.02], 0.22, 0.15, "y", [32, 12, 8], 0.31), // collar, flaring up to cup the dome
    // The dome turns on a bearing ring at the foot of the collar, so it can sweep without the chest turning.
    notFar(() => drum([0, 3.14, 0.02], 0.3, 0.04, "y", [32, 12, 8])),
    // The frame ring the two halves of the dome are clamped into; the glowing band runs in a channel round it.
    notFar(() => drum(domeCentre, 0.442, 0.11, "y", [36, 14, 8])),
    // Four ribs over the seams between the dome's panels, meeting at a hub on top. They miss the front, where the
    // window looks out.
    nearOnly(() => merge(...[45, 135, 225, 315].map((round) => bent(ribLats.map((lat) => {
      // Square to the skin: its foot sunk a centimetre in, its top 2.5 cm proud, 4 cm wide.
      const side = scale(unit([Math.cos(round * deg), 0, Math.sin(round * deg)]), 0.02);
      const foot = onDome(round, lat, -0.01), top = onDome(round, lat, 0.025);
      return [add(foot, side), add(top, side), sub(top, side), sub(foot, side)];
    }))))),
    notFar(() => drum([0, domeCentre[1] + domeRadii[1] - 0.008, 0], 0.09, 0.05, "y", [20, 8, 6])), // hub
    notFar(() => onWindow(box(windowAt, [0.3, 0.1, 0.07], c(0.015)))), // the window's bezel
    // The lens barrels, standing three centimetres out of the bezel, so the sensor array has depth seen from the side.
    nearOnly(() => merge(...lensXs.map((x) => onWindow(drum(add(windowAt, [x, 0, -0.05]), 0.039, 0.035, "z", [14, 8, 8]))))),
  );
  const mast = merge(
    bar([-0.42, 3.06, 0.24], [mastX, 3.16, mastZ], [0.13, 0.11], c(0.03)), // bracket off the yoke
    notFar(() => box([mastX, 3.2, mastZ], [0.26, 0.13, 0.26], c(0.03))),
    drum([mastX, (3.2 + mastTop) / 2, mastZ], 0.07, mastTop - 3.2, "y", [12, 6, 4], 0.05),
    box([mastX, mastTop - 0.5, mastZ], [0.42, 0.09, 0.09], c(0.02)), // antenna elements
    box([mastX, mastTop - 0.28, mastZ], [0.3, 0.08, 0.08], c(0.02)),
    drum([mastX, mastTop + 0.045, mastZ], 0.09, 0.09, "y", [12, 6, 4], 0.055), // beacon
    // A dish on a short arm, turned out to the left: the long link back to the team, while the elements above talk
    // to the drones.
    notFar(() => merge(
      bar([mastX, 3.72, mastZ], [mastX - 0.11, 3.72, mastZ], [0.045, 0.045]),
      // Near (gate V10) the dish is a real bowl: a shallow dished face inside a rim, on a cone back to its arm.
      pick(lathe([[0, -0.006], [0.06, -0.01], [0.12, -0.022], [0.17, -0.0325], [0.17, -0.02], [0.045, 0.0325], [0, 0.0325]], [mastX - 0.145, 3.72, mastZ], "x", 16, { smooth: 25 }),
        cylinder([mastX - 0.145, 3.72, mastZ], 0.17, 0.065, "x", 6, 0.045), cylinder([mastX - 0.145, 3.72, mastZ], 0.17, 0.065, "x", 4, 0.045)),
    )),
  );

  // ---- Arms. Slim upper arms, chunky forearm housings held forward with a light SMG in each wrist: at range the
  // forearms are the hands, so they carry the mass. The right one is the weapon in hand (Mount_Gun at its muzzle);
  // the left is the backup (Mount_Gun_2), and they fire in turn.
  const armR = merge(
    bar([1.0, 2.86, 0.02], [1.0, 2.32, 0.0], [0.22, 0.24], c(0.04), [0.2, 0.22]),
    notFar(() => bar([1.125, 2.8, 0.02], [1.125, 2.42, 0.01], [0.05, 0.26], c(0.018))), // outer arm plate
    slab([[2.19, -0.05], [2.49, -0.05], [2.52, -0.6], [2.44, -0.8], [2.22, -0.8]], "x", 0.95, 1.23, c(0.035)), // forearm
    notFar(() => bar([1.235, 2.36, -0.14], [1.235, 2.36, -0.66], [0.04, 0.22], c(0.015))), // forearm side plate
  );
  const armL = merge(
    bar([-1.0, 2.84, 0.02], [-1.0, 2.32, 0.0], [0.2, 0.22], c(0.04), [0.19, 0.21]),
    slab([[2.19, -0.05], [2.45, -0.05], [2.47, -0.56], [2.41, -0.74], [2.21, -0.74]], "x", -1.19, -0.94, c(0.035)),
  );
  // The elbow actuator runs down the front of the upper arm onto the top of the forearm.
  const elbowRam = (x: number): MeshData => notFar(() => merge(
    rod([x, 2.78, -0.13], [x, 2.62, -0.21], 0.045, [14, 6, 6]),
    nearOnly(() => rod([x, 2.66, -0.19], [x, 2.5, -0.31], 0.025, [10, 6, 6])),
  ));
  const pauldronTurn = (side: number): V3 => [0, 0, -0.15 * side];
  // The arm is lifted by a ram from under the back of the yoke onto the back of the upper arm.
  const liftRam = (side: number): MeshData => nearOnly(() => merge(
    ramLod([0.5 * side, 2.88, 0.22], [0.97 * side, 2.64, 0.15], 0.035, [12, 6, 6]),
    box([0.97 * side, 2.64, 0.13], [0.06, 0.06, 0.05]),
  ));
  const armFrameR = merge(
    drum([1.02, 2.3, 0], 0.13, 0.28, "x", [16, 6, 6]), // elbow
    drum([1.2, 2.4, -0.81], 0.14, 0.07, "z", [16, 6, 6]), // wrist collar the gun sits in
    elbowRam(1.0),
    liftRam(1),
  );
  const armFrameL = merge(
    drum([-1.02, 2.3, 0], 0.12, 0.26, "x", [16, 6, 6]),
    drum([-1.14, 2.37, -0.75], 0.12, 0.06, "z", [16, 6, 6]),
    elbowRam(-1.0),
    liftRam(-1),
  );
  // Power to the elbow motors, a hose from behind each shoulder joint down the back of the upper arm, and on the
  // right the fire control line from under the forearm into the back of the receiver.
  const armHoses = merge(
    ...[1, -1].map((s) => notFar(() => hoseRun([[0.74 * s, 3.0, 0.12], [1.05 * s, 2.7, 0.17], [1.04 * s, 2.42, 0.11]], 0.032, [8, 5, 4]))),
    nearOnly(() => hoseRun([[1.12, 2.18, -0.6], [1.13, 2.17, -0.8], [1.16, 2.28, -0.86]], 0.026, [8, 5, 5])),
  );
  // A shell over the shoulder, a plate on top and a lip below that stands out past it, so the edge shows its layers.
  const pauldron = (side: number, centre: V3, size: V3) => merge(
    turn(box(centre, size, c(0.06)), pauldronTurn(side), centre),
    notFar(() => turn(box(add(centre, [-0.02 * side, size[1] / 2 + 0.03, 0]), [size[0] - 0.1, 0.06, size[2] - 0.1], c(0.02)), pauldronTurn(side), centre)),
    notFar(() => turn(box(add(centre, [0.03 * side, -size[1] / 2 + 0.02, 0]), [size[0] + 0.04, 0.07, size[2] + 0.06], c(0.02)), pauldronTurn(side), centre)),
  );
  const gunR = merge(
    // Receiver, its nose sloped down into the shroud.
    slab([[2.28, -0.75], [2.52, -0.75], [2.52, -1.1], [2.48, -1.21], [2.28, -1.21]], "x", 1.1, 1.3, c(0.025)),
    turn(box([1.2, 2.2, -0.92], [0.12, 0.22, 0.14], c(0.02)), [-12 * deg, 0, 0], [1.2, 2.3, -0.92]), // magazine, raked forward
    notFar(() => box([1.2, 2.54, -0.98], [0.06, 0.04, 0.28], c(0.012))), // sight rail
    notFar(() => box([1.2, 2.595, -0.94], [0.08, 0.07, 0.17], c(0.012))), // sight, its lens to the pilot
  );
  // The backup is the same submachine gun cut down: a shorter receiver sloped into its shroud, a magazine raked
  // forward, no sight (it is fired off the right one's).
  const gunL = merge(
    slab([[2.28, -0.7], [2.46, -0.7], [2.46, -0.98], [2.42, -1.06], [2.28, -1.06]], "x", -1.22, -1.06, c(0.025)),
    nearOnly(() => turn(box([-1.14, 2.215, -0.86], [0.09, 0.13, 0.11], c(0.012)), [-12 * deg, 0, 0], [-1.14, 2.28, -0.86])), // magazine
  );
  // The bare steel of both guns: shroud, barrel and muzzle brake. Near (gate V10) the shroud is a sleeve with the
  // barrel showing inside its mouth, and the brake a collar round the barrel's end, which stops a few centimetres
  // inside it, so the muzzle reads as a hole. The muzzle mounts (Mount_Gun, Mount_Gun_2) sit on the brakes' faces,
  // where shots leave.
  const gunBarrels = merge(
    pick(hollow([1.2, 2.4, -1.3], 0.095, 0.062, 0.2, "z", 16), cylinder([1.2, 2.4, -1.3], 0.095, 0.2, "z", 6), cylinder([1.2, 2.4, -1.3], 0.095, 0.2, "z", 6)), // shroud
    pick(drum([1.2, 2.4, -1.45], 0.045, 0.34, "z", [12, 6, 6]), cylinder([1.2, 2.4, -1.48], 0.045, 0.2, "z", 6), cylinder([1.2, 2.4, -1.48], 0.045, 0.2, "z", 6)), // barrel
    // The muzzle brake, its face at z = -1.65.
    pick(hollow([1.2, 2.4, -1.615], 0.078, 0.061, 0.07, "z", 12), cylinder([1.2, 2.4, -1.615], 0.065, 0.07, "z", 6), empty()),
    pick(hollow([-1.14, 2.37, -1.1], 0.07, 0.045, 0.14, "z", 12), empty(), empty()), // the backup's shroud
    pick(drum([-1.14, 2.37, -1.175], 0.034, 0.22, "z", [12, 6, 6]), cylinder([-1.14, 2.37, -1.15], 0.04, 0.2, "z", 6), cylinder([-1.14, 2.37, -1.15], 0.04, 0.2, "z", 6)),
    // Its brake, its face at z = -1.3.
    pick(hollow([-1.14, 2.37, -1.2825], 0.068, 0.061, 0.035, "z", 12), cylinder([-1.14, 2.37, -1.27], 0.06, 0.06, "z", 6), cylinder([-1.14, 2.37, -1.27], 0.06, 0.06, "z", 6)),
  );

  // ---- Drones (no hit boxes): white pods, each flown by two ducted fans at its sides, with a glowing teal eye in a
  // dark bezel under an armoured brow, and a repair emitter under the nose. Big enough to stay four separate shapes at
  // 150 m. Each is held out on a two-segment pylon from the shoulders or the back, its clamp gripping a docking ring
  // on the hull, with the glowing tether that gives the drone its name run along the pylon. Far off the fans are too
  // small to see, so the far level keeps flat fins in their place.
  // Gate V10: near and middle the pod is a smooth oval, near its fans sit inside open ducts and its eye down a
  // housing, so both show real depth; a ring round its middle carries the two ducts. The middle level keeps solid
  // ducts and a flush eye, the same outline.
  const fanAt = (side: number): V3 => [0.4 * side, 0, 0.07];
  const podRadii: V3 = [0.27, 0.2, 0.34];
  const podSkin = (sides: number, lats: number[], smooth: number) =>
    lathe(lats.map((lat): P2 => [Math.cos(lat * deg) * podRadii[2], Math.sin(lat * deg) * podRadii[1]]), [0, 0, 0], "y", sides, { smooth, stretch: podRadii[0] / podRadii[2] });
  const pod = merge(
    pick(podSkin(12, [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90], 30), podSkin(8, [-90, -30, 30, 70, 90], 70), ellipsoid([0, 0, 0], podRadii, 6, [-90, 0, 60])),
    pick(empty(), empty(), box([0, 0, 0.08], [0.72, 0.07, 0.18])), // stabiliser fins
    pick(
      merge(...[1, -1].map((s) => hollow(fanAt(s), 0.15, 0.125, 0.09, "y", 12))), // fan ducts
      merge(...[1, -1].map((s) => cylinder(fanAt(s), 0.15, 0.09, "y", 8))),
      empty(),
    ),
    // The ring round the pod's girth the ducts hang off: the pod's frame, and the part the clamp lifts it by.
    nearOnly(() => hollow([0, 0, fanAt(1)[2]], 0.295, 0.24, 0.07, "z", 12, 0.74)),
    // The brow juts out over the eye, so the pod has a face, and a direction, even as a silhouette.
    notFar(() => box([0, 0.15, -0.24], [0.3, 0.06, 0.26], c(0.02))),
  );
  const eye = merge(
    pick(drum([0, 0, -0.36], 0.114, 0.02, "z", [12, 8, 6]), cylinder([0, 0, -0.3], 0.12, 0.1, "z", 8), cylinder([0, 0, -0.3], 0.12, 0.1, "z", 6)),
    nearOnly(() => box([0, -0.19, -0.11], [0.1, 0.05, 0.13])), // repair emitter
  );
  // The dark parts of a pod: the eye's housing, and the fans inside the ducts (near, a disc halfway down the duct;
  // further out a dark face standing just past the duct rims).
  const podDark = pick(
    merge(
      hollow([0, 0, -0.2925], 0.15, 0.115, 0.185, "z", 12),
      ...[1, -1].map((s) => drum(fanAt(s), 0.124, 0.015, "y", [10, 8, 6])),
    ),
    merge(cylinder([0, 0, -0.265], 0.15, 0.06, "z", 8), ...[1, -1].map((s) => cylinder(fanAt(s), 0.12, 0.1, "y", 8))),
    empty(),
  );
  const pylon = (p: DronePlace) => {
    const out = unit(sub(p.elbow, p.mount)), fromPod = unit(sub(p.elbow, p.at));
    const nearPod = (d: number) => add(p.at, scale(fromPod, d));
    const hinge = unit(cross(sub(p.elbow, p.mount), sub(p.at, p.elbow))); // across the bend
    const [u] = sideways(p.elbow, p.at);
    return merge(
      notFar(() => placed(podDark, p)),
      // Far off a pylon is under a pixel wide, so the far level draws it thicker to keep the ring of drones joined up.
      bar(p.mount, p.elbow, pick<P2>([0.12, 0.12], [0.12, 0.12], [0.16, 0.16]), c(0.025)),
      bar(p.elbow, p.at, pick<P2>([0.1, 0.1], [0.1, 0.1], [0.14, 0.14]), c(0.02)),
      notFar(() => rod(add(p.elbow, scale(hinge, -0.09)), add(p.elbow, scale(hinge, 0.09)), 0.08, [14, 6, 6])), // elbow hinge
      nearOnly(() => merge(
        // The hinge pin's heads, standing out of the knuckle on both sides, so the elbow reads as a joint.
        ...[1, -1].map((s) => rod(add(p.elbow, scale(hinge, 0.088 * s)), add(p.elbow, scale(hinge, 0.115 * s)), 0.05, [8, 6, 6])),
        rod(add(p.mount, scale(out, -0.05)), add(p.mount, scale(out, 0.03)), 0.11, [12, 6, 6]), // the swivel the pylon turns on
        // The ram that folds the pylon, beside it across the inside of the bend.
        ramLod(add(lerp(p.mount, p.elbow, 0.45), scale(hinge, 0.085)), add(lerp(p.elbow, p.at, 0.4), scale(hinge, 0.075)), 0.032, [8, 6, 6]),
        rod(nearPod(0.22), nearPod(0.31), 0.095, [12, 6, 6]), // docking ring on the hull
        bar(nearPod(0.48), nearPod(0.39), [0.16, 0.16]), // the clamp's body, and its two jaws reaching onto the ring
        ...[1, -1].map((s) => bar(add(nearPod(0.42), scale(u, 0.08 * s)), add(nearPod(0.26), scale(u, 0.105 * s)), [0.035, 0.07])),
      )),
    );
  };
  // The tether: a glowing line from the chassis along the far side of the pylon from the ram, into the docking ring.
  const tether = (p: DronePlace) => {
    const hinge = unit(cross(sub(p.elbow, p.mount), sub(p.at, p.elbow)));
    const off = (q: V3, d: number) => add(q, scale(hinge, -d));
    return nearOnly(() => sweep([off(p.mount, 0.075), off(p.elbow, 0.095), off(add(p.at, scale(unit(sub(p.elbow, p.at)), 0.29)), 0.065)], 0.018, 6));
  };

  const mirrorLeg = (m: MeshData) => merge(m, mirrorX(m));
  return {
    Torso: torso,
    Torso_Frame: torsoFrame,
    Torso_Trim: torsoTrim,
    Torso_Glow: torsoGlow,
    Torso_Hoses: torsoHoses,
    Sensor: sensor,
    Sensor_Ring: sensorRing,
    Sensor_Frame: sensorFrame,
    Mast: mast,
    Drones: merge(...dronePlaces.map((p) => placed(grown(pod, pick(1, 1, 1.25)), p))),
    Drone_Eyes: merge(...dronePlaces.map((p) => merge(placed(grown(eye, pick(1, 1, 1.25)), p), tether(p)))),
    Drone_Pylons: merge(...dronePlaces.map(pylon)),
    Leg_L: mirrorX(legShellR),
    Leg_R: legShellR,
    Leg_Frame: mirrorLeg(legFrameR),
    Leg_Glow: mirrorLeg(legGlowR),
    Leg_Hoses: mirrorLeg(legHoseR),
    Arm_L: armL,
    Arm_R: armR,
    Arm_Frame_L: armFrameL,
    Arm_Frame_R: armFrameR,
    Arm_Hoses: armHoses,
    Arm_Glow_L: box([-1.065, 2.47, -0.26], [0.05, 0.04, 0.3]),
    Arm_Glow_R: merge(box([1.09, 2.525, -0.42], [0.07, 0.04, 0.42]), nearOnly(() => box([1.2, 2.6, -0.851], [0.05, 0.035, 0.012]))),
    Arm_Accent: box([-1.065, 2.33, -0.52], [0.28, 0.31, 0.1], c(0.02)), // the pilot's band round the left forearm
    // Broad, high shoulders: the shell is the widest thing on the body under the dome.
    Pauldron_L: pauldron(-1, [-0.93, 2.98, 0.02], [0.4, 0.26, 0.54]),
    Pauldron_R: pauldron(1, [0.96, 3.0, 0.02], [0.46, 0.3, 0.6]),
    Gun_R: gunR,
    Gun_L: gunL,
    Gun_Barrels: gunBarrels,
  };
}

// Each part's hit zone, paint (a name from `scheme`, or one the game knows), finish and flags; see
// packages/client/src/mechKit.ts. Finish is how the paint is lit: painted armour, bare metal with one hard highlight,
// or rubber with no rim light.
type Finish = "paint" | "metal" | "rubber";
type Look = { zone: "legs" | "arms" | "torso"; paint: string; finish?: Finish; glow?: true; rusts?: false; noHit?: true };
const painted = (zone: Look["zone"], paint: string): Look => ({ zone, paint, finish: "paint" });
const frame = (zone: Look["zone"], finish: Finish): Look => ({ zone, paint: "frame", finish, rusts: false });
const glow = (zone: Look["zone"]): Look => ({ zone, paint: "tealGlow", glow: true });
// Hoses lie along parts that have hit boxes of their own, so they need none.
const hose = (zone: Look["zone"]): Look => ({ zone, paint: "hose", finish: "rubber", rusts: false, noHit: true });
const looks: Record<string, Look> = {
  Torso: painted("torso", "white"),
  Torso_Frame: frame("torso", "paint"),
  Torso_Trim: painted("torso", "teal"),
  Torso_Glow: glow("torso"),
  Torso_Hoses: hose("torso"),
  // The dome is metal for its gloss: one hard highlight on the big round shape is what makes it read as a reflective
  // sensor dome rather than a painted ball.
  Sensor: { zone: "torso", paint: "dome", finish: "metal", rusts: false },
  Sensor_Ring: { zone: "torso", paint: "domeGlow", glow: true, rusts: false },
  Sensor_Frame: frame("torso", "metal"),
  Mast: frame("torso", "metal"),
  Drones: { ...painted("torso", "white"), noHit: true },
  Drone_Eyes: { zone: "torso", paint: "tealGlow", glow: true, noHit: true },
  Drone_Pylons: { ...frame("torso", "paint"), noHit: true },
  Leg_L: painted("legs", "white"),
  Leg_R: painted("legs", "white"),
  Leg_Frame: frame("legs", "metal"),
  Leg_Glow: glow("legs"),
  Leg_Hoses: hose("legs"),
  Arm_L: painted("arms", "white"),
  Arm_R: painted("arms", "white"),
  Arm_Frame_L: frame("arms", "metal"),
  Arm_Frame_R: frame("arms", "metal"),
  Arm_Hoses: hose("arms"),
  Arm_Glow_L: glow("arms"),
  Arm_Glow_R: glow("arms"),
  Arm_Accent: painted("arms", "accent"),
  Pauldron_L: painted("arms", "teal"),
  Pauldron_R: painted("arms", "teal"),
  Gun_R: painted("arms", "weapon"),
  Gun_L: painted("arms", "weapon"),
  Gun_Barrels: frame("arms", "metal"),
};
// Three values apart from each other and from the ground (moss, dirt and rust all render as a middle grey): white
// armour is the light, teal trim the middle, a step above the ground, and the frame, the hoses and the deep blue dome
// the dark, a step below it. So the dome reads as a dark round head on a light body against any ground.
const scheme = { white: "#F2F2EE", teal: "#5EDED2", frame: "#2C3640", dome: "#2050C0", hose: "#1E2226", tealGlow: "#3FF0E0", domeGlow: "#9FD8FF" };

const levels = [build(0), build(1), build(2)];
const nodes: NodeData[] = [
  // The nearest level is the part's own name; the simpler ones are <Part>_LOD1 and <Part>_LOD2.
  ...levels.flatMap((parts, lod) => Object.keys(looks).map((name) => ({ name: lod === 0 ? name : `${name}_LOD${lod}`, mesh: parts[name]! }))),
  { name: "Mount_Gun", translation: [1.2, 2.4, -1.65] },
  { name: "Mount_Gun_2", translation: [-1.14, 2.37, -1.3] },
  { name: "Torso_Fx", translation: [0, 2.6, -0.34] },
  { name: "Arm_R_Fx", translation: [1.08, 2.34, -0.3] },
  { name: "Leg_L_Fx", translation: [-legX, 1.02, -0.3] },
  // The two-bone chain ends at the hock; the short bone to the ankle and the magnetic foot stay as they are.
  ...bothLegs(hip, knee, hock, [legX, 0, ankle[2]]),
];

const root = new URL("../..", import.meta.url).pathname;
const dir = join(root, "assets/models/mechs/arbiter");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Arbiter.glb"), writeGlb(nodes, { quantize: true }));
// What moves (gate V9b): the leg rams slide; the mast whips about its foot and each drone sways on its pylon about
// the swivel at the hull, all on springs (data/sway.json). The sleeves are shell paint (Leg_R), the rods frame.
const motionR = [
  piston("Thigh_Ram_R", ["Leg_R", "Leg_Frame"], ["thigh_R", thighRam[0]], ["shin_R", thighRam[1]], 0.1),
  piston("Calf_Ram_R", ["Leg_R", "Leg_Frame"], ["shin_R", calfRam[0]], ["foot_R", calfRam[1]], 0.13),
];
const motion = [
  ...motionR, ...motionR.map(leftOf),
  sway("Mast", ["Mast"], "body", [[mastX, 3.27, mastZ], [mastX, mastTop + 0.08, mastZ]], 0.3, "mast"),
  ...dronePlaces.map((p, i) => sway(`Drone_${i + 1}`, ["Drones", "Drone_Eyes", "Drone_Pylons"], "body", [p.mount, p.elbow, p.at, eyeOf(p)], 0.62, "drone")),
];
writeFileSync(join(root, "scripts/mechs/arbiter.kit.json"), `${JSON.stringify({ scheme, parts: looks, motion }, null, 2)}\n`);
const count = (lod: number) => Object.values(levels[lod]!).reduce((s, m) => s + triangles(m), 0);
console.log(`Mech_Arbiter.glb: ${count(0)} triangles near, ${count(1)} and ${count(2)} at range (${count(0) + count(1) + count(2)} in the file)`);
for (const name of Object.keys(looks)) console.log(`  ${name.padEnd(13)} ${levels.map((l) => String(triangles(l[name]!)).padStart(5)).join(" ")}`);
