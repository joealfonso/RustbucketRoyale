// Builds the Stiletto-B (docs/MECH_ROSTER.md, section 2), a light recon and flanker: backward-bending bird legs on
// sprung joints, a keeled chest on a thin skeleton waist, a long raptor head with one swept-back sensor fin and a thin
// green visor, a plasma blade on the right wrist, a burst carbine under the left forearm, and a big jump pack whose
// two stabilizer fins rise above the shoulders. Blue and white urban camo is modelled as blue plates laid over the
// white shell, each paint its own part. Every part is built in place on the assembled mech (metres, Y up, facing -Z,
// right side +X). Writes the model and scripts/mechs/stiletto.kit.json, the paint and zone of every part.
// Run: npx tsx scripts/mechs/stiletto.ts
//
// Levels of detail: the same build runs three times. The nearest keeps bevels, bolts, pistons and seams; the middle
// (past 25 m, data/mechKits.json lodDistances) drops the small parts and the bevels; the far one (past 80 m) keeps
// only the masses that make the silhouette: legs, chest, head fin, pack fins, arms, blade and carbine.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { bothLegs } from "./joints";
import { box, convex, empty, merge, mirrorX, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const length = (a: V3) => Math.hypot(...a);
// The part of `toward` square to `dir`, as a unit vector: "the side of this limb that faces that way".
const perp = (dir: V3, toward: V3): V3 => norm(sub(toward, scale(dir, dot(toward, dir))));
const mirrorPoint = (p: V3): V3 => [-p[0], p[1], p[2]];
const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];

type Lod = 0 | 1 | 2;
type Size = [number, number];

// A rectangle round `centre`, `w` along `ex` and `h` along `ey`, its corners cut by `c` metres (an octagon); with no
// cut, four corners.
function ring(centre: V3, ex: V3, ey: V3, w: number, h: number, c: number): V3[] {
  const hw = w / 2, hh = h / 2, k = Math.min(c, hw * 0.45, hh * 0.45);
  const uv: [number, number][] = k > 0.002
    ? [[-hw + k, -hh], [hw - k, -hh], [hw, -hh + k], [hw, hh - k], [hw - k, hh], [-hw + k, hh], [-hw, hh - k], [-hw, -hh + k]]
    : [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return uv.map(([u, v]) => add(centre, add(scale(ex, u), scale(ey, v))));
}

// A solid through matching rings in order, capped at both ends. Side quads are split in two so every face stays
// flat when neighbouring rings differ in size. `convex` turns faces outward, so the rings must make a convex shape.
function loft(rings: V3[][]): MeshData {
  const faces: V3[][] = [rings[0]!, rings.at(-1)!];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!, b = rings[r + 1]!;
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      faces.push([a[i]!, a[j]!, b[j]!], [a[i]!, b[j]!, b[i]!]);
    }
  }
  return convex(faces);
}

// Unit axes across a run along `dir`: the first as near `side` as it can be, the second square to both.
function across(dir: V3, side: V3): [V3, V3] {
  let w = sub(side, scale(dir, dot(side, dir)));
  if (length(w) < 1e-6) w = cross(dir, Math.abs(dir[1]) < 0.9 ? Y : X);
  w = norm(w);
  return [w, norm(cross(dir, w))];
}

// A convex outline moved in by `e` on every edge (each corner slides along its bisector), for the bevelled faces of
// a slab. Throws on an outline that is not convex, which would turn the solid inside out.
function inset(outline: [number, number][], e: number): [number, number][] {
  const n = outline.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, y0] = outline[i]!, [x1, y1] = outline[(i + 1) % n]!; area += x0 * y1 - x1 * y0; }
  const sign = area > 0 ? 1 : -1;
  const inward = (i: number): [number, number] => {
    const [x0, y0] = outline[i]!, [x1, y1] = outline[(i + 1) % n]!, l = Math.hypot(x1 - x0, y1 - y0);
    return [(-(y1 - y0) / l) * sign, ((x1 - x0) / l) * sign];
  };
  return outline.map((p, i) => {
    const a = inward((i + n - 1) % n), b = inward(i);
    const [x0, y0] = outline[(i + n - 1) % n]!, [x2, y2] = outline[(i + 1) % n]!;
    if (((p[0] - x0) * (y2 - p[1]) - (p[1] - y0) * (x2 - p[0])) * sign <= 0) throw new Error(`outline is not convex at corner ${i}`);
    const k = e / (1 + a[0] * b[0] + a[1] * b[1]);
    return [p[0] + (a[0] + b[0]) * k, p[1] + (a[1] + b[1]) * k];
  });
}

