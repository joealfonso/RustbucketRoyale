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
// Levels of detail: the same build runs three times. The nearest keeps the bevels, bolts, hoses and rivets; the middle
// (past 25 m, data/mechKits.json lodDistances) drops those and turns the gun's six barrels into one drum; the far one
// (past 80 m) keeps only plain blocks for the masses that make the silhouette.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { bothLegs } from "./joints";
import { box, convex, cylinder, empty, merge, mirrorX, prism, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

type UV = [number, number];
type Axis = "x" | "y" | "z";
type Level = 0 | 1 | 2;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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
  return out;
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

// A hex bolt head standing out of a face at `at`, `out` being the face's outward direction.
const bolt = (at: V3, out: V3, r = 0.035) => rod(along(at, out, -0.01), along(at, out, 0.045), r, 6);

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
// The server fires from (1.2, 2.4, -1.4), so the muzzle sits just ahead of it.
const GUN: V3 = [1.2, 2.4, -1.65];
// The hip, a knee that sits back, and an ankle forward of it, so the knee bends backward a little. Right side.
const LX = 0.57;
const HIP: V3 = [LX, 1.46, 0], KNEE: V3 = [LX, 0.9, 0.2], ANKLE: V3 = [LX, 0.34, -0.06];
const SHIN_W = 0.5, SHIN_D = 0.44;
const thighLength = length(HIP, KNEE), shinLength = length(KNEE, ANKLE);
const SHIELD_EDGE_X = -1.4;
const PILE: [number, number] = [SHIELD_EDGE_X, 2.5];
const FRONT: V3 = [0, 0, -1], BACK: V3 = [0, 0, 1], UP: V3 = [0, 1, 0], OUT: V3 = [1, 0, 0];

function build(lv: Level): Record<string, MeshData> {
  const near = lv === 0, far = lv === 2;
  const only = (make: () => MeshData) => (near ? make() : empty()); // small detail, nearest level only
  const notFar = (make: () => MeshData) => (far ? empty() : make());
  const bev = (b: number) => (near ? b : 0); // bevels and chamfers are a pixel or two past 25 m
  const sides = (n: number) => [n, Math.min(n, 6), 4][lv]!;

  // ---- Torso: a core hull wrapped in plates, each its own block so the seams between them show. Two big upper
  // armour blocks at the corners hold the missile pods; the head sits between them, behind a chin guard and under a
  // brow hood, so only a slit shows.
  const torso = merge(
    slab([-0.8, 1.7, -0.5], [0.8, 2.86, 0.5], bev(0.08)), // core hull
    // Belly in two bands, the lower one cut back underneath so it sheds shots from below.
    block(cut(1.72, 1.96, -0.6, -0.42, [0.08, 0, 0, 0]), "x", -0.64, 0.64, bev(0.03)),
    block(cut(1.99, 2.24, -0.6, -0.42, [0.03, 0, 0, 0]), "x", -0.7, 0.7, bev(0.03)),
    // Chest: two plates meeting in a seam down the middle, their outer corners cut. The left plate's face carries the
    // serial number, so nothing stands on it.
    pair(block(cut(0.02, 0.9, 2.2, 2.74, [0, 0.16, 0.06, 0]), "z", -0.64, -0.4, bev(0.03))),
    block(cut(2.7, 2.96, -0.7, -0.4, [0, 0.1, 0, 0]), "x", -0.36, 0.36, bev(0.03)), // chin guard, sloped on top
    block(cut(3.1, 3.26, -0.66, 0.04, [0.06, 0.04, 0, 0]), "x", -0.38, 0.38, bev(0.02)), // brow hood
    // Flank plates, in two pieces near, one far.
    far
      ? pair(slab([0.79, 1.86, -0.46], [0.93, 2.6, 0.42]))
      : pair(merge(block(cut(1.86, 2.2, -0.46, 0.42, 0.04), "x", 0.79, 0.93, bev(0.02)), block(cut(2.24, 2.6, -0.46, 0.42, 0.04), "x", 0.79, 0.93, bev(0.02)))),
    pair(slab([0.33, 2.55, -0.63], [0.95, 3.1, 0.52], bev(0.08))), // upper armour blocks
    pair(slab([0.36, 3.0, 0.08], [0.94, 3.3, 0.5], bev(0.06))), // rear cowl behind each pod
    pair(slab([0.2, 1.95, 0.48], [0.6, 2.72, 0.8], bev(0.05))), // jump jet housings on the back
    notFar(() => block(cut(-0.17, 0.17, 2.0, 2.6, 0.04), "z", 0.46, 0.56, bev(0.02))), // reactor access hatch between the jets
    only(() => merge(
      ...[2.46, 2.64].map((y) => pair(bolt([0.86, y, -0.64], FRONT))), // chest plates to the flanks
      ...[0.22, 0.5].map((x) => pair(bolt([x, 2.12, -0.6], FRONT))), // upper belly band to the hull
      pair(bolt([0.26, 2.78, -0.7], FRONT)), // chin guard
      ...[2.08, 2.52].map((y) => pair(bolt([0.11, y, 0.56], BACK))), // hatch
    )),
  );

  // Head: small and dark, a full 0.2 m behind the armour fronts. The eye looks out through the slit from a socket.
  const head = merge(
    slab([-0.26, 2.8, -0.44], [0.26, 3.14, 0.12], bev(0.05)),
    only(() => cylinder([0, 3.02, -0.46], 0.11, 0.04, "z", 8)),
  );
  const sensor = cylinder([0, 3.02, -0.48], 0.07, 0.1, "z", sides(8));

  // Missile pods: one box per side, sunk into the top of its armour block and standing out of its front, with the
  // hinge of the hatch that closes over the launch cells.
  const pods = pair(merge(
    slab([0.4, 2.92, -0.7], [0.9, 3.38, 0.05], bev(0.05)),
    only(() => cylinder([0.65, 3.37, -0.64], 0.045, 0.44, "x", 8)),
  ));
  // The pilot's marking: one band round the right pod.
  const accentBand = slab([0.38, 2.96, -0.42], [0.92, 3.41, -0.3], bev(0.02));

  // Frame: waist, hip bar, the pods' launch cells and the jet nozzles, the dark mechanical bits of the torso.
  const podCells: MeshData[] = [];
  if (far) podCells.push(slab([0.455, 2.995, -0.74], [0.845, 3.305, -0.66]));
  else for (const x of [0.51, 0.65, 0.79]) for (const y of [3.06, 3.24]) podCells.push(slab([x - 0.055, y - 0.065, -0.74], [x + 0.055, y + 0.065, -0.66]));
  const frame = merge(
    slab([-0.45, 1.4, -0.3], [0.45, 1.8, 0.3], bev(0.04)), // waist
    notFar(() => cylinder([0, 1.74, 0], 0.5, 0.1, "y", sides(12))), // slewing ring the torso sits on
    cylinder([0, 1.48, 0], 0.17, 0.62, "x", sides(10)), // hip bar
    pair(merge(...podCells)),
    pair(cylinder([0.4, 1.86, 0.64], 0.13, 0.18, "y", sides(10), 0.17)), // jet nozzles, flared at the bottom
    only(() => pair(cylinder([0.4, 1.94, 0.64], 0.16, 0.05, "y", 10))), // nozzle collars, bolted under the housings
    // Louvres on top of each jet housing, where the jets draw their air.
    only(() => pair(merge(...[0.56, 0.64, 0.72].map((z) => slab([0.24, 2.72, z - 0.025], [0.56, 2.77, z + 0.025]))))),
  );

  // ---- Arms. Each has a big square pauldron, a shoulder wall on its outer face that stands up past its top (it
  // guards the pods and the head from the side, and squares off the shoulders' outline from far away), an upper arm,
  // a forearm, and joints in the frame.
  const pauldronR = slab([0.9, 2.62, -0.48], [1.62, 3.18, 0.42], bev(0.07));
  const wallR = block(cut(1.56, 1.7, 2.58, 3.5, [0, 0.03, 0.03, 0.09]), "z", -0.46, 0.4, bev(0.03));
  const upperArmR = slab([1.04, 2.3, -0.2], [1.38, 2.72, 0.2], bev(0.05));

  // Hazard stripes on each shoulder wall's outer face and the pauldron's top, the faces seen from the side and behind.
  const stripeWidth = [0.12, 0.16, 0.24][lv]!;
  const outerStripes = hazardPanel("x", 1.7, 1, [2.68, 3.4], [-0.38, 0.32], stripeWidth);
  const topStripes = hazardPanel("y", 3.18, 1, [-0.4, 0.34], [0.98, 1.5], stripeWidth);

  // Right arm: the forearm is one long housing that the autocannon comes out of, a top plate over the gun's motor,
  // and the ammo drum on the outside.
  const armR = merge(
    pauldronR,
    wallR,
    upperArmR,
    slab([0.96, 2.12, -1.0], [1.44, 2.62, -0.1], bev(0.06)), // forearm housing
    notFar(() => block(cut(0.98, 1.42, 2.6, 2.7, [0, 0, 0.04, 0.04]), "z", -0.96, -0.16, bev(0.02))), // top plate
    cylinder([1.55, 2.38, -0.5], 0.24, 0.24, "x", sides(10)), // ammo drum
    only(() => merge(
      cylinder([1.68, 2.38, -0.5], 0.16, 0.04, "x", 10), // drum lid
      ...[1.06, 1.34].flatMap((x) => [-0.86, -0.26].map((z) => bolt([x, 2.7, z], UP))), // top plate
    )),
  );

  // Rotary autocannon: a hub at the front of the forearm, six barrels round a spindle, a clamp ring and a muzzle ring.
  // The barrels end at the gun mount. Past 25 m the barrels are one drum: six bars that thin are lost there anyway.
  const breechZ = -1.0;
  const barrels: MeshData[] = [];
  if (near) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      barrels.push(cylinder([GUN[0] + Math.cos(a) * 0.13, GUN[1] + Math.sin(a) * 0.13, (GUN[2] + breechZ) / 2], 0.05, breechZ - GUN[2], "z", 6));
    }
    barrels.push(cylinder([GUN[0], GUN[1], (GUN[2] + breechZ) / 2 + 0.04], 0.06, breechZ - GUN[2] - 0.08, "z", 6)); // spindle
  } else barrels.push(cylinder([GUN[0], GUN[1], (GUN[2] + breechZ) / 2], 0.18, breechZ - GUN[2], "z", sides(8)));
  const autocannon = merge(
    cylinder([GUN[0], GUN[1], -1.07], 0.23, 0.16, "z", sides(10)), // hub
    notFar(() => cylinder([GUN[0], GUN[1], -1.36], 0.2, 0.08, "z", sides(10))), // clamp ring
    cylinder([GUN[0], GUN[1], -1.58], 0.2, 0.08, "z", sides(10)), // muzzle ring
    ...barrels,
  );

  // Left arm: a shorter forearm with a fist that grips the back of the shield.
  const armL = merge(
    mirrorX(pauldronR),
    mirrorX(wallR),
    mirrorX(upperArmR),
    slab([-1.44, 1.9, -0.6], [-0.98, 2.38, 0.15], bev(0.05)), // forearm
    slab([-1.42, 1.94, -0.84], [-1.0, 2.32, -0.58], bev(0.05)), // fist
  );

  // Siege shield: a tall slab whose front comes to a ramming edge (a narrow flat, so it reads sharp without a razor
  // edge), with three reinforcing bands riveted round it. Outlines are (z, x), swept up the y axis.
  const chevron: UV[] = [[-0.8, -2.0], [-0.8, -0.86], [-1.0, -0.86], [-1.22, SHIELD_EDGE_X + 0.04], [-1.22, SHIELD_EDGE_X - 0.04], [-1.0, -2.0]];
  const bandOutline = inset(chevron, -0.04);
  const bands: [number, number][] = [[1.56, 1.76], [2.3, 2.52], [3.02, 3.22]];
  const rivets: MeshData[] = [];
  if (near) {
    for (const [y0, y1] of bands) {
      for (const edge of [2, 4]) { // the two front faces either side of the ramming edge
        const p = bandOutline[edge]!, q = bandOutline[(edge + 1) % bandOutline.length]!;
        const [nz, nx] = edgeOut(bandOutline, edge);
        for (const t of [0.3, 0.72]) rivets.push(bolt([p[1] + (q[1] - p[1]) * t, (y0 + y1) / 2, p[0] + (q[0] - p[0]) * t], [nx, 0, nz], 0.04));
      }
    }
  }
  const shield = merge(
    block(chevron, "y", 1.38, 3.42, bev(0.05)),
    ...(far ? [] : bands.map(([y0, y1]) => block(bandOutline, "y", y0, y1, bev(0.02)))),
    ...rivets,
  );

  // Pile driver: a ram cylinder along the top of the fist, its rod cocked out the back, and the spike standing out of
  // the shield's ramming edge. Two hydraulic lines run along the ram; a hose brings it pressure from the forearm.
  const [px, py] = PILE;
  const pileDriver = merge(
    cylinder([px, py, -0.36], 0.16, 0.86, "z", sides(10)), // ram housing
    cylinder([px, py, -0.72], 0.2, 0.1, "z", sides(10)), // front collar
    cylinder([px, py, 0.02], 0.2, 0.1, "z", sides(10)), // rear collar
    cylinder([px, py, 0.28], 0.075, 0.44, "z", sides(8)), // cocked rod
    notFar(() => cylinder([px, py, 0.53], 0.12, 0.08, "z", sides(8))), // rod cap
    notFar(() => cylinder([px + 0.19, py - 0.12, -0.4], 0.05, 0.6, "z", 6)), // outer hydraulic line
    cylinder([px, py, -1.32], 0.13, 0.4, "z", sides(8), 0.04), // spike
    slab([-1.5, 2.3, -0.7], [-1.3, 2.38, 0.0]), // saddle on the fist
    only(() => merge(
      cylinder([px - 0.19, py - 0.12, -0.4], 0.05, 0.6, "z", 6), // inner hydraulic line
      rod([-1.12, 2.36, -0.12], [-1.14, 2.52, 0.04], 0.035, 6), // pressure hose, forearm to the rear collar
      rod([-1.14, 2.52, 0.04], [-1.24, 2.56, 0.06], 0.035, 6),
    )),
  );

  // Arm frame: shoulder and elbow joints, the ammo feed from the drum to the breech, and the pistons that hold each
  // forearm up.
  const feed = near
    ? merge(...[-0.78, -0.86, -0.94].map((z) => slab([1.43, 2.3, z - 0.035], [1.57, 2.46, z + 0.035], 0.01))) // belt chute, in links
    : slab([1.43, 2.3, -0.98], [1.57, 2.46, -0.74]);
  const armFrame = merge(
    pair(cylinder([0.97, 2.84, 0], 0.22, 0.24, "x", sides(10))), // shoulder joints
    cylinder([1.2, 2.4, 0.02], 0.17, 0.5, "x", sides(10)), // right elbow
    cylinder([-1.2, 2.2, 0.1], 0.17, 0.5, "x", sides(10)), // left elbow
    feed,
    only(() => pair(merge(
      rod([1.21, 2.64, 0.28], [1.21, 2.45, 0.27], 0.06, 8), // forearm piston sleeve, under the pauldron
      rod([1.21, 2.47, 0.27], [1.21, 2.28, 0.24], 0.035, 6), // its rod, down to the forearm
    ))),
  );

  // ---- Legs, right side, then mirrored. Leg pieces are cut apart at the joints by which bone each shape sits nearest
  // (packages/client/src/legRig.ts), so nothing here may straddle a joint: a piston is a sleeve on one bone and a rod on
  // the next, and a shape near the ankle sits clearly above it (shin) or below it (foot).
  const shinPanel = hazardPanel("z", -SHIN_D / 2, -1, [LX - 0.2, LX + 0.2], [-shinLength / 2 + 0.2, shinLength / 2 - 0.08], stripeWidth); // clear of the ankle armour
  const onThigh = (m: MeshData) => between(HIP, KNEE, m);
  const onShin = (m: MeshData) => between(KNEE, ANKLE, m);

  const legR = merge(
    slab([0.3, 1.28, -0.4], [0.86, 1.64, 0.26], bev(0.07)), // hip armour; Leg_L's carries the serial on its front
    onThigh(box([LX, 0, 0], [0.5, thighLength + 0.2, 0.46], bev(0.07))), // thigh
    notFar(() => onThigh(block(cut(LX - 0.21, LX + 0.21, -thighLength * 0.36, thighLength * 0.42, 0.05), "z", -0.3, -0.21, bev(0.02)))), // thigh plate
    onShin(box([LX, 0, 0], [SHIN_W, shinLength, SHIN_D], bev(0.07))), // shin
    onShin(box([LX, shinLength / 2 - 0.04, 0.1], [0.48, 0.28, 0.34], bev(0.06))), // knee cap at the back, low enough to ride with the shin
    // Ankle armour, thick to take the gun's recoil, its front sloped. It rides with the foot.
    block(cut(0.1, 0.5, -0.42, 0.22, [0.04, 0.14, 0.08, 0.04]), "x", 0.27, 0.87, bev(0.04)),
    only(() => merge(bolt([0.86, 1.38, -0.22], OUT), bolt([0.86, 1.54, -0.22], OUT))), // hip armour to the hip joint
  );

  // Feet: a heel block and two toes with a gap between them, planted wide for stability, and a heel spur.
  const footR = far
    ? merge(slab([0.26, 0, -0.76], [0.88, 0.24, 0.36]), slab([0.4, 0.04, 0.3], [0.74, 0.26, 0.54]))
    : merge(
      slab([0.26, 0, -0.3], [0.88, 0.2, 0.36], bev(0.05)), // heel block
      ...[[0.26, 0.555], [0.585, 0.88]].map(([x0, x1]) => block(cut(0, 0.26, -0.78, -0.26, [0, 0.12, 0, 0]), "x", x0!, x1!, bev(0.03))), // toes
      block(cut(0.04, 0.28, 0.3, 0.54, [0, 0, 0.1, 0]), "x", 0.4, 0.74, bev(0.03)), // heel spur
    );

  // Pistons: hip, knee and ankle joints, a piston down the outside spanning the knee (its sleeve on the thigh, its rod
  // on the shin) fed by a hose from the hip, and a calf piston behind the shin.
  // A joint round its own bone sits exactly between two bones, so which piece it lands in would be a coin toss that
  // could differ between levels of detail; 2 cm up its bone settles it (the knee rides the thigh, the ankle the shin).
  const kneeAt = toward(KNEE, HIP, 0.02), ankleAt = toward(ANKLE, KNEE, 0.02);
  const pistonsR = merge(
    cylinder([0.36, HIP[1], HIP[2]], 0.21, 0.2, "x", sides(10)), // hip joint
    cylinder([LX, kneeAt[1], kneeAt[2]], 0.22, 0.62, "x", sides(12)), // knee joint
    notFar(() => cylinder([0.9, kneeAt[1], kneeAt[2]], 0.12, 0.06, "x", sides(10))), // knee hub cap
    cylinder([LX, ankleAt[1], ankleAt[2]], 0.19, 0.62, "x", sides(10)), // ankle joint
    rod([0.88, 1.36, -0.02], [0.88, 0.95, -0.04], 0.1, sides(8)), // outer sleeve
    rod([0.88, 0.98, -0.04], [0.88, 0.56, -0.08], 0.06, sides(6)), // outer rod
    notFar(() => rod([LX, 0.92, 0.39], [LX, 0.62, 0.3], 0.09, sides(8))), // calf sleeve
    notFar(() => rod([LX, 0.64, 0.31], [LX, 0.3, 0.24], 0.055, sides(6))), // calf rod
    only(() => merge(
      cylinder([0.88, 1.37, -0.02], 0.07, 0.1, "x", 8), // pin at the sleeve's top
      cylinder([0.88, 0.57, -0.08], 0.065, 0.1, "x", 8), // pin at the rod's foot
      rod([0.86, 1.34, -0.3], [0.94, 1.31, -0.22], 0.03, 6), // hydraulic hose, hip armour to the sleeve
      rod([0.94, 1.31, -0.22], [0.94, 1.36, -0.08], 0.03, 6),
    )),
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
    Arm_L: armL,
    Shield: shield,
    Pile_Driver: pileDriver,
    Arm_Frame: armFrame,
    Shoulder_Stripes: pair(merge(outerStripes.yellow, topStripes.yellow)),
    Shoulder_Stripes_Black: pair(merge(outerStripes.black, topStripes.black)),
    Leg_R: legR,
    Leg_L: mirrorX(legR),
    Feet: pair(footR),
    Pistons: pair(pistonsR),
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
  { name: "Torso_Fx", translation: [0, 3.0, 0.25] },
  { name: "Arm_R_Fx", translation: [1.2, 2.66, -0.45] },
  { name: "Leg_L_Fx", translation: [-0.82, 1.1, 0.05] },
  ...bothLegs(HIP, KNEE, ANKLE),
);

const dir = join(new URL("../..", import.meta.url).pathname, "assets/models/mechs/ironclad");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Ironclad.glb"), writeGlb(parts, { quantize: true }));
const stored = parts.reduce((s, p) => s + (p.mesh ? triangles(p.mesh) : 0), 0);
console.log(`Wrote ${join(dir, "Mech_Ironclad.glb")}: ${totals.join(" / ")} triangles drawn near / middle / far, ${stored} stored`);
