// Cataclysm, the artillery mech (docs/MECH_ROSTER.md, section 3): a squat armoured hull in desert camouflage on four
// heavy hydraulic legs, a twin-barrel rail mortar on a traverse ring in the middle, a low sensor turret with a cluster
// of glowing lenses set into the glacis, and point-defence laser turrets on the front corners. At range it should read
// as "four legs and the two long barrels": knees peaking over the deck, long thick barrels, big calm plates, and a
// light tan body over darker brown camouflage so its values sit apart from the moss and rust it walks on.
// Run: npx tsx scripts/mechs/cataclysm.ts  →  assets/models/mechs/cataclysm/Mech_Cataclysm.glb and, next to this
// file, cataclysm.kit.json (each part's zone, paint and flags).
// Metres, Y up, facing -Z, right side +X, feet at y = 0. Every part is built in place on the assembled mech.
// Bolts and rivets are not modelled: the painted atlas's mech surface draws them up close, and the triangles go to the
// silhouette instead (knee caps, feet, barrels, hoses).
// Each part is built three times: near (chamfered armour, seams, round forms with up to 24 sides, plates layered on
// frame plates; under the 15k budget, gate V10), middle (plain blocks, from 25 m) and far
// (the main masses only, from 80 m; data/mechKits.json lodDistances). They are written as Part, Part_LOD1, Part_LOD2.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { legJoints, mirrorX as mirrorPointX, mirrorZ as mirrorPointZ } from "./joints";
import { mirrored, piston } from "./motion";
import { box, convex, cylinder, empty, merge, mirrorX, prism, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

const root = new URL("../..", import.meta.url).pathname;
const out = join(root, "assets/models/mechs/cataclysm/Mech_Cataclysm.glb");
const deg = Math.PI / 180;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

// ---- Shape helpers of this mech's own.

// A box with all twelve edges cut at 45 degrees by `c`: 44 triangles (shapes.box's bevel costs 60), and no razor
// edge for the outline to catch. Faces: six sides, twelve edge strips, eight corner triangles.
function chamferBox(centre: V3, size: V3, c: number): MeshData {
  const h = [size[0] / 2, size[1] / 2, size[2] / 2];
  const k = Math.min(c, h[0]! * 0.45, h[1]! * 0.45, h[2]! * 0.45);
  // A corner of octant s, pushed fully out along `axis` and held in by the chamfer along the other two.
  const v = (s: number[], axis: number): V3 => [0, 1, 2].map((i) => centre[i]! + s[i]! * (i === axis ? h[i]! : h[i]! - k)) as V3;
  const faces: V3[][] = [];
  const around: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, d = (a + 2) % 3;
    for (const sa of [-1, 1]) {
      faces.push(around.map(([u, w]) => { const s = [0, 0, 0]; s[a] = sa; s[b] = u; s[d] = w; return v(s, a); }));
      for (const sb of [-1, 1]) {
        const s = (t: number) => { const r = [0, 0, 0]; r[a] = sa; r[b] = sb; r[d] = t; return r; };
        faces.push([v(s(1), a), v(s(1), b), v(s(-1), b), v(s(-1), a)]);
      }
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) faces.push([0, 1, 2].map((axis) => v([sx, sy, sz], axis)));
  return convex(faces);
}

// A convex outline pulled in by `c` on every side, either winding.
function inset(outline: [number, number][], c: number): [number, number][] {
  const n = outline.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = outline[i]!, b = outline[(i + 1) % n]!; area += a[0] * b[1] - b[0] * a[1]; }
  const sign = area > 0 ? 1 : -1;
  const inward = (a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [(-dy / l) * sign, (dx / l) * sign]; };
  return outline.map((p, i) => {
    const n1 = inward(outline[(i - 1 + n) % n]!, p), n2 = inward(p, outline[(i + 1) % n]!);
    const f = c / (1 + n1[0]! * n2[0]! + n1[1]! * n2[1]!);
    return [p[0] + (n1[0]! + n2[0]!) * f, p[1] + (n1[1]! + n2[1]!) * f];
  });
}

// shapes.prism with both end edges chamfered by `c`, so a slab cut from a side profile has no razor edges either.
function chamferPrism(outline: [number, number][], axis: "x" | "y" | "z", from: number, to: number, c: number): MeshData {
  const at = (u: number, v: number, w: number): V3 => (axis === "x" ? [w, u, v] : axis === "y" ? [v, w, u] : [u, v, w]);
  const small = inset(outline, c);
  const rings = ([[small, from], [outline, from + c], [outline, to - c], [small, to]] as const).map(([o, w]) => o.map(([u, v]) => at(u, v, w)));
  const faces: V3[][] = [rings[0]!, rings[3]!];
  for (let r = 0; r < 3; r++) for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    faces.push([rings[r]![i]!, rings[r]![j]!, rings[r + 1]![j]!, rings[r + 1]![i]!]);
  }
  return convex(faces);
}

// The u, v, w frame shapes.cylinder uses for an axis: w along it.
const onAxis = (axis: "x" | "y" | "z", u: number, v: number, w: number): V3 => (axis === "x" ? [w, u, v] : axis === "y" ? [v, w, u] : [u, v, w]);
const centreOnAxis = (c: V3, axis: "x" | "y" | "z"): V3 => (axis === "x" ? [c[1], c[2], c[0]] : axis === "y" ? [c[2], c[0], c[1]] : c);
const circle = (sides: number, r: number) => Array.from({ length: sides }, (_, i) => [Math.cos((i / sides) * Math.PI * 2) * r, Math.sin((i / sides) * Math.PI * 2) * r] as [number, number]);

// A cylinder (or cone) with both end rims cut at 45 degrees by `c`: the round form's answer to chamferBox, so a drum's
// rim catches a lit band instead of a razor edge. 8 x sides - 4 triangles.
function roundDrum(centre: V3, radius: number, length: number, axis: "x" | "y" | "z", sides: number, c: number, endRadius = radius): MeshData {
  const [cu, cv, cw] = centreOnAxis(centre, axis);
  const k = Math.min(c, length * 0.45, radius * 0.45, endRadius * 0.45);
  const ring = (r: number, w: number) => circle(sides, r).map(([u, v]) => onAxis(axis, cu + u, cv + v, cw + w));
  const rings = [ring(radius - k, -length / 2), ring(radius, -length / 2 + k), ring(endRadius, length / 2 - k), ring(endRadius - k, length / 2)];
  const faces: V3[][] = [rings[0]!, rings[3]!];
  for (let r = 0; r < 3; r++) for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faces.push([rings[r]![i]!, rings[r]![j]!, rings[r + 1]![j]!, rings[r + 1]![i]!]);
  }
  return convex(faces);
}

// Faces with the side each must face given, for the few solids here that are not convex (shapes.convex turns every
// face away from the middle, which would turn a bore's inner wall inside out).
function facing(faces: { points: V3[]; out: V3 }[]): MeshData {
  const res = empty();
  for (const { points, out } of faces) {
    let n = unit(cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!)));
    let p = points;
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) { n = scale(n, -1); p = [...points].reverse(); }
    const base = res.positions.length / 3;
    for (const q of p) { res.positions.push(...q); res.normals.push(...n); }
    for (let i = 1; i < p.length - 1; i++) res.indices.push(base, base + i, base + i + 1);
  }
  return res;
}