// The shape makers for one level of detail. Bevels and fine round shapes only on the nearest level; `near` keeps a
// shape on the nearest level only, `mid` on the nearest two.
function makers(lod: Lod) {
  const near = (...m: MeshData[]) => (lod === 0 ? merge(...m) : empty());
  const mid = (...m: MeshData[]) => (lod <= 1 ? merge(...m) : empty());

  // A bevelled bar through stations (each a point and a [w, h] size), `w` measured along the axis nearest `side`.
  // The stations must lie on one line and make a convex shape. Its ends and long edges are bevelled by `bevel` on
  // the nearest level; past that the bar is square, unless `corner` is given: big masses keep their cut corners on
  // every level, so the silhouette does not change as the levels swap.
  function run(stations: [V3, Size][], side: V3, bevel = 0.03, corner?: number): MeshData {
    const first = stations[0]![0], last = stations.at(-1)![0];
    const dir = norm(sub(last, first)), [ex, ey] = across(dir, side);
    const cut = corner ?? (lod === 0 ? bevel : 0);
    const at = ([p, [w, h]]: [V3, Size], inBy = 0, move = 0) => ring(add(p, scale(dir, move)), ex, ey, w - 2 * inBy, h - 2 * inBy, cut);
    const sizes = stations.flatMap(([, s]) => s);
    const e = lod === 0 ? Math.min(bevel, length(sub(last, first)) * 0.3, ...sizes.map((s) => s * 0.3)) : 0;
    if (e <= 0.004) return loft(stations.map((s) => at(s)));
    return loft([at(stations[0]!, e), at(stations[0]!, 0, e), ...stations.slice(1, -1).map((s) => at(s)), at(stations.at(-1)!, 0, -e), at(stations.at(-1)!, e)]);
  }
  const bar = (a: V3, b: V3, side: V3, s0: Size, s1: Size = s0, bevel = 0.03, corner?: number) => run([[a, s0], [b, s1]], side, bevel, corner);

  // A round shaft from a to b (a cone with two radii), its end rims bevelled on the nearest level.
  function cyl(a: V3, b: V3, r0: number, r1 = r0, sides = 12, bevel = 0): MeshData {
    const n = lod === 0 ? sides : lod === 1 ? Math.max(6, Math.round(sides * 0.6)) : Math.max(4, Math.round(sides / 2));
    const dir = norm(sub(b, a)), [u, v] = across(dir, Math.abs(dir[1]) < 0.9 ? Y : X);
    const circle = (c: V3, r: number) => Array.from({ length: n }, (_, i) => {
      const t = ((i + 0.5) / n) * Math.PI * 2;
      return add(c, add(scale(u, Math.cos(t) * r), scale(v, Math.sin(t) * r)));
    });
    const e = lod === 0 ? Math.min(bevel, r0 * 0.4, r1 * 0.4, length(sub(b, a)) * 0.3) : 0;
    if (e <= 0) return loft([circle(a, r0), circle(b, r1)]);
    return loft([circle(a, r0 - e), circle(add(a, scale(dir, e)), r0), circle(sub(b, scale(dir, e)), r1), circle(b, r1 - e)]);
  }

  // A flat plate cut to a convex outline, laid on the plane through `origin` spanned by `u` and `v` (outline points
  // are [along u, along v]), `thick` deep, every edge bevelled on the nearest level so no edge is knife thin.
  function slab(origin: V3, u: V3, v: V3, outline: [number, number][], thick: number, bevel = 0.02): MeshData {
    const n = norm(cross(u, v));
    const at = (pts: [number, number][], w: number) => pts.map(([a, b]) => add(origin, add(add(scale(u, a), scale(v, b)), scale(n, w))));
    const inner = inset(outline, Math.min(bevel, thick * 0.3));
    if (lod > 0) return loft([at(outline, -thick / 2), at(outline, thick / 2)]);
    const e = Math.min(bevel, thick * 0.3);
    return loft([at(inner, -thick / 2), at(outline, -thick / 2 + e), at(outline, thick / 2 - e), at(inner, thick / 2)]);
  }

  // A plain box, its edges bevelled on the nearest level.
  const block = (centre: V3, size: V3, bevel = 0.03) => box(centre, size, lod === 0 ? bevel : 0);

  // Hex bolt heads standing out along `normal`, nearest level only. Each holds a plate to what is under it. They are
  // chunky on purpose: the outline is 6 cm wide (data/look.json), so anything much smaller turns into an ink blot.
  const bolts = (points: V3[], normal: V3, r = 0.04) =>
    near(...points.map((p) => cyl(sub(p, scale(normal, 0.015)), add(p, scale(normal, 0.03)), r, r, 6)));

  // A hydraulic ram from `a` to `b`: a fat cylinder most of the way, a thin rod out of it. `at` is where the rod
  // leaves the cylinder, as a share of the length.
  const ram = (a: V3, b: V3, r: number, at = 0.55) =>
    merge(cyl(a, lerp(a, b, at + 0.05), r, r, 8, r * 0.25), cyl(lerp(a, b, at), b, r * 0.5, r * 0.5, 6));

  // A pair of tendons from `a` to `b`, `apart` metres apart along `side`, each end on a cross pin `pin` long.
  const tendons = (a: V3, b: V3, side: V3, apart: number, r: number, pin: number) => merge(
    ...[-0.5, 0.5].map((k) => cyl(add(a, scale(side, k * apart)), add(b, scale(side, k * apart)), r, r, 6)),
    ...[a, b].map((p) => cyl(sub(p, scale(side, pin / 2)), add(p, scale(side, pin / 2)), r * 1.5, r * 1.5, 8)),
  );

  return { lod, near, mid, run, bar, cyl, slab, block, bolts, ram, tendons };
}

// Leg joints, the same as the walk rig has always used (scripts/mechs/joints.ts), right side.
const HIP: V3 = [0.42, 1.55, 0.02], KNEE: V3 = [0.42, 1.0, -0.32], HOCK: V3 = [0.42, 0.48, 0.26], BALL: V3 = [0.42, 0.12, -0.16];
const THIGH_TOP = add(HIP, [0, 0.05, 0]);
const SHOULDER_R: V3 = [0.78, 2.84, 0], ELBOW_R: V3 = [1.12, 2.42, 0.08], WRIST_R: V3 = [1.2, 2.42, -0.7];
const ELBOW_L = mirrorPoint(ELBOW_R), WRIST_L: V3 = [-1.18, 2.32, -0.44];

type Zone = "legs" | "arms" | "torso";
// `noHit`: spans both arms, so one hit box round it would stretch across the chest.
interface Part { name: string; zone: Zone; paint: string; glow?: true; rusts?: false; noHit?: true; mesh: MeshData }

