// Arbiter, the electronic warfare and command mech (docs/MECH_ROSTER.md, section 4): slender digitigrade legs on broad
// magnetic feet, a narrow white chassis with teal energy strips, an oversized round radome for a head, a comms mast on
// the left shoulder, and four utility drones held round the body on jointed pylons. At range it should read as
// "the big round head and the ring of drones".
// Detail pass (V7c): chamfered plates laid over the main shells with a visible seam, bolt rows where plates are held
// on, and pistons that drive the knees, hocks and elbows. Big calm masses (the dome above all) stay plain.
// Three levels of detail, nearest first: the near one has everything; the middle one drops bolts, fins and piston
// rods and rounds things with fewer sides; the far one is plain boxes and the same silhouette.
// Writes the model and scripts/mechs/arbiter.kit.json, the paint and zone of every part.
// Run: npx tsx scripts/mechs/arbiter.ts  →  assets/models/mechs/arbiter/Mech_Arbiter.glb
// Metres, Y up, facing -Z, right side +X, feet at y = 0. Every part is built in place on the assembled mech.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MeshData, NodeData } from "../assets/glbWrite";
import { writeGlb } from "../assets/glbWrite";
import { bothLegs } from "./joints";
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

// A hex bolt head at `at` on a surface facing `out`, standing a little proud of it.
const bolt = (at: V3, out: V3, r = 0.024): MeshData => tube(add(at, scale(out, -0.01)), add(at, scale(out, 0.022)), r, 6);

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

// ---- Leg joints. Digitigrade: the thigh runs down and forward to the knee, the shin back to a raised hock, a short
// bone forward to the ankle, then a broad flat magnetic foot. The game cuts each leg at these points by which bone
// each shape sits nearest (packages/client/src/legRig.ts), so every shape below is placed clearly on one bone.
const legX = 0.42;
const hip: V3 = [legX, 1.52, 0.02], knee: V3 = [legX, 1.02, -0.2], hock: V3 = [legX, 0.42, 0.22], ankle: V3 = [legX, 0.17, 0.0];
const thighDir = unit(sub(knee, hip)), shinDir = unit(sub(hock, knee));
const thighFront: V3 = [0, -thighDir[2], thighDir[1]]; // faces forward and a little up
const shinFront: V3 = [0, -shinDir[2], shinDir[1]]; // faces forward and down
const shinBack = scale(shinFront, -1);
const outward: V3 = [1, 0, 0];

// The radome: far bigger than a head needs to be, sitting low in a collar. It is the silhouette.
const domeCentre: V3 = [0, 3.68, 0];
// Comms mast on the left shoulder, behind the dome, on a bracket off the yoke. The asymmetry has a job: the mast
// relays the drones, and it sits on the side away from the gun so it stays out of the line of fire.
const mastX = -0.68, mastZ = 0.42;
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
const placed = (mesh: MeshData, p: DronePlace) => turn(mesh, [0, Math.atan2(-p.at[0], -(p.at[2] - 1.0)), 0], [0, 0, 0], p.at);