// A thick-walled tube, open through the middle: a muzzle with a real bore, a lens hood. 8 x sides triangles.
function hollowRing(centre: V3, inner: number, outer: number, length: number, axis: "x" | "y" | "z", sides: number): MeshData {
  const [cu, cv, cw] = centreOnAxis(centre, axis);
  const ring = (r: number, w: number) => circle(sides, r).map(([u, v]) => onAxis(axis, cu + u, cv + v, cw + w));
  const along = onAxis(axis, 0, 0, 1);
  const [oa, ob, ia, ib] = [ring(outer, -length / 2), ring(outer, length / 2), ring(inner, -length / 2), ring(inner, length / 2)];
  const faces: { points: V3[]; out: V3 }[] = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const radial = sub(lerp(oa[i]!, oa[j]!, 0.5), onAxis(axis, cu, cv, cw - length / 2));
    faces.push({ points: [oa[i]!, oa[j]!, ob[j]!, ob[i]!], out: radial });
    faces.push({ points: [ia[i]!, ia[j]!, ib[j]!, ib[i]!], out: scale(radial, -1) });
    faces.push({ points: [oa[i]!, oa[j]!, ia[j]!, ia[i]!], out: scale(along, -1) });
    faces.push({ points: [ob[i]!, ob[j]!, ib[j]!, ib[i]!], out: along });
  }
  return facing(faces);
}

// A ring gear lying flat: `teeth` square-cut teeth standing out of a drum's rim between heights y0 and y1, each its
// own small block on the rim.
function gearTeeth(centre: V3, root: number, tip: number, y0: number, y1: number, teeth: number): MeshData {
  const pitch = (Math.PI * 2 * root) / teeth;
  const tooth = prism([[-pitch * 0.3, root - 0.01], [pitch * 0.3, root - 0.01], [pitch * 0.18, tip], [-pitch * 0.18, tip]], "y", y0, y1);
  return merge(...Array.from({ length: teeth }, (_, i) => turn(tooth, [0, (i / teeth) * Math.PI * 2, 0], [0, 0, 0], centre)));
}

// Lays a mesh built along z, centred on the origin, onto the line from a to b. Its x stays horizontal, so a leg beam's
// width runs front to back and its height faces outward. The basis is a proper rotation, so faces stay outward.
// Not for vertical lines (its sideways axis would vanish); the mech has none.
function along(mesh: MeshData, a: V3, b: V3): MeshData {
  const d = unit(sub(b, a));
  const side = unit(cross([0, 1, 0], d)), up = cross(d, side);
  const mid = lerp(a, b, 0.5);
  const map = (p: V3): V3 => add(add(scale(side, p[0]), scale(up, p[1])), scale(d, p[2]));
  const res = empty();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    res.positions.push(...add(mid, map([mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!])));
    res.normals.push(...map([mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!]));
  }
  res.indices = [...mesh.indices];
  return res;
}
// The sideways and upward axes `along` uses for a line, for placing things on a beam's faces.
const frameOf = (a: V3, b: V3) => { const d = unit(sub(b, a)); const side = unit(cross([0, 1, 0], d)); return { d, side, up: cross(d, side) }; };

const mirrorZ = (m: MeshData) => turn(mirrorX(m), [0, Math.PI, 0]); // mirror in x, then turn half round: a z mirror
const bothSides = (m: MeshData) => merge(m, mirrorX(m));

// ---- Fixed points, shared by every level of detail.

// Hull side profile (y, z), swept across x. The belly sits at 1.44 so that, when the legs break and the mech drops
// 1.3 m, it rests just off the ground. A sloped glacis in front, a short slope at the back.
const deckY = 2.4;
const hullHalf = 1.15;
const hullOutline: [number, number][] = [[1.5, -0.95], [1.5, 1.0], [1.85, 1.3], [2.3, 1.3], [deckY, 1.05], [deckY, -0.7], [2.15, -1.3], [1.8, -1.3]];
const glacisTop: [number, number] = [deckY, -0.7], glacisFoot: [number, number] = [2.15, -1.3];
const glacisAngle = -Math.atan2(0.25, 0.6); // the glacis drops 0.25 m over 0.6 m toward the front
const onGlacis = (x: number, z: number, lift: number): V3 => {
  const y = deckY - (-0.7 - z) * (0.25 / 0.6);
  return [x, y + lift * Math.cos(glacisAngle), z + lift * Math.sin(glacisAngle)];
};
const hipY = 1.85, hipZ = -0.95;
// The glacis plates stand this far off the hull at every level, so the outline holds at 25 m; up close a frame plate
// fills the gap under each, so the armour reads as hung in layers.
const glacisLift = 0.03;

// The rail mortar: the barrels are built level along -Z from the trunnion, then raised. Long and low reads as a siege
// gun at range; 23 degrees and 3.25 m keep the muzzles at the 4.2 m the shots have always left from.
const ringZ = 0.35;
const pivot: V3 = [0, 2.95, 0.6];
const elevation = 23 * deg;
const barrelLength = 3.25;
const barrelX = 0.28;
const raise = (m: MeshData) => turn(m, [elevation, 0, 0], pivot);
const at = (x: number, dy: number, dz: number): V3 => [x, pivot[1] + dy, pivot[2] + dz];
const muzzleAt = (x: number): V3 => [x, pivot[1] + barrelLength * Math.sin(elevation), pivot[2] - barrelLength * Math.cos(elevation)];

// Point-defence turrets on the front corners.
const pdZ = -0.6, pdX = 0.9, pdY = 2.65;

// The right front leg's joints; the others are mirrors. The thigh angles out, up and forward from the hip to a knee
// that peaks over the deck, the shin drops to a broad foot planted out past the hull's corner like an anchor: from
// any side the mech reads as a body slung between four arched legs, not a table on posts.
const hip: V3 = [1.32, hipY, hipZ], knee: V3 = [1.9, 2.78, -1.5], ankle: V3 = [1.62, 0.42, -1.68];
const shinFlat = unit([ankle[0] - knee[0], ankle[1] - knee[1], 0]);
const shinOut: V3 = [-shinFlat[1], shinFlat[0], 0]; // outward, across the shin in the leg's plane
const shinAt = (t: number, out = 0): V3 => add(lerp(knee, ankle, t), scale(shinOut, out));
const thigh = frameOf(hip, knee); // thigh.up faces the sky and a little inward, thigh.side faces forward
const thighAt = (t: number, side = 0, up = 0): V3 => add(add(lerp(hip, knee, t), scale(thigh.side, side)), scale(thigh.up, up));

// The knee ram's mounts: its sleeve on the front of the thigh, its rod pinned to the shin beside the knee, so the
// game slides the rod as the knee bends (gate V9b, motion below).
const kneeRamA = thighAt(0.2, 0.31), kneeRamB = thighAt(1.0, 0.31);

type Lod = 0 | 1 | 2;