function build(lod: Lod): Part[] {
  const { near, mid, run, bar, cyl, slab, block, bolts, ram, tendons } = makers(lod);

  // ---- Legs: thigh forward to the knee, shin back to the hock, a long foot forward to three talons and a back
  // spur. Built on the right, then mirrored. Camo alternates side to side: blue outer thigh plate and shin plate on
  // the right, a blue knee cap and foot guard on the left, so the two legs never read as copies. The left outer
  // thigh plate is white and flat: serial 07 is painted on it (data/mechKits.json serials).
  const thighDir = norm(sub(KNEE, THIGH_TOP)), shinDir = norm(sub(HOCK, KNEE)), footDir = norm(sub(BALL, HOCK));
  const thighFront = perp(thighDir, [0, 0, -1]), thighBack = scale(thighFront, -1);
  const shinFront = perp(shinDir, [0, 0, -1]), shinBack = scale(shinFront, -1);
  const footTop = perp(footDir, Y);
  const onThigh = (t: number, out: V3 = [0, 0, 0]) => add(lerp(THIGH_TOP, KNEE, t), out);
  const onShin = (t: number, out: V3 = [0, 0, 0]) => add(lerp(KNEE, HOCK, t), out);
  const onFoot = (t: number, out: V3 = [0, 0, 0]) => add(lerp(HOCK, BALL, t), out);

  // The shell: a thigh that bulges a third of the way down like a bird's drumstick, a slim shin, a long foot.
  const legShellR = merge(
    run([[THIGH_TOP, [0.3, 0.36]], [onThigh(0.3), [0.33, 0.42]], [KNEE, [0.21, 0.24]]], X, 0.04, 0.05),
    run([[KNEE, [0.2, 0.22]], [HOCK, [0.15, 0.17]]], X, 0.03),
    run([[HOCK, [0.15, 0.15]], [BALL, [0.18, 0.12]]], X, 0.03),
  );
  // The outer thigh plate, armour over the hip actuator's drive rods, its inner face sunk in the shell. It leans in
  // with the thigh's taper, so its face stays one flat plane (the serial needs that on the left).
  const plateX = (t: number) => 0.185 - ((t - 0.17) / 0.78) * 0.05;
  const thighPlate = bar(onThigh(0.17, [plateX(0.17), 0, 0]), onThigh(0.95, [plateX(0.95), 0, 0]), X, [0.07, 0.34], [0.07, 0.26], 0.025);
  // Two bolts hold the plate's top under the hip drum, clear of the serial in its middle.
  const thighPlateBolts = merge(
    ...[[0.27, 0.1], [0.27, -0.1]].map(([t, s]) => bolts([add(onThigh(t!, [plateX(t!) + 0.035, 0, 0]), scale(thighFront, s!))], X)),
  );
  // A forward knee cap: the first thing that reads as "bird legs" from the side.
  const kneeCap = bar([0.42, 1.17, -0.39], [0.42, 0.88, -0.47], X, [0.24, 0.15], [0.2, 0.12], 0.035);
  const shinPlate = bar(onShin(0.14, scale(shinFront, 0.115)), onShin(0.78, scale(shinFront, 0.09)), X, [0.15, 0.06], [0.12, 0.06], 0.02);
  const footGuard = bar(onFoot(0.12, scale(footTop, 0.085)), onFoot(0.72, scale(footTop, 0.08)), X, [0.13, 0.05], [0.15, 0.05], 0.02);
  // The pilot's marking: a band round the left thigh above the serial, wrapping the outer plate too.
  const thighBand = bar(onThigh(0.27, [0.03, 0, 0]), onThigh(0.37, [0.03, 0, 0]), X, [0.41, 0.44], [0.41, 0.43], 0.015);

  // The joints and what moves them. Hip: a big actuator drum. Knee: a piston on the front
  // of the thigh pushes the knee cap. Hock: the sprung joint, a damper with a coil spring on the outside of the shin
  // that soaks up landings. Ball: a plain pin. Each drum's outer face carries an orange power core (Leg_Conduits).
  const hipDrum = cyl([0.3, HIP[1], HIP[2]], [0.66, HIP[1], HIP[2]], 0.17, 0.17, 10, 0.03);
  const kneePiston = mid(
    cyl(onThigh(0.12, scale(thighFront, 0.24)), onThigh(0.5, scale(thighFront, 0.235)), 0.05, 0.05, 8, 0.012),
    cyl(onThigh(0.45, scale(thighFront, 0.235)), onThigh(0.86, scale(thighFront, 0.2)), 0.026, 0.026, 6),
  );
  const strutOut = (t: number) => add([0.13 - t * 0.03, 0, 0], scale(shinBack, 0.04));
  const hockStrut = merge(
    mid(cyl(onShin(0.14, strutOut(0.14)), onShin(0.46, strutOut(0.46)), 0.05, 0.05, 8, 0.012)), // damper body
    mid(cyl(onShin(0.4, strutOut(0.4)), onShin(0.88, strutOut(0.88)), 0.026, 0.026, 6)), // rod into the hock
    near(...[0.54, 0.65, 0.76].map((t) => cyl(onShin(t - 0.02, strutOut(t)), onShin(t + 0.02, strutOut(t)), 0.07, 0.07, 8))), // the coil
    // Lugs that hold the strut to the shin at both ends.
    near(bar(onShin(0.16, [0.07, 0, 0]), onShin(0.16, strutOut(0.16)), shinDir, [0.05, 0.07], [0.05, 0.07], 0), bar(onShin(0.86, [0.06, 0, 0]), onShin(0.86, strutOut(0.86)), shinDir, [0.05, 0.06], [0.05, 0.06], 0)),
  );
  // Three talons forward and a spur back, each tipped with a hooked claw that bites the ground.
  const talon = (tip: V3, start: V3, claw: V3) => merge(
    bar(start, tip, X, [0.13, 0.12], [0.1, 0.085], 0.02),
    mid(bar(tip, claw, X, [0.085, 0.075], [0.03, 0.025], 0)),
  );
  const feet = merge(
    talon([0.42, 0.06, -0.6], [0.42, 0.1, -0.16], [0.42, 0.012, -0.73]),
    talon([0.6, 0.06, -0.49], [0.45, 0.1, -0.17], [0.66, 0.012, -0.6]),
    talon([0.24, 0.06, -0.49], [0.39, 0.1, -0.17], [0.18, 0.012, -0.6]),
    talon([0.42, 0.065, 0.15], [0.42, 0.1, -0.08], [0.42, 0.012, 0.27]),
  );
  // Toe knuckles part way down each forward talon, so the toes read as jointed fingers that close on the ground.
  const knuckle = (start: V3, tip: V3) => {
    const at = lerp(start, tip, 0.45), side = norm(cross(norm(sub(tip, start)), Y));
    return cyl(sub(at, scale(side, 0.075)), add(at, scale(side, 0.075)), 0.075, 0.075, 8);
  };
  const knuckles = near(
    knuckle([0.42, 0.1, -0.16], [0.42, 0.06, -0.6]), knuckle([0.45, 0.1, -0.17], [0.6, 0.06, -0.49]), knuckle([0.39, 0.1, -0.17], [0.24, 0.06, -0.49]),
  );
  // Exposed muscle. Two tendons down the back of the thigh pull it back from the hip, two along the top of the shin
  // store a landing's energy and snap the hock straight, and a ram on the back of the foot pulls the spur claw down
  // to grip. Each stays on its own bone, so the walk never stretches one across a joint.
  const thighTendons = near(tendons(onThigh(0.1, scale(thighBack, 0.215)), onThigh(0.8, scale(thighBack, 0.17)), X, 0.18, 0.024, 0.26));
  const shinTendons = mid(tendons(onShin(0.12, scale(shinBack, 0.135)), onShin(0.84, scale(shinBack, 0.105)), X, 0.09, 0.022, 0.16));
  const footBack = scale(footTop, -1);
  const spurRam = mid(ram(onFoot(0.12, scale(footBack, 0.11)), onFoot(0.64, scale(footBack, 0.095)), 0.04));
  const legFrameR = merge(
    hipDrum, thighPlateBolts, knuckles, thighTendons, shinTendons, spurRam,
    cyl([0.28, KNEE[1], KNEE[2]], [0.56, KNEE[1], KNEE[2]], 0.12, 0.12, 10, 0.025),
    // The hock and ball pins sit inside the shell's outline, so far off they are left out.
    mid(cyl([0.31, HOCK[1], HOCK[2]], [0.53, HOCK[1], HOCK[2]], 0.11, 0.11, 10, 0.02)),
    mid(cyl([0.33, BALL[1], BALL[2]], [0.51, BALL[1], BALL[2]], 0.09, 0.09, 8, 0.015)),
    kneePiston, hockStrut, feet,
  );
  // Orange power cores in the joint drums, fed by a line down the back of the thigh from the hip to the knee.
  const legConduitsR = merge(
    cyl([0.65, HIP[1], HIP[2]], [0.685, HIP[1], HIP[2]], 0.075, 0.075, 10),
    cyl([0.55, KNEE[1], KNEE[2]], [0.585, KNEE[1], KNEE[2]], 0.058, 0.058, 10),
    mid(cyl([0.52, HOCK[1], HOCK[2]], [0.55, HOCK[1], HOCK[2]], 0.05, 0.05, 8)),
    mid(bar(onThigh(0.15, scale(thighBack, 0.2)), onThigh(0.85, scale(thighBack, 0.145)), X, [0.05, 0.03], [0.05, 0.03], 0)),
  );

  // ---- Torso: a bird's chest that widens up from the thin waist, with a keel in front, in two shells with a seam
  // between them where the dark frame shows. The waist, pelvis and neck are the bare skeleton.
  const chestRing = (y: number, z: number, w: number, d: number) => ring([0, y, z], X, Z, w, d, 0.14);
  // The chest leans forward over the hips like a running bird's.
  const chestLower = loft([chestRing(2.3, 0.04, 0.5, 0.44), chestRing(2.6, -0.05, 0.94, 0.78)]);
  // Up close the upper chest is two shells, the top one a step in, with a second seam where the frame shows: the
  // breastplate and the collar armour come off separately. Far off it is one shell, as the seam would be a slit of sky.
  const chestUpper = lod === 2
    ? loft([chestRing(2.66, -0.08, 1.02, 0.82), chestRing(2.96, -0.12, 1.12, 0.8), chestRing(3.18, -0.08, 0.8, 0.56)])
    : merge(
      loft([chestRing(2.66, -0.08, 1.02, 0.82), chestRing(2.935, -0.116, 1.11, 0.8)]),
      loft([chestRing(2.985, -0.115, 1.08, 0.77), chestRing(3.18, -0.08, 0.8, 0.56)]),
    );
  const chestCore = mid(loft([chestRing(2.48, -0.03, 0.8, 0.66), chestRing(2.8, -0.08, 0.98, 0.74), chestRing(3.0, -0.12, 1.0, 0.7)]));
  // Air intakes either side of the keel, under the breastplate, that cool the power core: a dark mouth crossed by
  // two white louvres, tipped back to lie on the sloping lower chest.
  const intakeAt: V3 = [0.19, 2.47, -0.335];
  const intakeR = turn(merge(
    block(intakeAt, [0.15, 0.2, 0.07], 0.015),
  ), [-0.714, 0, 0], intakeAt);
  const louvresR = near(turn(merge(
    ...[-0.045, 0.035].map((dy) => block(add(intakeAt, [0, dy, -0.04]), [0.17, 0.045, 0.03], 0)),
  ), [-0.714, 0, 0], intakeAt));
  // Rams from the front of the pelvis up into the chest: with the struts behind the spine they hold the chest's
  // lean, and they show the waist is a machine, not a wasp's.
  const waistRam = (x: number) => mid(ram([x, 1.84, -0.13], [x * 0.85, 2.32, -0.09], 0.04, 0.5));
  // Collar plates either side of the neck, so the chest top is not a flat lid. The right one is white, the left blue.
  const collarR = turn(block([0.28, 3.19, -0.1], [0.3, 0.1, 0.46], 0.03), [0, 0, -0.25], [0.28, 3.19, -0.1]);
  // The keel: a prow of armour down the breastbone, the chest's sharpest edge.
  const keelOutline: [number, number][] = [[-0.42, 3.02], [-0.24, 2.4], [-0.6, 2.56], [-0.69, 2.88]];
  const keel = slab([0, 0, 0], Z, Y, keelOutline, 0.16, 0.025);
  // Right chest plate, left flank plate: the big blue camo blocks on the front and side. No bolts on them: two dots
  // on a small plate read as a face.
  const chestPlateAt: V3 = [0.29, 2.86, -0.51];
  const chestPlate = turn(block(chestPlateAt, [0.3, 0.26, 0.07], 0.022), [0.2, 0, 0], chestPlateAt);
  const flankAt: V3 = [-0.565, 2.82, -0.1];
  const flankPlate = turn(block(flankAt, [0.07, 0.26, 0.42], 0.022), [0, 0, -0.16], flankAt);
  // Armour over the pelvis actuator, hung from the belt.
  const hipGuard = bar([0, 1.87, -0.25], [0, 1.6, -0.28], X, [0.3, 0.08], [0.22, 0.07], 0.025);
  // Two struts behind the spine hold the chest upright against recoil and hard landings.
  const waistStrut = (x: number) => near(
    cyl([x, 1.84, 0.27], [x, 2.06, 0.27], 0.042, 0.042, 8, 0.01),
    cyl([x, 2.02, 0.27], [x, 2.34, 0.22], 0.022, 0.022, 6),
  );
  const torsoFrame = merge(
    block([0, 1.72, 0.02], [0.62, 0.26, 0.44], 0.05), // pelvis
    cyl([0, 1.82, 0.04], [0, 2.36, 0.04], 0.13, 0.13, 10), // the spine
    mid(cyl([0, 1.95, 0.04], [0, 2.01, 0.04], 0.2, 0.2, 10), cyl([0, 2.11, 0.04], [0, 2.17, 0.04], 0.2, 0.2, 10)), // ribs
    cyl([0, 3.12, -0.02], [0, 3.38, -0.02], 0.1, 0.1, 8), // neck
    mid(cyl([0, 3.17, -0.02], [0, 3.23, -0.02], 0.15, 0.15, 10)), // the neck's turning ring
    chestCore, waistStrut(0.13), waistStrut(-0.13), waistRam(0.2), waistRam(-0.2),
    mid(intakeR), mid(mirrorX(intakeR)),
  );

  // ---- Head: a raptor's skull, deepest just behind the eyes and running forward to a low beak. A chin plate under
  // it, one big fin sweeping up and back off the crown, and the visor a thin band round the front a little wider
  // than the skull.
  const headRing = (z: number, y: number, w: number, h: number) => ring([0, y, z], X, Y, w, h, 0.06);
  const head = merge(
    loft([headRing(0.14, 3.45, 0.26, 0.22), headRing(-0.08, 3.48, 0.4, 0.32), headRing(-0.4, 3.44, 0.3, 0.22), headRing(-0.8, 3.37, 0.08, 0.07)]),
    bar([0, 3.31, -0.02], [0, 3.34, -0.56], X, [0.26, 0.08], [0.12, 0.06], 0.02), // chin plate
  );
  const visor = loft([ring([0, 3.5, -0.06], X, Y, 0.43, 0.075, 0.015), ring([0, 3.455, -0.54], X, Y, 0.25, 0.065, 0.015)]);
  const fin = slab([0, 0, 0], Z, Y, [[-0.32, 3.6], [0.9, 4.2], [0.96, 4.13], [0.14, 3.52]], 0.09, 0.025);
  // A sensor pod on each cheek behind the visor, looking sideways for flankers: a dark housing with a hood over a
  // round green lens. The fin sits in a clamp along the crown, so it reads as bolted on, not grown.
  const podR = mid(
    cyl([0.14, 3.46, 0.05], [0.235, 3.46, 0.05], 0.085, 0.085, 10, 0.015),
    near(block([0.2, 3.545, 0.04], [0.12, 0.03, 0.2], 0)),
  );
  const lensR = mid(cyl([0.235, 3.46, 0.05], [0.25, 3.46, 0.05], 0.05, 0.05, 10));
  const finClamp = near(block([0, 3.625, 0.0], [0.15, 0.08, 0.28], 0.02));

  // ---- Jump pack: a white housing between the shoulders with an air intake on top, blue camo plates, two big
  // stabilizer fins canted out above the shoulders, and two flared nozzles under it on gimbals.
  const pack = merge(
    block([0, 2.8, 0.56], [0.7, 0.8, 0.42], 0.07),
    mid(block([0, 3.24, 0.5], [0.44, 0.1, 0.3], 0.03)), // intake hump
    near(...[0.44, 0.5, 0.56].map((z) => block([0, 3.305, z], [0.36, 0.03, 0.03], 0))), // the intake's slats
  );
  const finPivot: V3 = [0.28, 3.04, 0.56];
  const packFinR = turn(slab([0.28, 0, 0], Z, Y, [[0.34, 3.04], [0.82, 3.04], [1.34, 4.1], [1.2, 4.17]], 0.09, 0.025), [0, 0, -0.38], finPivot);
  // The fin's root block, where it is clamped to the pack.
  const finRootR = turn(block([0.28, 3.08, 0.6], [0.16, 0.12, 0.42], 0.02), [0, 0, -0.38], finPivot);
  // A ram from the pack's top to each fin's inner face cants the fin to steer a jump.
  const finRamR = mid(ram([0.12, 3.2, 0.84], [0.4, 3.49, 0.85], 0.035, 0.5));
  // The fuel line down the pack's bare left side, from the tank to the nozzle bar, held by two clamps.
  const fuelLine = near(
    cyl([-0.375, 3.02, 0.68], [-0.375, 2.6, 0.7], 0.03, 0.03, 6),
    cyl([-0.375, 2.6, 0.7], [-0.27, 2.47, 0.72], 0.03, 0.03, 6),
    ...[2.92, 2.7].map((y) => block([-0.37, y, 0.69], [0.05, 0.05, 0.09], 0)),
  );
  // A hatch over the fuel cell on the pack's back, opposite the blue plate, with a dark grip to pull it by.
  const hatch = near(block([0.15, 2.92, 0.79], [0.24, 0.26, 0.04], 0.015));
  const hatchGrip = near(block([0.15, 2.84, 0.82], [0.12, 0.035, 0.03], 0));
  const packCamo = merge(
    packFinR, mirrorX(packFinR),
    block([0.36, 2.76, 0.56], [0.06, 0.52, 0.32], 0.015), // right side panel
    block([-0.16, 2.96, 0.78], [0.28, 0.3, 0.06], 0.015), // back plate, upper left
  );
  // Nozzles flare wider at the exhaust, which is the bottom of the cone; a collar holds each to its gimbal.
  const nozzleTilt: V3 = [-0.3, 0, 0.2], nozzleTop: V3 = [0.22, 2.46, 0.66];
  // Inside the bell's mouth a cone (the centre body that shapes the exhaust) hangs over a glowing throat, and two
  // vanes across the flow tip the thrust fore and aft: the vector in vector thrust. A band stiffens the bell.
  const nozzleR = turn(merge(
    cyl([0.22, 2.46, 0.66], [0.22, 2.04, 0.66], 0.13, 0.21, 10, 0.02),
    mid(cyl([0.22, 2.53, 0.66], [0.22, 2.43, 0.66], 0.165, 0.165, 10)),
    near(cyl([0.22, 2.24, 0.66], [0.22, 2.18, 0.66], 0.2, 0.2, 10)),
    mid(cyl([0.22, 2.03, 0.66], [0.22, 1.86, 0.66], 0.09, 0.025, 10)),
    mid(...[0.12, 0.32].map((x) => slab([x, 0, 0], Z, Y, [[0.5, 2.04], [0.82, 2.04], [0.78, 1.93], [0.54, 1.93]], 0.035, 0.012))),
  ), nozzleTilt, nozzleTop);
  const throatR = turn(cyl([0.22, 2.045, 0.66], [0.22, 2.025, 0.66], 0.155, 0.155, 12), nozzleTilt, nozzleTop);
  const jets = merge(
    nozzleR, mirrorX(nozzleR),
    block([0, 2.48, 0.66], [0.52, 0.14, 0.26], 0.03), // the bar that carries both nozzles
    // Gimbal rams that steer each nozzle: the vector in vector thrust.
    near(cyl([0.36, 2.5, 0.6], [0.36, 2.3, 0.74], 0.028, 0.028, 6), cyl([-0.36, 2.5, 0.6], [-0.36, 2.3, 0.74], 0.028, 0.028, 6)),
    // A louvred vent on the pack's back, where the fuel pump sheds its heat.
    mid(block([0.14, 2.62, 0.77], [0.28, 0.14, 0.04], 0.01)),
    near(...[2.585, 2.62, 2.655].map((y) => block([0.14, y, 0.795], [0.26, 0.02, 0.025], 0))),
    near(block([0, 3.29, 0.5], [0.34, 0.02, 0.2], 0)), // the dark intake mouth under the slats
    bolts([[0.27, 3.12, 0.77], [-0.27, 3.12, 0.77], [0.27, 2.48, 0.77], [-0.27, 2.48, 0.77]], Z, 0.035), // back cover
    finRamR, mirrorX(finRamR), fuelLine, hatchGrip,
  );

  // ---- Arms. Right: a slim arm with the blade emitter on the wrist. Left: the same shoulder with a burst carbine
  // in the lower forearm. Camo alternates: blue right shoulder and left forearm guard, white the other two.
  const upperDir = norm(sub(ELBOW_R, SHOULDER_R));
  const upperOut = perp(upperDir, X), upperFront = perp(upperDir, [0, 0, -1]);
  const onUpper = (t: number, out: V3 = [0, 0, 0]) => add(lerp(SHOULDER_R, ELBOW_R, t), out);
  const pauldronPivot: V3 = [0.8, 3.0, 0.02];
  const pauldronR = turn(merge(
    block([0.97, 3.02, 0.06], [0.38, 0.2, 0.62], 0.05),
    block([1.16, 2.86, 0.06], [0.07, 0.24, 0.52], 0.022), // the lip that hangs over the arm's top
  ), [0, 0, -0.32], pauldronPivot);
  const pauldronBoltsR = turn(bolts([[0.9, 3.12, -0.12], [0.9, 3.12, 0.24]], Y, 0.035), [0, 0, -0.32], pauldronPivot);
  // The hinge plate the pauldron rides on, a dark layer showing at its front and back edges: the armour lifts on it
  // as the arm rises.
  const pauldronHingeR = near(turn(block([0.96, 2.92, 0.06], [0.3, 0.06, 0.72], 0.02), [0, 0, -0.32], pauldronPivot));
  const upperArmR = merge(
    bar(SHOULDER_R, ELBOW_R, Z, [0.22, 0.24], [0.17, 0.19], 0.03),
    mid(bar(onUpper(0.2, scale(upperOut, 0.1)), onUpper(0.75, scale(upperOut, 0.085)), upperOut, [0.05, 0.17], [0.05, 0.14], 0.015)), // outer plate
  );
  const armR = merge(
    upperArmR,
    bar(ELBOW_R, WRIST_R, X, [0.24, 0.26], [0.2, 0.2], 0.03),
    bar([1.285, 2.44, -0.08], [1.32, 2.44, -0.62], X, [0.07, 0.24], [0.07, 0.2], 0.022), // outer forearm guard
  );
  const armL = merge(mirrorX(upperArmR), bar(ELBOW_L, WRIST_L, X, [0.24, 0.26], [0.2, 0.2], 0.03), mirrorX(pauldronR));
  const armCamo = merge(pauldronR, bar([-1.285, 2.4, -0.02], [-1.3, 2.38, -0.4], X, [0.07, 0.22], [0.07, 0.2], 0.022));
  // The elbow piston, from the front of the upper arm to a lug on the forearm: it bends the elbow.
  const elbowPistonR = near(
    cyl(onUpper(0.18, scale(upperFront, 0.12)), onUpper(0.62, scale(upperFront, 0.115)), 0.042, 0.042, 8, 0.01),
    cyl(onUpper(0.55, scale(upperFront, 0.115)), add(lerp(ELBOW_R, WRIST_R, 0.24), [0, 0.13, 0]), 0.022, 0.022, 6),
  );
  const armFrameR = merge(
    cyl([0.64, SHOULDER_R[1], SHOULDER_R[2]], [0.9, SHOULDER_R[1], SHOULDER_R[2]], 0.16, 0.16, 10, 0.025),
    cyl([ELBOW_R[0] - 0.13, ELBOW_R[1], ELBOW_R[2]], [ELBOW_R[0] + 0.13, ELBOW_R[1], ELBOW_R[2]], 0.115, 0.115, 10, 0.02),
    elbowPistonR, pauldronBoltsR, pauldronHingeR,
  );
  // A ram along the inside of each forearm, from the elbow to the wrist, that turns the wrist so the weapon can
  // sweep. The left forearm ends higher and shorter, so its ram follows it.
  const wristRams = near(
    ram([0.99, 2.53, -0.08], [1.08, 2.52, -0.6], 0.035),
    ram([-0.99, 2.53, -0.04], [-1.06, 2.46, -0.38], 0.035),
  );
  const armFrame = merge(armFrameR, mirrorX(armFrameR), wristRams, cyl([WRIST_L[0] - 0.1, ...WRIST_L.slice(1)] as V3, [WRIST_L[0] + 0.1, ...WRIST_L.slice(1)] as V3, 0.09, 0.09, 10, 0.015));
  // Power to the weapons: a core in each elbow drum, fed by a line down the back of the upper arm.
  const armConduitsR = merge(
    cyl([ELBOW_R[0] + 0.125, ELBOW_R[1], ELBOW_R[2]], [ELBOW_R[0] + 0.155, ELBOW_R[1], ELBOW_R[2]], 0.06, 0.06, 10),
    mid(bar(onUpper(0.2, scale(upperFront, -0.12)), onUpper(0.8, scale(upperFront, -0.095)), upperOut, [0.045, 0.03], [0.045, 0.03], 0)),
  );
  // On from the elbow under each forearm, into the blade emitter on the right and the carbine's cell on the left.
  const forearmConduits = near(
    bar([1.13, 2.275, -0.02], [1.19, 2.285, -0.66], X, [0.05, 0.03], [0.05, 0.03], 0),
    bar([-1.13, 2.275, -0.02], [-1.17, 2.29, -0.2], X, [0.05, 0.03], [0.05, 0.03], 0),
  );
  const emitter = merge(
    block([1.2, 2.42, -0.8], [0.26, 0.3, 0.24], 0.035),
    cyl([1.2, 2.42, -0.9], [1.2, 2.42, -1.0], 0.085, 0.085, 10, 0.012), // the nozzle the blade comes out of
    mid(cyl([1.2, 2.42, -0.66], [1.2, 2.42, -0.7], 0.135, 0.135, 10)), // collar clamping it to the wrist
    // Heat sinks on top that shed the blade's heat.
    near(...[-0.73, -0.8, -0.87].map((z) => block([1.2, 2.6, z], [0.22, 0.07, 0.04], 0))),
    // Two guide prongs above and below the blade's root that hold its field in shape.
    mid(bar([1.2, 2.56, -0.88], [1.2, 2.545, -1.13], X, [0.07, 0.05], [0.05, 0.04], 0.015)),
    mid(bar([1.2, 2.285, -0.88], [1.2, 2.31, -1.08], X, [0.07, 0.05], [0.05, 0.04], 0.015)),
  );
  // The blade: a flat tapered plate held straight forward, longer than the forearm, its tip region round Mount_Gun.
  const blade = slab([1.2, 0, 0], Z, Y, [[-0.98, 2.5], [-0.98, 2.34], [-1.36, 2.37], [-1.86, 2.44], [-1.46, 2.52]], 0.08, 0.02);
  const carbine = merge(
    block([-1.2, 2.17, -0.52], [0.22, 0.26, 0.68], 0.04), // receiver, clamped under the forearm
    block([-1.2, 1.97, -0.42], [0.15, 0.2, 0.2], 0.025), // magazine
    mid(block([-1.2, 2.34, -0.66], [0.1, 0.08, 0.26], 0)), // sight
    cyl([-1.2, 2.2, -0.84], [-1.2, 2.2, -1.07], 0.055, 0.055, 8), // barrel
    cyl([-1.2, 2.2, -1.06], [-1.2, 2.2, -1.2], 0.085, 0.085, 8, 0.015), // muzzle shroud
    // Cooling rings that shed the barrel's heat between bursts, and fins on the receiver's top for the emitter in it.
    near(...[-0.9, -0.95, -1.0].map((z) => cyl([-1.2, 2.2, z - 0.015], [-1.2, 2.2, z + 0.015], 0.075, 0.075, 8))),
    near(...[-0.43, -0.36, -0.29].map((z) => block([-1.2, 2.32, z], [0.16, 0.05, 0.03], 0))),
    // The outer cover over the receiver's works, a layer proud of it.
    mid(block([-1.322, 2.18, -0.52], [0.035, 0.18, 0.5], 0.012)),
  );
  // The laser's lens in the muzzle shroud, and a window on the cell that shows it is charged.
  const carbineGlow = merge(
    cyl([-1.2, 2.2, -1.2], [-1.2, 2.2, -1.215], 0.05, 0.05, 10),
    mid(block([-1.28, 1.98, -0.42], [0.02, 0.1, 0.12], 0)),
  );

  return [
    { name: "Torso", zone: "torso", paint: "white", mesh: merge(chestLower, chestUpper, collarR, hipGuard, louvresR, mirrorX(louvresR)) },
    { name: "Torso_Camo", zone: "torso", paint: "blue", mesh: merge(keel, chestPlate, flankPlate, mirrorX(collarR)) },
    { name: "Frame", zone: "torso", paint: "frame", rusts: false, mesh: merge(torsoFrame, podR, mirrorX(podR), finClamp) },
    { name: "Sensor", zone: "torso", paint: "white", mesh: head },
    { name: "Fin", zone: "torso", paint: "blue", mesh: fin },
    { name: "Visor", zone: "torso", paint: "visorGlow", glow: true, mesh: merge(visor, lensR, mirrorX(lensR)) },
    { name: "Pack", zone: "torso", paint: "white", mesh: merge(pack, finRootR, mirrorX(finRootR), hatch) },
    { name: "Pack_Camo", zone: "torso", paint: "blue", mesh: packCamo },
    { name: "Jets", zone: "torso", paint: "frame", rusts: false, mesh: jets },
    { name: "Jet_Glow", zone: "torso", paint: "conduitGlow", glow: true, mesh: merge(throatR, mirrorX(throatR)) },
    { name: "Leg_L", zone: "legs", paint: "white", mesh: mirrorX(merge(legShellR, thighPlate)) },
    { name: "Leg_R", zone: "legs", paint: "white", mesh: merge(legShellR, kneeCap) },
    { name: "Leg_Camo", zone: "legs", paint: "blue", mesh: merge(thighPlate, shinPlate, mirrorX(kneeCap), mirrorX(footGuard)) },
    { name: "Leg_Frame", zone: "legs", paint: "frame", rusts: false, mesh: merge(legFrameR, mirrorX(legFrameR)) },
    { name: "Leg_Conduits", zone: "legs", paint: "conduitGlow", glow: true, mesh: merge(legConduitsR, mirrorX(legConduitsR)) },
    { name: "Thigh_Band", zone: "legs", paint: "accent", mesh: mirrorX(thighBand) },
    { name: "Arm_L", zone: "arms", paint: "white", mesh: armL },
    { name: "Arm_R", zone: "arms", paint: "white", mesh: armR },
    { name: "Arm_Camo", zone: "arms", paint: "blue", noHit: true, mesh: armCamo },
    { name: "Arm_Frame", zone: "arms", paint: "frame", rusts: false, noHit: true, mesh: armFrame },
    { name: "Arm_Conduits", zone: "arms", paint: "conduitGlow", glow: true, noHit: true, mesh: merge(armConduitsR, mirrorX(armConduitsR), forearmConduits) },
    { name: "Emitter", zone: "arms", paint: "frame", rusts: false, mesh: emitter },
    { name: "Blade", zone: "arms", paint: "bladeGlow", glow: true, mesh: blade },
    { name: "Carbine", zone: "arms", paint: "weapon", mesh: carbine },
    // `noHit`: it lies inside the carbine's own box.
    { name: "Carbine_Glow", zone: "arms", paint: "bladeGlow", glow: true, noHit: true, mesh: carbineGlow },
  ];
}
const scheme = { white: "#E8EAEE", blue: "#2F6FD0", frame: "#22303F", visorGlow: "#5CFF7A", conduitGlow: "#FF8A1F", bladeGlow: "#4FC3FF" };