// Every part's mesh at one level of detail (0 nearest).
function build(lod: 0 | 1 | 2): Record<string, MeshData> {
  const pick = <T>(near: T, mid: T, far: T): T => [near, mid, far][lod]!;
  const nearOnly = (m: () => MeshData) => (lod === 0 ? m() : empty());
  const notFar = (m: () => MeshData) => (lod < 2 ? m() : empty());
  // Chamfer size. From the middle level out a chamfer is under a pixel wide, so only the nearest has them.
  const c = (near: number) => pick(near, 0, 0);
  const round = (near: number) => pick(near, Math.max(6, near - 4), 6);

  // ---- Right leg, mirrored for the left. White shells and plates (Leg_R), the dark frame, pistons and bolts.
  const thighAt = (t: number, front = 0) => add(lerp(hip, knee, t), scale(thighFront, front));
  const shinAt = (t: number, front = 0) => add(lerp(knee, hock, t), scale(shinFront, front));
  // The knee actuator rides on the outside of the thigh: its sleeve hangs from below the hip cap, its rod ends on a
  // lug at the knee drum. The calf actuator runs down the back of the shin to the hock and lifts the foot.
  const thighRam: [V3, V3] = [add(thighAt(0.36), [0.17, 0, 0]), add(thighAt(0.92), [0.16, 0, 0])];
  const calfRam: [V3, V3] = [shinAt(0.14, -0.15), shinAt(0.9, -0.12)];
  const ramSleeve = ([a, b]: [V3, V3]) => tube(a, lerp(a, b, 0.58), 0.05, round(8));
  const ramRod = ([a, b]: [V3, V3]) => tube(lerp(a, b, 0.5), b, 0.026, 6);

  const legShellR = merge(
    bar(thighAt(-0.08), thighAt(0.92), [0.26, 0.34], c(0.05), [0.22, 0.25]), // thigh
    notFar(() => bar(thighAt(0.1, 0.18), thighAt(0.76, 0.13), [0.24, 0.07], c(0.025), [0.2, 0.07])), // thigh plate
    notFar(() => cylinder(add(hip, [0.155, 0, 0]), 0.17, 0.05, "x", round(10))), // hip cap over the drum
    // Knee guard, hung off the bottom of the thigh over the front of the knee.
    slab([[1.28, -0.27], [1.16, -0.4], [1.0, -0.39], [0.95, -0.31], [1.14, -0.21]], "x", legX - 0.11, legX + 0.11, c(0.03)),
    bar(shinAt(-0.04), shinAt(1), [0.2, 0.22], c(0.04), [0.17, 0.18]), // shin
    notFar(() => bar(shinAt(0.14, 0.12), shinAt(0.82, 0.1), [0.22, 0.06], c(0.02), [0.18, 0.06])), // shin guard
    notFar(() => merge(ramSleeve(calfRam), ramSleeve(thighRam))),
    bar(hock, add(ankle, [0, -0.02, -0.03]), [0.16, 0.16], c(0.03), [0.14, 0.14]), // hock to ankle
    box([legX, 0.12, -0.06], [0.4, 0.1, 0.58], c(0.035)), // foot
    notFar(() => slab([[0.07, -0.33], [0.17, -0.33], [0.13, -0.47], [0.07, -0.47]], "x", legX - 0.19, legX + 0.19, c(0.025))), // toe
    notFar(() => bar([legX, 0.16, 0.16], [legX, 0.08, 0.32], [0.2, 0.1], c(0.03), [0.16, 0.08])), // heel spur
  );
  const legFrameR = merge(
    cylinder(hip, 0.14, 0.3, "x", round(10)),
    cylinder(knee, 0.12, 0.28, "x", round(10)),
    notFar(() => merge(cylinder(hock, 0.1, 0.24, "x", round(8)), cylinder(ankle, 0.085, 0.22, "x", round(8)))),
    // The magnetic pad is a little wider than the foot, so the locking plate shows as a dark rim at ground level.
    box([legX, 0.035, -0.06], [0.46, 0.07, 0.64], c(0.02)),
    notFar(() => merge(ramRod(thighRam), ramRod(calfRam))),
    nearOnly(() => merge(
      cylinder(thighRam[1], 0.045, 0.06, "x", 6), // rod lug on the knee drum
      bar(shinAt(0.1, -0.06), calfRam[0], [0.06, 0.07]), // sleeve lug off the back of the shin
      bar(shinAt(0.86, -0.04), calfRam[1], [0.06, 0.07]), // rod lug above the hock
      // Bolts: four hold the hip cap on, two each the thigh plate and the shin guard.
      ...[45, 135, 225, 315].map((a) => bolt(add(hip, [0.18, Math.sin(a * deg) * 0.11, Math.cos(a * deg) * 0.11]), outward)),
      ...[-0.07, 0.07].map((x) => bolt(add(thighAt(0.18, 0.215), [x, 0, 0]), thighFront)),
      ...[-0.07, 0.07].map((x) => bolt(add(shinAt(0.2, 0.15), [x, 0, 0]), shinFront)),
    )),
  );
  // A teal conduit down the front of each shin feeds the magnetic foot, and the lock glows along the pad when it holds.
  const legGlowR = merge(
    bar(shinAt(0.28, 0.155), shinAt(0.72, 0.135), [0.06, 0.03]),
    notFar(() => merge(box([legX + 0.235, 0.05, -0.06], [0.025, 0.03, 0.5]), box([legX - 0.235, 0.05, -0.06], [0.025, 0.03, 0.5]))),
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
  );
  const torsoFrame = merge(
    box([0, 1.56, 0.02], [0.6, 0.26, 0.4], c(0.05)), // pelvis, between the hip drums
    box([0, 1.73, 0.02], [0.34, 0.12, 0.3], c(0.03)), // waist segments, so the chest can turn
    box([0, 1.85, 0.02], [0.4, 0.12, 0.34], c(0.03)),
    box([0, 2.5, 0.42], [0.6, 0.72, 0.26], c(0.05)), // electronics pack
    cylinder([0.66, 2.9, 0.02], 0.13, 0.24, "x", round(10)), // shoulder joints
    cylinder([-0.66, 2.9, 0.02], 0.13, 0.24, "x", round(10)),
    box([-0.26, 2.54, -0.295], [0.2, 0.68, 0.05], c(0.015)), // conduit channel up the left chest
    nearOnly(() => merge(
      // Heat sink fins under the pack cover: the electronics pack is what runs hot.
      ...[0, 1, 2].map((i) => box([0, 2.22 + i * 0.09, 0.575], [0.46, 0.035, 0.07])),
      // Bolt rows above and below the serial hold the chest plate on.
      ...[2.27, 2.81].flatMap((y) => [-0.06, 0.12, 0.3].map((x) => onChest(bolt([x, y, chestFace], [0, 0, -1])))),
    )),
  );
  const torsoTrim = merge(
    box([0.425, 2.62, 0], [0.07, 0.42, 0.36], c(0.025)), // flank panels
    box([-0.395, 2.62, 0], [0.07, 0.42, 0.36], c(0.025)),
    box([0, 2.66, 0.565], [0.48, 0.34, 0.06], c(0.02)), // pack cover
    notFar(() => box([0, 3.03, -0.235], [0.76, 0.08, 0.04], c(0.015))), // livery stripe on the yoke
  );
  const torsoGlow = merge(
    box([-0.31, 2.54, -0.315], [0.05, 0.56, 0.04]),
    box([-0.21, 2.54, -0.315], [0.05, 0.56, 0.04]),
    onChest(box([0.12, 2.17, chestFace + 0.03], [0.34, 0.05, 0.05])), // under the chest plate
  );

  // ---- Radome head. Round in plan so the glowing ring round its middle stands proud by the same amount all the way
  // round. The collar is bolted on, the bolts in a ring round it.
  const sensor = ellipsoid(domeCentre, [0.68, 0.62, 0.68], pick(20, 12, 8),
    pick([-50, -32, -15, 0, 18, 36, 54, 72], [-50, -20, 10, 40, 70], [-50, -10, 35, 70]));
  const sensorRing = cylinder(domeCentre, 0.71, 0.08, "y", pick(20, 12, 8));
  const sensorFrame = merge(
    cylinder([0, 3.2, 0.02], 0.34, 0.18, "y", pick(16, 12, 8), 0.44), // collar, flaring up to cup the dome
    nearOnly(() => merge(...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6, out: V3 = [Math.sin(a), 0.4, Math.cos(a)];
      return bolt([Math.sin(a) * 0.4, 3.22, 0.02 + Math.cos(a) * 0.4], unit(out));
    }))),
  );
  const mast = merge(
    bar([-0.42, 3.06, 0.24], [mastX, 3.16, mastZ], [0.12, 0.1], c(0.03)), // bracket off the yoke
    notFar(() => box([mastX, 3.2, mastZ], [0.24, 0.12, 0.24], c(0.03))),
    cylinder([mastX, 3.8, mastZ], 0.06, 1.2, "y", pick(8, 6, 4), 0.045),
    box([mastX, 3.98, mastZ], [0.36, 0.08, 0.08], c(0.02)), // antenna elements
    box([mastX, 4.18, mastZ], [0.26, 0.07, 0.07], c(0.02)),
    cylinder([mastX, 4.44, mastZ], 0.08, 0.08, "y", pick(8, 6, 4), 0.05), // beacon
    nearOnly(() => merge(bolt([mastX - 0.08, 3.26, mastZ - 0.08], [0, 1, 0], 0.02), bolt([mastX + 0.08, 3.26, mastZ + 0.08], [0, 1, 0], 0.02))),
  );

  // ---- Arms. Slim upper arms, forearm housings held forward with a light SMG in each wrist. The right one is the
  // weapon in hand (Mount_Gun at its muzzle); the left is the backup (Mount_Gun_2), and they fire in turn.
  const armR = merge(
    bar([1.0, 2.86, 0.02], [1.0, 2.32, 0.0], [0.2, 0.22], c(0.04), [0.18, 0.2]),
    notFar(() => bar([1.115, 2.8, 0.02], [1.115, 2.42, 0.01], [0.05, 0.24], c(0.018))), // outer arm plate
    slab([[2.21, -0.06], [2.47, -0.06], [2.49, -0.6], [2.42, -0.76], [2.24, -0.76]], "x", 0.97, 1.19, c(0.035)), // forearm
    notFar(() => bar([1.2, 2.36, -0.14], [1.2, 2.36, -0.62], [0.04, 0.2], c(0.015))), // forearm side plate
  );
  const armL = merge(
    bar([-1.0, 2.84, 0.02], [-1.0, 2.32, 0.0], [0.18, 0.2], c(0.04), [0.17, 0.19]),
    slab([[2.21, -0.06], [2.43, -0.06], [2.45, -0.56], [2.39, -0.7], [2.23, -0.7]], "x", -1.16, -0.96, c(0.035)),
  );
  // The elbow actuator runs down the front of the upper arm onto the top of the forearm.
  const elbowRam = (x: number): MeshData => notFar(() => merge(
    tube([x, 2.78, -0.12], [x, 2.62, -0.2], 0.04, round(8)),
    nearOnly(() => tube([x, 2.66, -0.18], [x, 2.5, -0.3], 0.022, 6)),
  ));
  const pauldronTurn = (side: number): V3 => [0, 0, -0.15 * side];
  const armFrameR = merge(
    cylinder([1.02, 2.3, 0], 0.115, 0.26, "x", round(10)), // elbow
    cylinder([1.2, 2.4, -0.77], 0.12, 0.06, "z", round(8)), // wrist collar the gun sits in
    elbowRam(1.0),
    nearOnly(() => merge(...[-0.14, 0, 0.14].map((z) =>
      turn(bolt([1.1, 2.94, 0.02 + z], [1, 0, 0]), pauldronTurn(1), [0.92, 2.98, 0.02])))),
  );
  const armFrameL = merge(
    cylinder([-1.02, 2.3, 0], 0.105, 0.24, "x", round(10)),
    cylinder([-1.14, 2.37, -0.71], 0.1, 0.05, "z", round(8)),
    elbowRam(-1.0),
  );
  const pauldron = (side: number, centre: V3, size: V3) => merge(
    turn(box(centre, size, c(0.06)), pauldronTurn(side), centre),
    notFar(() => turn(box(add(centre, [-0.02 * side, size[1] / 2 + 0.03, 0]), [size[0] - 0.1, 0.06, size[2] - 0.1], c(0.02)), pauldronTurn(side), centre)),
  );
  const gunR = merge(
    box([1.2, 2.4, -0.98], [0.18, 0.2, 0.46], c(0.03)), // receiver
    box([1.2, 2.23, -0.9], [0.1, 0.16, 0.12], c(0.02)), // magazine
    notFar(() => box([1.2, 2.52, -0.98], [0.06, 0.04, 0.28], c(0.012))), // sight rail
    cylinder([1.2, 2.4, -1.3], 0.08, 0.2, "z", round(10)), // shroud
    nearOnly(() => merge(cylinder([1.2, 2.4, -1.24], 0.092, 0.03, "z", 10), cylinder([1.2, 2.4, -1.36], 0.092, 0.03, "z", 10))), // shroud clamps
    cylinder([1.2, 2.4, -1.48], 0.04, 0.2, "z", round(8)), // barrel
    notFar(() => cylinder([1.2, 2.4, -1.615], 0.055, 0.07, "z", round(8))), // muzzle brake, its face at z = -1.65
  );
  const gunL = merge(
    box([-1.14, 2.37, -0.88], [0.14, 0.16, 0.36], c(0.03)),
    cylinder([-1.14, 2.37, -1.15], 0.035, 0.2, "z", round(8)),
    cylinder([-1.14, 2.37, -1.27], 0.05, 0.06, "z", round(8)), // its face at z = -1.3
  );

  // ---- Drones (no hit boxes): small white pods with a glowing teal eye in a dark bezel and a repair emitter under
  // the nose, each held out on a two-segment pylon from the shoulders or the back.
  const pod = merge(
    ellipsoid([0, 0, 0], [0.2, 0.15, 0.25], pick(10, 8, 6), pick([-90, -40, 0, 40, 70], [-90, -30, 30, 70], [-90, 0, 60])),
    box([0, 0, 0.06], [0.52, 0.05, 0.14], c(0.015)), // stabiliser fins
  );
  const eye = merge(
    cylinder([0, 0, -0.215], 0.09, 0.08, "z", pick(10, 8, 6)),
    nearOnly(() => box([0, -0.14, -0.08], [0.08, 0.04, 0.1])), // repair emitter
  );
  const bezel = cylinder([0, 0, -0.185], 0.115, 0.05, "z", pick(10, 8, 6));
  const joint = (at: V3) => ellipsoid(at, [0.08, 0.08, 0.08], 6, [-90, 0]);
  const pylon = (p: DronePlace) => merge(
    nearOnly(() => merge(joint(p.mount), joint(p.elbow))),
    notFar(() => placed(bezel, p)),
    // Far off a pylon is under a pixel wide, so the far level draws it thicker to keep the ring of drones joined up.
    bar(p.mount, p.elbow, pick<P2>([0.09, 0.09], [0.09, 0.09], [0.13, 0.13]), c(0.02)),
    bar(p.elbow, p.at, pick<P2>([0.08, 0.08], [0.08, 0.08], [0.12, 0.12]), c(0.02)),
  );

  const mirrorLeg = (m: MeshData) => merge(m, mirrorX(m));
  return {
    Torso: torso,
    Torso_Frame: torsoFrame,
    Torso_Trim: torsoTrim,
    Torso_Glow: torsoGlow,
    Sensor: sensor,
    Sensor_Ring: sensorRing,
    Sensor_Frame: sensorFrame,
    Mast: mast,
    Drones: merge(...dronePlaces.map((p) => placed(pod, p))),
    Drone_Eyes: merge(...dronePlaces.map((p) => placed(eye, p))),
    Drone_Pylons: merge(...dronePlaces.map(pylon)),
    Leg_L: mirrorX(legShellR),
    Leg_R: legShellR,
    Leg_Frame: mirrorLeg(legFrameR),
    Leg_Glow: mirrorLeg(legGlowR),
    Arm_L: armL,
    Arm_R: armR,
    Arm_Frame_L: armFrameL,
    Arm_Frame_R: armFrameR,
    Arm_Glow_L: box([-1.06, 2.455, -0.26], [0.05, 0.04, 0.3]),
    Arm_Glow_R: box([1.08, 2.5, -0.42], [0.06, 0.04, 0.42]),
    Arm_Accent: box([-1.06, 2.33, -0.52], [0.24, 0.27, 0.1], c(0.02)), // the pilot's band round the left forearm
    Pauldron_L: pauldron(-1, [-0.9, 2.96, 0.02], [0.32, 0.22, 0.44]),
    Pauldron_R: pauldron(1, [0.92, 2.98, 0.02], [0.36, 0.26, 0.48]),
    Gun_R: gunR,
    Gun_L: gunL,
  };
}