// Every part of the mech at one level of detail, by name.
function build(lod: Lod): Record<string, MeshData> {
  const near = lod === 0;
  // Armour blocks and slabs: chamfered up close, plain further out.
  const block = (c: V3, s: V3, k = 0.05) => (near ? chamferBox(c, s, k) : box(c, s));
  const slab = (o: [number, number][], axis: "x" | "y" | "z", from: number, to: number, k = 0.05) => (near ? chamferPrism(o, axis, from, to, k) : prism(o, axis, from, to));
  const beam = (a: V3, b: V3, w: number, h: number, k = 0.05) => along(block([0, 0, 0], [w, h, dist(a, b)], k), a, b);
  const sides = (n: number) => (lod === 0 ? n : lod === 1 ? Math.max(6, Math.round(n * 0.6)) : Math.max(4, Math.round(n * 0.4)));
  const drum = (c: V3, r: number, length: number, axis: "x" | "y" | "z", n = 8, end = r) => cylinder(c, r, length, axis, sides(n), end);
  const rod = (a: V3, b: V3, r: number, n = 6) => along(cylinder([0, 0, 0], r, dist(a, b), "z", sides(n)), a, b);
  // Round forms near get many more sides (and a cut rim when `k` is given) than the `n` the simpler levels keep, so
  // the near level grows without the middle and far levels growing with it (gate V10).
  const tube = (c: V3, r: number, length: number, axis: "x" | "y" | "z", nearSides: number, n = 8, k = 0, end = r) =>
    (!near ? drum(c, r, length, axis, n, end) : k > 0 ? roundDrum(c, r, length, axis, nearSides, k, end) : cylinder(c, r, length, axis, nearSides, end));
  const tubeAlong = (a: V3, b: V3, r: number, nearSides: number, n = 6, k = 0) => along(tube([0, 0, 0], r, dist(a, b), "z", nearSides, n, k), a, b);
  // A hydraulic ram: a fat cylinder for the first part of its length, a thinner polished rod for the rest.
  // Up close the cylinder ends in a gland collar, where the rod's seal sits, and the rod runs on deep inside, out of
  // sight, so it never pulls out as the knee bends (gate V9b: the game slides the knee rams' rods).
  const ram = (a: V3, b: V3, r: number, n: number) => (!near ? rod(a, b, r * 0.8) : merge(
    tubeAlong(a, lerp(a, b, 0.56), r, n),
    tubeAlong(lerp(a, b, 0.2), b, r * 0.6, n - 2),
    tubeAlong(lerp(a, b, 0.53), lerp(a, b, 0.6), r * 1.3, n),
  ));
  const nearOnly = (...m: MeshData[]) => (near ? merge(...m) : empty());
  const notFar = (...m: MeshData[]) => (lod < 2 ? merge(...m) : empty());
  // A plate laid on one edge of the hull profile, between t0 and t1 of the way along it, standing `lift` off it.
  const hullPlate = (a: [number, number], b: [number, number], x: number, width: number, thick: number, t0 = 0, t1 = 1, k = 0.03, lift = 0) => {
    const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
    const dy = p1[0]! - p0[0]!, dz = p1[1]! - p0[1]!, length = Math.hypot(dy, dz);
    const my = (p0[0]! + p1[0]!) / 2, mz = (p0[1]! + p1[1]!) / 2;
    let ny = -dz / length, nz = dy / length;
    if (ny * (my - 1.95) + nz * mz < 0) { ny = -ny; nz = -nz; } // away from the middle of the hull
    const off = thick / 2 + lift;
    return turn(block([0, 0, 0], [width, thick, length], k), [Math.atan2(-dy, dz), 0, 0], [0, 0, 0], [x, my + ny * off, mz + nz * off]);
  };
  // A flat irregular patch lying on a level surface at height y: paint you can see from the air, as a thin plate.
  const deckPatch = (y: number, points: [number, number][], thick = 0.03) => prism(points.map(([x, z]) => [z, x] as [number, number]), "y", y, y + thick);

  // ---- Hull (torso zone). The camouflage is plates in two paints: tan plates on the tan hull (Torso), rust brown
  // ones beside them (Hull_Camo), laid over the hull with a seam between each, so the pattern breaks up the mass.
  // Spare shells for the mortar, in two crates strapped into a rack on each side of the rear deck, clear of the
  // traverse ring. The rack's end frames and top rail are dark steel; the crates take the camouflage paints.
  const crates = (s: number) => [0.56, 0.84].map((z) => block([s * 0.95, 2.585, z], [0.28, 0.2, 0.24], 0.025));
  const rack = (s: number) => merge(
    ...[0.4, 1.0].map((z) => box([s * 0.95, 2.58, z], [0.36, 0.2, 0.03])),
    box([s * 1.12, 2.66, 0.7], [0.03, 0.04, 0.63]),
    box([s * 0.95, 2.69, 0.7], [0.3, 0.012, 0.05]), // the strap over both crates
  );
  // The power plant breathes out of the housings on the hull back into a stack beside each, bent back at the top so
  // the hot air blows away from the gun. A clamp ties each stack to the hull.
  const tilt = 30 * deg;
  const stackTip = (s: number, m: MeshData) => turn(m, [tilt, 0, 0], [s * 0.84, 2.7, 1.44]);
  // Up close the bent tip is an open pipe, so the soot inside it shows.
  const stack = (s: number) => merge(
    tube([s * 0.84, 2.31, 1.44], 0.12, 0.78, "y", 10),
    stackTip(s, near ? hollowRing([s * 0.84, 2.77, 1.44], 0.09, 0.12, 0.14, "y", 10) : drum([s * 0.84, 2.77, 1.44], 0.12, 0.14, "y", 8)),
    nearOnly(
      tube([s * 0.76, 2.0, 1.38], 0.07, 0.2, "x", 8, 6), // the pipe from the housing
      tube([s * 0.84, 2.25, 1.44], 0.145, 0.06, "y", 12), box([s * 0.84, 2.25, 1.32], [0.08, 0.06, 0.1]), // clamp and its bracket
    ),
  );
  const torso = merge(
    slab(hullOutline, "x", -hullHalf, hullHalf, 0.08),
    // The flat plate on the hull front that carries the serial number (data/mechKits.json serials): nothing on it.
    notFar(block([0, 1.98, -1.345], [0.92, 0.42, 0.09], 0.03)),
    // Outer glacis plates, under the lasers, each with a heavy strip lapped over its top edge where the deck's front
    // corner takes the hits.
    bothSides(hullPlate(glacisTop, glacisFoot, 0.98, 0.3, 0.07, 0.06, 0.94, 0.03, glacisLift)),
    nearOnly(bothSides(hullPlate(glacisTop, glacisFoot, 0.98, 0.26, 0.06, 0.04, 0.3, 0.02, glacisLift + 0.07))),
    notFar(block([-0.95, 2.44, 0.03], [0.38, 0.08, 0.7], 0.03)), // deck plate, front left
    notFar(block([0.95, 2.44, 0.7], [0.38, 0.08, 0.56], 0.03)), // deck plate, rear right
    block([-1.2, 2.18, 0], [0.08, 0.36, 1.0], 0.03), // upper skirt, left
    block([1.23, 1.78, 0], [0.08, 0.38, 0.92], 0.03), // lower skirt, right
    // Exhaust housings on the hull back, for the power plant under the deck.
    notFar(...[-0.45, 0.45].map((x) => block([x, 2.06, 1.37], [0.4, 0.34, 0.14], 0.03))),
    notFar(...crates(-1)),
  );
  const hullCamo = merge(
    bothSides(hullPlate(glacisTop, glacisFoot, 0.62, 0.34, 0.07, 0.04, 0.96, 0.03, glacisLift)), // inner glacis plates beside the sensor
    nearOnly(bothSides(hullPlate(glacisTop, glacisFoot, 0.62, 0.3, 0.06, 0.02, 0.28, 0.02, glacisLift + 0.07))), // and their lapped strips
    bothSides(block([0.76, 1.97, -1.35], [0.54, 0.4, 0.1], 0.04)), // front plates either side of the serial plate
    notFar(block([0.95, 2.44, 0.03], [0.38, 0.08, 0.7], 0.03)), // deck plate, front right
    notFar(block([-0.95, 2.44, 0.7], [0.38, 0.08, 0.56], 0.03)), // deck plate, rear left
    block([1.2, 2.18, 0], [0.08, 0.36, 1.0], 0.03), // upper skirt, right
    block([-1.23, 1.78, 0], [0.08, 0.38, 0.92], 0.03), // lower skirt, left
    notFar(block([0, 2.12, 1.34], [0.4, 0.36, 0.08], 0.03)), // rear plate between the exhausts
    notFar(hullPlate([2.4, 1.05], [2.3, 1.3], 0, 1.4, 0.05, 0.1, 0.9, 0.03, 0.025)), // rear deck slope, on its own frame plate up close
    notFar(...crates(1)),
  );

  // Heat scoring round the weapon mounts: on the deck in front of the traverse ring where the muzzle blast lands,
  // round the point-defence bases, and on the glacis in front of the lasers. Ragged shapes, as heat leaves them.
  const scorchFront = deckPatch(2.4, [[-0.5, -0.38], [0.45, -0.4], [0.62, -0.52], [0.3, -0.66], [-0.4, -0.64], [-0.62, -0.5]]);
  const hullScorch = merge(
    scorchFront,
    notFar(bothSides(deckPatch(2.4, [[0.68, -0.4], [1.1, -0.42], [1.12, -0.68], [0.88, -0.7], [0.66, -0.56]]))), // round the laser pedestals
    notFar(bothSides(turn(prism([[-0.12, -0.2], [0.13, -0.18], [0.16, 0.12], [0.02, 0.22], [-0.14, 0.1]], "y", 0, 0.03), [glacisAngle, 0, 0], [0, 0, 0], onGlacis(0.97, -1.06, glacisLift + 0.07)))),
    nearOnly(...[-1, 1].map((s) => stackTip(s, tube([s * 0.84, 2.715, 1.44], 0.095, 0.02, "y", 12, 6)))), // soot down inside the stacks' mouths
  );

  // The hull's own joints, under the paint (frame): the belly the mech crawls on, the jump-jet nozzles under the
  // back (data/thrusterFx.json puts the flames there), a skid plate on the lower bow and a hip mount at each corner.
  // When a leg breaks its parts vanish, and what is left here is the broken look: a bolted mount, a sheared stub of
  // the hip shaft and a snapped plate, all hidden inside the leg's hip drum while the leg is on.
  const rightFrontHipMount = merge(
    block([1.18, hipY, hipZ], [0.12, 0.66, 0.6], 0.04),
    notFar(drum([1.28, hipY, hipZ], 0.13, 0.26, "x", 8)), // the shaft stub, ending inside the hip drum
    nearOnly(turn(box([0, 0, 0], [0.08, 0.3, 0.18]), [0.5, 0, 0.3], [0, 0, 0], [1.36, hipY, hipZ])), // a snapped plate
  );
  const frame = merge(
    block([0, 1.5, 0.05], [1.7, 0.12, 1.8], 0.04), // undercarriage
    rightFrontHipMount, mirrorX(rightFrontHipMount), mirrorZ(rightFrontHipMount), mirrorX(mirrorZ(rightFrontHipMount)),
    notFar(hullPlate([1.8, -1.3], [1.5, -0.95], 0, 1.5, 0.06, 0.08, 0.92)), // skid plate on the lower bow
    notFar(...[-0.7, 0.7].map((x) => tube([x, 1.64, 1.2], 0.15, 0.2, "y", 12, 8, 0, 0.1))), // jump-jet nozzles
    // Exhaust louvres: the hot air leaves through slats across each housing.
    nearOnly(...[-0.45, 0.45].flatMap((x) => [1.96, 2.06, 2.16].map((y) => box([x, y, 1.455], [0.32, 0.045, 0.04])))),
    notFar(stack(-1), stack(1)),
    nearOnly(rack(-1), rack(1)),
    // The upper skirts hang on a backing plate that shows a dark step round them: the armour is in layers.
    nearOnly(...[-1, 1].map((s) => chamferBox([s * 1.17, 2.18, 0], [0.04, 0.46, 1.14], 0.015))),
    // The same step under the lower skirts, the glacis plates and the rear deck slope: each plate is hung on a frame.
    nearOnly(...[-1, 1].map((s) => chamferBox([s * 1.175, 1.78, 0], [0.04, 0.48, 1.06], 0.015))),
    nearOnly(...[0.98, 0.62].map((x) => bothSides(hullPlate(glacisTop, glacisFoot, x, x > 0.9 ? 0.34 : 0.37, glacisLift + 0.01, 0.01, 0.99, 0.01)))),
    nearOnly(hullPlate([2.4, 1.05], [2.3, 1.3], 0, 1.48, 0.03, 0.05, 0.95, 0.01)),
  );

  // ---- Sensor turret (torso zone): a low armoured box set into the glacis, under a sloped hood that overhangs the
  // lenses. Cheek plates either side and a lip below box the lens slot in, so the lenses sit back in a recess where
  // counter fire glances off the armour round them.
  const sensor = merge(
    block([0, 2.42, -0.9], [0.72, 0.3, 0.56], 0.05),
    slab([[2.5, -1.27], [2.5, -0.62], [2.7, -0.6], [2.72, -0.92]], "x", -0.42, 0.42, 0.04),
    notFar(bothSides(block([0.37, 2.42, -1.09], [0.08, 0.24, 0.42], 0.02))),
    nearOnly(chamferBox([0, 2.285, -1.24], [0.66, 0.05, 0.12], 0.015)), // the lip under the slot
  );
  // The array in the slot, facing forward: a big ranging lens in a steel bezel, a pair of small lenses stacked on
  // each side of it and a wide-angle lens at each end. The slot's back wall is dark steel (Frame).
  const lens = (c: V3, r: number, n: number) => (near ? cylinder(c, r, 0.06, "z", n) : box(c, [r * 1.8, r * 1.8, 0.06]));
  const sensorLenses = lod === 2
    ? box([0, 2.41, -1.2], [0.6, 0.12, 0.08])
    : merge(
      lens([0, 2.4, -1.215], 0.085, 16),
      ...[-1, 1].flatMap((s) => [lens([s * 0.15, 2.445, -1.21], 0.045, 8), lens([s * 0.15, 2.355, -1.21], 0.045, 8), lens([s * 0.265, 2.4, -1.21], 0.05, 10)]),
    );
  const sensorSlot = nearOnly(box([0, 2.4, -1.19], [0.62, 0.2, 0.02]), cylinder([0, 2.4, -1.2], 0.11, 0.03, "z", 16));

  // ---- Rail mortar (arms zone). The traverse ring sits in the middle of the deck; the turret block on it carries
  // cheek plates that hold the trunnion, and the twin barrels hinge there and rise toward -Z. The rust brown bustle
  // behind is the shell magazine, which also balances the long barrels.
  // Up close the ring is a race with a ring gear round its top, just under the turret where it shows past the turret's
  // sides, and a traverse motor on the deck behind it whose pinion drives the gear to swing the turret.
  const motorAt: V3 = [0.87 * Math.sin(40 * deg), 2.5, ringZ + 0.87 * Math.cos(40 * deg)];
  const turretRing = near
    ? merge(
      roundDrum([0, 2.51, ringZ], 0.7, 0.22, "y", 20, 0.02),
      gearTeeth([0, 0, ringZ], 0.7, 0.8, 2.54, 2.61, 20),
      cylinder(motorAt, 0.09, 0.2, "y", 12), // the traverse motor
    )
    : drum([0, 2.51, ringZ], 0.72, 0.22, "y", 16);
  const turretBand = tube([0, 2.47, ringZ], 0.76, 0.1, "y", 24, 16); // the pilot's marking, a band round the ring under the gear
  // The turret breathes the gun's heat out through louvres low on each side, under the cheeks: tan slats over a
  // soot-black opening, so the scorch round the mount has a source.
  const ventSlats = nearOnly(...[-1, 1].flatMap((s) => [0.31, 0.43, 0.55, 0.67, 0.79].map((z) => box([s * 0.66, 2.76, z], [0.05, 0.15, 0.035]))));
  const turret = merge(
    slab([[2.62, -0.3], [2.62, 1.05], [2.85, 1.05], [2.95, 0.9], [2.95, 0.05], [2.8, -0.3]], "x", -0.64, 0.64, 0.05),
    ventSlats,
  );
  const cheek: [number, number][] = [[2.85, 0.12], [2.85, 0.98], [3.14, 0.86], [3.2, 0.5], [3.12, 0.22]];
  const turretCamo = merge(
    bothSides(slab(cheek, "x", 0.48, 0.66, 0.03)),
    block([0, 2.77, 1.16], [0.96, 0.27, 0.3], 0.05), // the magazine bustle
  );
  const turretFrontAngle = -Math.atan2(0.15, 0.35);
  // Soot on the turret front under the barrels, on the lip below it and in the vents.
  const turretScorch = merge(
    turn(box([0, 0, 0], [0.9, 0.06, 0.3]), [turretFrontAngle, 0, 0], [0, 0, 0], [0, 2.875 + 0.03 * Math.cos(turretFrontAngle), -0.125 + 0.03 * Math.sin(turretFrontAngle)]),
    notFar(box([0, 2.71, -0.33], [1.0, 0.14, 0.08])),
    nearOnly(...[-1, 1].map((s) => box([s * 0.645, 2.76, 0.55], [0.02, 0.16, 0.6]))),
  );
  // A sooty band behind each muzzle brake and the black bore down inside each muzzle: a part of their own, so they kick
  // back with the barrels when the mortar fires (data/recoil.json).
  const muzzleSoot = merge(
    notFar(raise(merge(...[-barrelX, barrelX].map((x) => tube(at(x, 0, -2.75), 0.14, 0.2, "z", 12, 10))))),
    nearOnly(raise(merge(...[-barrelX, barrelX].map((x) => cylinder(at(x, 0, -3.205), 0.072, 0.02, "z", 10))))),
  );

  // Each barrel steps down from the breech to the muzzle: a fat jacket the barrel slides back in, then two recoil
  // sleeves, each narrower than the one behind, and the bare tube. A heavy collar clamps the front of each step, so
  // the barrel reads as heavy, banded steel at range, not a thin pipe, and the steps show which way it recoils.
  // Along the barrel from the trunnion: each collar (where, radius) and each sleeve (from, to, radius).
  const collars: [number, number][] = [[-1.05, 0.2], [-1.62, 0.185], [-2.15, 0.165]];
  const sleeves: [number, number, number][] = [[-1.05, -1.6, 0.165], [-1.62, -2.15, 0.145]];
  const oneBarrel = (x: number) => merge(
    block(at(x, 0, 0.18), [0.4, 0.4, 0.74], 0.06), // breech
    notFar(tube(at(x, 0, -0.2), 0.225, 0.08, "z", 16, 8)), // the breech ring the barrel screws into
    tube(at(x, 0, -0.6), 0.185, 0.8, "z", 16, 8, 0.03), // jacket: the recoil housing the barrel slides back in
    notFar(...collars.map(([dz, r]) => tube(at(x, 0, dz), r, 0.12, "z", 14, 8, 0.015))), // the steps' collars
    nearOnly(box(at(x, -0.19, -1.62), [0.08, 0.12, 0.1])), // bracket from a collar to the recoil rod
  );
  const barrels = raise(merge(oneBarrel(-barrelX), oneBarrel(barrelX), notFar(block(at(0, 0, -1.62), [0.42, 0.15, 0.16], 0.03))));
  // The muzzle brakes are their own part, painted the colour of the weapon in hand: the mortar is the gun, and shots
  // leave the two muzzles in turn (Mount_Gun and Mount_Gun_2), from the front of the brakes.
  // Near, each brake is a core tube between a top and a bottom plate with two round baffles across, so the side ports
  // show as gaps the blast leaves through, and a thick front ring round the open bore, the heaviest piece, as it takes
  // the most gas.
  const oneBrake = (x: number) => (near
    ? merge(
      cylinder(at(x, 0, -3.03), 0.13, 0.36, "z", 16),
      ...[-1, 1].map((s) => chamferBox(at(x, s * 0.17, -3.035), [0.38, 0.06, 0.4], 0.015)),
      cylinder(at(x, 0, -2.87), 0.175, 0.05, "z", 12), cylinder(at(x, 0, -3.03), 0.175, 0.05, "z", 12),
      hollowRing(at(x, 0, -barrelLength + 0.035), 0.075, 0.185, 0.07, "z", 16),
    )
    : lod === 1
    ? merge(box(at(x, 0, -3.03), [0.26, 0.26, 0.36]), ...[-1, 1].map((s) => box(at(x, s * 0.17, -3.035), [0.38, 0.06, 0.4])), cylinder(at(x, 0, -barrelLength + 0.035), 0.185, 0.07, "z", 8))
    : box(at(x, 0, -3.06), [0.38, 0.38, 0.32]));
  const muzzleBrakes = raise(merge(oneBrake(-barrelX), oneBrake(barrelX)));
  // The dark steel inside the steps: the barrel tube, the two recoil sleeves and the recoil cylinder under each.
  // On top of each jacket the recuperator, which pushes the barrel back out after recoil, and its rod on the breech;
  // along the tube a fat bore evacuator that draws the fumes out of the barrel.
  const oneSleeve = (x: number) => merge(
    tube(at(x, 0, -1.905), 0.125, 1.9, "z", 16, 10),
    notFar(...sleeves.map(([from, to, r]) => tube(at(x, 0, (from + to) / 2), r, from - to, "z", 16, 10))),
    notFar(tube(at(x, -0.21, -0.95), 0.065, 1.1, "z", 10, 6)),
    nearOnly(
      tube(at(x, -0.21, -1.72), 0.035, 0.44, "z", 8), // the recoil rod
      tube(at(x, 0.23, -0.585), 0.07, 0.73, "z", 12), tube(at(x, 0.23, -0.96), 0.085, 0.05, "z", 12), // recuperator and its end cap
      tube(at(x, 0.245, 0.12), 0.04, 0.5, "z", 8),
      tube(at(x, 0, -2.4), 0.15, 0.26, "z", 16, 10, 0.03), // bore evacuator
    ),
  );
  const barrelSleeves = merge(
    raise(merge(oneSleeve(-barrelX), oneSleeve(barrelX))),
    tube(pivot, 0.14, 1.44, "x", 16, 8), // trunnion
    nearOnly(...[-1, 1].map((s) => tube([s * 0.69, pivot[1], pivot[2]], 0.17, 0.06, "x", 12, 8))), // its hubs
  );

  // ---- Point-defence turrets on the front corners (arms zone), each with a small glowing emitter and cooling fins
  // on top to shed the laser's heat. The right one also carries a sponson with a small side gun, for looks: the
  // mortar is what fires.
  // Up close the barrel rides in a round mantlet across the turret's front, where it tips up and down, inside a
  // cooling shroud with two fin rings, and ends in a collar the glowing emitter is mounted on, clear of it so the
  // emitter still reads as a red light from every side.
  const pdTurret = (x: number) => merge(
    notFar(tube([x, 2.47, pdZ], 0.17, 0.14, "y", 12, 8)), // pedestal
    block([x, pdY, pdZ], [0.36, 0.26, 0.4], 0.05),
    near
      ? merge(
        cylinder([x, pdY, -0.82], 0.11, 0.3, "x", 12), // mantlet
        cylinder([x, pdY, -0.98], 0.065, 0.16, "z", 12), // cooling shroud
        ...[-0.95, -1.01].map((z) => cylinder([x, pdY, z], 0.085, 0.025, "z", 8)), // its fin rings
        cylinder([x, pdY, -0.99], 0.045, 0.22, "z", 8), // barrel
        cylinder([x, pdY, -1.09], 0.085, 0.03, "z", 12), // the emitter's collar
      )
      : merge(
        notFar(slab([[pdY - 0.1, -0.8], [pdY + 0.12, -0.8], [pdY + 0.1, -0.88], [pdY - 0.06, -0.93]], "x", x - 0.15, x + 0.15, 0.02)), // sloped front
        drum([x, pdY, -1.0], 0.055, 0.22, "z", 8), // emitter barrel
      ),
    nearOnly(...[-0.1, 0, 0.1].map((dz) => box([x, pdY + 0.15, pdZ + dz], [0.28, 0.05, 0.04]))), // cooling fins
  );
  const armR = merge(pdTurret(pdX), block([1.2, 2.4, -0.95], [0.26, 0.3, 0.5], 0.05));
  const armL = pdTurret(-pdX);
  const pdEmitters = merge(...[-1, 1].map((s) => tube([s * pdX, pdY, -1.14], 0.065, 0.08, "z", 12)));
  const sideGun = merge(
    block([1.2, 2.4, -1.28], [0.18, 0.18, 0.18], 0.03),
    near ? merge(cylinder([1.2, 2.4, -1.46], 0.06, 0.26, "z", 10), hollowRing([1.2, 2.4, -1.61], 0.04, 0.075, 0.08, "z", 10)) : drum([1.2, 2.4, -1.5], 0.07, 0.3, "z", 8), // barrel and muzzle
  );

  // ---- Legs (legs zone). Built for the right front leg, mirrored for the others. Each leg has three parts: armour
  // (thigh, knee guard and foot), shin armour, and the hydraulics (drums, rams, the shin's core). The game cuts each
  // part at the joints by which bone a shape sits nearest (packages/client/src/legRig.ts), so every shape here sits
  // clearly on one bone: the knee guard's middle is on the thigh side of the knee, the rams lie along one bone each.
  const kneeGuardLength = 0.66;
  // The foot: a broad hub under the ankle with three toes fanned toward the leg's own corner and a heel toward the
  // hull, so each foot braces outward like an outrigger. A toe is built pointing along -z from the hub's middle and
  // turned about y into place; `yaw` -45 degrees points it straight out of the corner.
  const footAt: V3 = [ankle[0], 0, ankle[2]];
  const toeOutline = (length: number): [number, number][] => [[0, -0.1], [0, -length + 0.07], [0.08, -length], [0.17, -length + 0.09], [0.23, -0.1]];
  const toYaw = (m: MeshData, yaw: number) => turn(m, [0, yaw * deg, 0], [0, 0, 0], footAt);
  const toe = (yaw: number, length: number) => toYaw(slab(toeOutline(length), "x", -0.11, 0.11, 0.025), yaw);
  const toeLength = 0.52;
  const clawToeLength = 0.6; // the front feet's toes, longer, as they carry the claws
  const claw = (yaw: number, half: number) => toYaw(prism([[0.15, -clawToeLength + 0.06], [0.03, -clawToeLength + 0.06], [0, -clawToeLength - 0.1]], "x", -half, half), yaw);
  const toeYaws = [-85, -45, -5];
  const polygon = (c: [number, number], r: number, n: number) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((i + 0.5) * Math.PI * 2 / n), c[1] + r * Math.sin((i + 0.5) * Math.PI * 2 / n)] as [number, number]);
  const hub = (r: number) => slab(polygon([ankle[2], ankle[0]], r, near ? 12 : 8), "y", 0, 0.26, 0.03);
  // The front feet are claws, which dig in while the mortar fires: a smaller hub and three longer toes, each in two
  // jointed segments on a knuckle pin, ending in a hooked talon, spread so they read as separate toes. Up close the
  // segments are armour (tan), the knuckles and talons dark steel; further out each toe is one slab and a talon, to
  // the same outline.
  const frontToes = near
    ? toeYaws.map((yaw) => ({
      armour: toYaw(merge(
        slab([[0, -0.14], [0, -0.44], [0.15, -0.44], [0.21, -0.14]], "x", -0.085, 0.085, 0.02), // first segment
        slab([[0, -0.48], [0, -0.57], [0.05, -0.6], [0.13, -0.58], [0.14, -0.48]], "x", -0.075, 0.075, 0.02), // second
      ), yaw),
      steel: toYaw(merge(
        cylinder([0, 0.085, -0.46], 0.065, 0.2, "x", 8), // knuckle pin
        prism([[0.12, -0.55], [0.02, -0.58], [0, -clawToeLength - 0.1]], "x", -0.05, 0.05), // talon
      ), yaw),
    }))
    : toeYaws.map((yaw) => ({ armour: toe(yaw, clawToeLength), steel: lod === 1 ? claw(yaw, 0.06) : empty() }));
  // The knee guard: a heavy cap over the knee, peaking well over the deck, the leg's high point at range and the
  // first thing to read as "four legs". Oversized on purpose.
  const kneeGuard = (k: number) => along(block([0, 0.06, 0], [0.72, 0.64, kneeGuardLength], k), thighAt(0.86 - kneeGuardLength / 2 / dist(hip, knee)), thighAt(0.86 + kneeGuardLength / 2 / dist(hip, knee)));
  const legArmour = (front: boolean) => lod === 2
    ? merge(beam(hip, thighAt(0.8), 0.56, 0.5), kneeGuard(0), box([ankle[0], 0.13, ankle[2]], [0.86, 0.26, 0.86]))
    : merge(
      beam(hip, knee, 0.56, 0.5, 0.07),
      kneeGuard(0.09),
      hub(front ? 0.3 : 0.36), // the foot's hub
      block([ankle[0], 0.4, ankle[2]], [0.5, 0.32, 0.58], 0.05), // ankle cowl
      ...(front ? frontToes.map((t) => t.armour) : toeYaws.map((yaw) => toe(yaw, toeLength))),
      toe(135, 0.46), // heel
    );
  // The shin flares to a heavy greave over the ankle, so the leg stands on a boot, not a post.
  const shinArmour = lod === 2
    ? beam(shinAt(0.1, 0.03), shinAt(0.86, 0.03), 0.56, 0.48)
    : merge(
      beam(shinAt(0.1, 0.03), shinAt(0.5, 0.03), 0.56, 0.5, 0.07), // upper shin plate
      beam(shinAt(0.54, 0.03), shinAt(0.86, 0.03), 0.6, 0.54, 0.07), // greave, a seam below the upper plate
    );
  const ankleRamA = shinAt(0.14, 0.31), ankleRamB = shinAt(0.9, 0.31);
  // A hinge cheek: a flat plate across an axle running front to back, round about the axle and tapering toward the
  // bone it is fixed to (`toward`, in x and y), standing between z0 and z1.
  const hingePlate = (centre: V3, toward: V3, r: number, tail: number, half: number, z0: number, z1: number) => {
    const back = unit([toward[0] - centre[0], toward[1] - centre[1], 0]), across = [-back[1], back[0]] as const;
    const round = [-90, -45, 0, 45, 90].map((a) => [centre[0] + r * (-Math.cos(a * deg) * back[0] + Math.sin(a * deg) * across[0]), centre[1] + r * (-Math.cos(a * deg) * back[1] + Math.sin(a * deg) * across[1])] as [number, number]);
    const end = (s: number) => [centre[0] + tail * back[0] + s * half * across[0], centre[1] + tail * back[1] + s * half * across[1]] as [number, number];
    return prism([...round, end(1), end(-1)], "z", z0, z1);
  };
  // The knee is a real hinge, its axle pin through the knee drum and a cheek plate either side: the inner cheek
  // belongs to the thigh and the outer to the shin, so the game, which hands each shape to its nearest bone, turns
  // them against each other as the knee bends. The shin ends in a fork round the ankle pin.
  const anklePin: V3 = [ankle[0], 0.55, ankle[2]];
  const inward = Math.sign(hip[2] - knee[2]); // toward the hull, along the axle
  const hydraulics = merge(
    tube(hip, 0.28, 0.3, "x", 14, 10, 0.03), // hip drum
    lod === 2 ? empty() : tube(knee, 0.25, 0.6, "z", 14, 10, 0.03), // knee drum
    notFar(hingePlate(knee, hip, 0.2, 0.36, 0.15, knee[2] + inward * 0.31, knee[2] + inward * 0.37)),
    notFar(hingePlate(knee, ankle, 0.2, 0.36, 0.15, knee[2] - inward * 0.31, knee[2] - inward * 0.37)),
    nearOnly(tube(knee, 0.12, 0.84, "z", 12)), // the knee's axle pin
    beam(knee, ankle, 0.28, 0.28, 0.04), // shin core
    notFar(tube(anklePin, 0.17, 0.46, "z", 12, 8)), // ankle
    nearOnly(...[-1, 1].map((s) => hingePlate(anklePin, knee, 0.15, 0.26, 0.13, ankle[2] + s * 0.24, ankle[2] + s * 0.3))),
    // The knee ram, along the front of the thigh, bends the knee; the ankle ram, down the outside of the shin, works
    // the foot so the claws dig in. Each has a lug at both ends where it is pinned.
    notFar(ram(kneeRamA, kneeRamB, 0.085, 10), ram(ankleRamA, ankleRamB, 0.08, 8)),
    nearOnly(...[kneeRamA, kneeRamB].map((p) => along(box([0, 0, 0], [0.12, 0.2, 0.12]), sub(p, scale(thigh.d, 0.06)), add(p, scale(thigh.d, 0.06)))),
      ...[ankleRamA, ankleRamB].map((p) => along(box([0, 0, 0], [0.12, 0.12, 0.12]), sub(p, scale(shinOut, 0.12)), add(p, scale(shinOut, 0.02))))),
  );
  const claws = lod === 2 ? claw(-45, 0.3) : merge(...frontToes.map((t) => t.steel));
  // A hydraulic hose down the back of each bone, feeding the rams: it sags off the thigh and runs down the shin,
  // so the leg shows the machine in it at mid range. Straight runs, each on one bone, as the game cuts at the joints.
  const hose = (points: V3[]) => merge(...points.slice(1).map((b, i) => {
    const a = points[i]!, d = scale(unit(sub(b, a)), 0.05);
    return tubeAlong(sub(a, d), add(b, d), 0.065, 8, 6);
  }));
  const hoses = lod === 2 ? empty() : merge(
    hose([thighAt(0.06, -0.33, -0.02), thighAt(0.5, -0.38, -0.16), thighAt(0.94, -0.33, -0.04)]),
    hose([add(shinAt(0.06), [0, 0, 0.36]), add(shinAt(0.45), [0, 0, 0.38]), add(shinAt(0.8), [0, 0, 0.36])]),
  );

  const legFR = { armour: legArmour(true), shin: shinArmour, hydraulics: merge(hydraulics, claws) };
  const legFL = { armour: mirrorX(legFR.armour), shin: mirrorX(shinArmour), hydraulics: mirrorX(legFR.hydraulics) };
  const legBR = { armour: mirrorZ(legArmour(false)), shin: mirrorZ(shinArmour), hydraulics: mirrorZ(hydraulics) };
  const legBL = { armour: mirrorX(legBR.armour), shin: mirrorX(legBR.shin), hydraulics: mirrorX(legBR.hydraulics) };
  const legHoses = merge(hoses, mirrorX(hoses), mirrorZ(hoses), mirrorX(mirrorZ(hoses)));
  const leg = (name: string, l: typeof legFR) => ({ [name]: l.armour, [`${name}_Shin`]: l.shin, [`${name}_Hydraulics`]: l.hydraulics });

  return {
    Torso: torso, Hull_Camo: hullCamo, Hull_Scorch: hullScorch, Frame: merge(frame, sensorSlot), Sensor: sensor, Sensor_Lenses: sensorLenses,
    Turret_Ring: turretRing, Turret_Band: turretBand, Turret: turret, Turret_Camo: turretCamo, Turret_Scorch: turretScorch, Muzzle_Soot: muzzleSoot,
    Barrels: barrels, Muzzle_Brakes: muzzleBrakes, Barrel_Sleeves: barrelSleeves,
    Arm_L: armL, Arm_R: armR, PD_Emitters: pdEmitters, Side_Gun: sideGun,
    ...leg("Leg_FL", legFL), ...leg("Leg_FR", legFR), ...leg("Leg_BL", legBL), ...leg("Leg_BR", legBR), Leg_Hoses: legHoses,
  };
}