const markers: NodeData[] = [
  // The carbine under the left forearm is the gun: shots leave its muzzle shroud.
  { name: "Mount_Gun", translation: [-1.2, 2.2, -1.2] },
  { name: "Torso_Fx", translation: [0.3, 2.9, -0.42] },
  { name: "Arm_R_Fx", translation: ELBOW_R },
  { name: "Leg_L_Fx", translation: mirrorPoint(KNEE) },
  // The two-bone chain ends at the hock; the long bird foot from hock to ball stays as it is.
  ...bothLegs(HIP, KNEE, HOCK, BALL),
];

const levels = [build(0), build(1), build(2)] as const;
const parts = levels[0];
// A part gets its _LOD1 and _LOD2 nodes only where they are simpler than the level before (mechKit.ts reads them in
// order and keeps the last one it found).
const lodNodes: NodeData[] = [];
parts.forEach((p, i) => {
  let previous = p.mesh;
  for (const level of [1, 2] as const) {
    const mesh = levels[level][i]!.mesh;
    if (triangles(mesh) === 0 || triangles(mesh) >= triangles(previous)) break;
    lodNodes.push({ name: `${p.name}_LOD${level}`, mesh });
    previous = mesh;
  }
});

const root = new URL("../..", import.meta.url).pathname;
const dir = join(root, "assets/models/mechs/stiletto");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Stiletto.glb"), writeGlb([...parts.map((p) => ({ name: p.name, mesh: p.mesh })), ...lodNodes, ...markers], { quantize: true }));
const kitParts = Object.fromEntries(parts.map(({ name, mesh: _mesh, ...look }) => [name, look]));
writeFileSync(join(root, "scripts/mechs/stiletto.kit.json"), `${JSON.stringify({ scheme, parts: kitParts }, null, 2)}\n`);
const totals = levels.map((l) => l.reduce((s, p) => s + triangles(p.mesh), 0));
console.log(`Wrote Mech_Stiletto.glb to ${dir}: ${totals.join(" / ")} triangles (near / middle / far), ${totals[0]! + lodNodes.reduce((s, n) => s + triangles(n.mesh!), 0)} in the file`);
parts.forEach((p, i) => console.log(`  ${p.name.padEnd(13)} ${p.zone.padEnd(6)} ${p.paint.padEnd(12)} ${levels.map((l) => String(triangles(l[i]!.mesh)).padStart(5)).join(" ")}`));