// Each part's hit zone, paint (a name from `scheme`, or one the game knows) and flags; see packages/client/src/mechKit.ts.
type Look = { zone: "legs" | "arms" | "torso"; paint: string; glow?: true; rusts?: false; noHit?: true };
const frame = (zone: Look["zone"]): Look => ({ zone, paint: "frame", rusts: false });
const glow = (zone: Look["zone"]): Look => ({ zone, paint: "tealGlow", glow: true });
const looks: Record<string, Look> = {
  Torso: { zone: "torso", paint: "white" },
  Torso_Frame: frame("torso"),
  Torso_Trim: { zone: "torso", paint: "teal" },
  Torso_Glow: glow("torso"),
  Sensor: { zone: "torso", paint: "dome", rusts: false },
  Sensor_Ring: { zone: "torso", paint: "domeGlow", glow: true, rusts: false },
  Sensor_Frame: frame("torso"),
  Mast: frame("torso"),
  Drones: { zone: "torso", paint: "white", noHit: true },
  Drone_Eyes: { zone: "torso", paint: "tealGlow", glow: true, noHit: true },
  Drone_Pylons: { zone: "torso", paint: "frame", rusts: false, noHit: true },
  Leg_L: { zone: "legs", paint: "white" },
  Leg_R: { zone: "legs", paint: "white" },
  Leg_Frame: frame("legs"),
  Leg_Glow: glow("legs"),
  Arm_L: { zone: "arms", paint: "white" },
  Arm_R: { zone: "arms", paint: "white" },
  Arm_Frame_L: frame("arms"),
  Arm_Frame_R: frame("arms"),
  Arm_Glow_L: glow("arms"),
  Arm_Glow_R: glow("arms"),
  Arm_Accent: { zone: "arms", paint: "accent" },
  Pauldron_L: { zone: "arms", paint: "teal" },
  Pauldron_R: { zone: "arms", paint: "teal" },
  Gun_R: { zone: "arms", paint: "weapon" },
  Gun_L: { zone: "arms", paint: "weapon" },
};
const scheme = { white: "#F0F0EE", teal: "#1FB8B0", frame: "#2C3640", dome: "#3F8FE0", tealGlow: "#3FF0E0", domeGlow: "#9FD8FF" };

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
writeFileSync(join(root, "scripts/mechs/arbiter.kit.json"), `${JSON.stringify({ scheme, parts: looks }, null, 2)}\n`);
const count = (lod: number) => Object.values(levels[lod]!).reduce((s, m) => s + triangles(m), 0);
console.log(`Mech_Arbiter.glb: ${count(0)} triangles near, ${count(1)} and ${count(2)} at range (${count(0) + count(1) + count(2)} in the file)`);
for (const name of Object.keys(looks)) console.log(`  ${name.padEnd(13)} ${levels.map((l) => String(triangles(l[name]!)).padStart(5)).join(" ")}`);