// Each part's hit zone, paint (a name from the scheme, or accent / weapon, see packages/client/src/mechKit.ts), finish
// and flags. Frames and joints keep their dark paint (rusts: false); glows are flat lit colour. Finish is how the paint
// takes the light: painted armour (the default), bare metal with one hard highlight, or dull rubber.
// The scheme is three values a step apart, each clear of the world's band (moss and rust sit between 32 and 53 in
// lightness): tan, the main armour, is light (76); the camouflage brown is mid (41), an umber cooler and greyer than
// deep rust, so a fresh Cataclysm never reads as already rusted; the frame is near black (14).
const scheme = { tan: "#D8B87E", rustBrown: "#7D5A3C", scorch: "#2E2A26", frame: "#26231F", lensGlow: "#FF6A3D", laserGlow: "#FF3B30" };
type Look = { zone: "legs" | "arms" | "torso"; paint: string; finish?: "metal" | "rubber"; glow?: true; rusts?: false; noHit?: true };
const steel = { finish: "metal", rusts: false } as const;
const legLook = (shin: string): Look[] => [{ zone: "legs", paint: "tan" }, { zone: "legs", paint: shin }, { zone: "legs", paint: "frame", ...steel }];
const looks: Record<string, Look> = {
  Torso: { zone: "torso", paint: "tan" },
  Hull_Camo: { zone: "torso", paint: "rustBrown" },
  Hull_Scorch: { zone: "torso", paint: "scorch" },
  Frame: { zone: "torso", paint: "frame", ...steel },
  Sensor: { zone: "torso", paint: "rustBrown" },
  Sensor_Lenses: { zone: "torso", paint: "lensGlow", glow: true },
  Turret_Ring: { zone: "arms", paint: "frame", ...steel },
  Turret_Band: { zone: "arms", paint: "accent" },
  Turret: { zone: "arms", paint: "tan" },
  Turret_Camo: { zone: "arms", paint: "rustBrown" },
  Turret_Scorch: { zone: "arms", paint: "scorch" },
  Muzzle_Soot: { zone: "arms", paint: "scorch", noHit: true }, // inside the barrels' own boxes
  // Mid brown barrels stand out against the pale sky they are mostly seen against, and against the ground from above.
  Barrels: { zone: "arms", paint: "rustBrown" },
  Muzzle_Brakes: { zone: "arms", paint: "weapon", finish: "metal" },
  Barrel_Sleeves: { zone: "arms", paint: "frame", ...steel },
  Arm_L: { zone: "arms", paint: "tan" },
  Arm_R: { zone: "arms", paint: "tan" },
  PD_Emitters: { zone: "arms", paint: "laserGlow", glow: true },
  Side_Gun: { zone: "arms", paint: "frame", ...steel },
};
// Every thigh, knee cap and foot is tan, so the four knee peaks read light at range; the shins take the camouflage
// brown on one diagonal, so the four legs still read apart and the pattern carries down them.
for (const [name, shin] of [["Leg_FL", "rustBrown"], ["Leg_FR", "tan"], ["Leg_BL", "tan"], ["Leg_BR", "rustBrown"]] as const) {
  const [a, s, h] = legLook(shin);
  looks[name] = a!; looks[`${name}_Shin`] = s!; looks[`${name}_Hydraulics`] = h!;
}
looks.Leg_Hoses = { zone: "legs", paint: "frame", finish: "rubber", rusts: false };

const levels = ([0, 1, 2] as const).map(build);
const nodes: NodeData[] = [
  ...Object.keys(looks).flatMap((name) => levels.map((parts, level) => ({ name: level === 0 ? name : `${name}_LOD${level}`, mesh: parts[name]! }))),
  { name: "Mount_Gun", translation: muzzleAt(barrelX) },
  { name: "Mount_Gun_2", translation: muzzleAt(-barrelX) },
  { name: "Torso_Fx", translation: [0, 2.5, 1.15] },
  { name: "Arm_R_Fx", translation: [0.4, 3.0, 0.3] },
  { name: "Leg_FL_Fx", translation: [-knee[0], knee[1], knee[2]] },
  ...legJoints("FR", hip, knee, ankle),
  ...legJoints("FL", mirrorPointX(hip), mirrorPointX(knee), mirrorPointX(ankle)),
  ...legJoints("BR", mirrorPointZ(hip), mirrorPointZ(knee), mirrorPointZ(ankle)),
  ...legJoints("BL", mirrorPointX(mirrorPointZ(hip)), mirrorPointX(mirrorPointZ(knee)), mirrorPointX(mirrorPointZ(ankle))),
];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, writeGlb(nodes, { quantize: true }));
// The knee rams slide (gate V9b). The ankle rams lie along the shin and stay as they are: four more moving rams would
// cost eight more draw calls up close for a part that hardly shows under the greave. The gland collar sits just past
// halfway (0.565 of the way), so `split` keeps it with the sleeve; the rod's middle is at 0.6.
const kneeRamFR = piston("Knee_Ram_FR", ["Leg_FR_Hydraulics"], ["thigh_FR", kneeRamA], ["shin_FR", kneeRamB], 0.15, 0.58);
const motion = [
  kneeRamFR,
  mirrored(kneeRamFR, mirrorPointX, { FR: "FL" }),
  mirrored(kneeRamFR, mirrorPointZ, { FR: "BR" }),
  mirrored(kneeRamFR, (p) => mirrorPointX(mirrorPointZ(p)), { FR: "BL" }),
];
writeFileSync(join(root, "scripts/mechs/cataclysm.kit.json"), `${JSON.stringify({ scheme, parts: looks, motion }, null, 2)}\n`);
const count = (parts: Record<string, MeshData>) => Object.values(parts).reduce((s, m) => s + triangles(m), 0);
console.log(`Wrote ${out} (${levels.map((parts, i) => `LOD${i} ${count(parts)}`).join(", ")} triangles)`);
