// Builds the Longshot (docs/MECH_ROSTER.md, section 5), the marksman: tall and thin on long straight legs whose knees
// bend forward like a person's (the Stiletto and the Arbiter stand on bird legs, the Ironclad's knees bend back), a
// narrow armoured chest, a rangefinder head whose crossbar puts a lens at each end, and a rail rifle nearly as long as
// the mech is tall, held at the right of the chest and steadied by the left hand. A capacitor pack on the back feeds
// the rifle and a ballast block under it balances the barrel; spades behind the heels dig in when it braces for Rail
// Shot. Slate violet with a bone breastplate and bone splinter plates, red lenses: the scope glows the colour of the
// laser it throws. No other mech wears violet, and it stands out against moss and rust.
// Every part is built in place on the assembled mech (metres, Y up, facing -Z, right side +X).
// Writes the model and scripts/mechs/longshot.kit.json, the paint and zone of every part.
// Run: npx tsx scripts/mechs/longshot.ts  →  assets/models/mechs/longshot/Mech_Longshot.glb
//
// Levels of detail: the same build runs three times. The nearest keeps bevels, bolts, pistons and seams; the middle
// (past 25 m, data/mechKits.json lodDistances) drops the small parts and the bevels; the far one (past 80 m) keeps
// only what makes the silhouette: the long legs, the chest, the head's crossbar, the pack and the rifle.
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
  const bolts = (points: V3[], normal: V3, r = 0.035) =>
    near(...points.map((p) => cyl(sub(p, scale(normal, 0.015)), add(p, scale(normal, 0.03)), r, r, 6)));

  // A hydraulic ram from `a` to `b`: a fat cylinder most of the way, a thin rod out of it. `at` is where the rod
  // leaves the cylinder, as a share of the length.
  const ram = (a: V3, b: V3, r: number, at = 0.55) =>
    merge(cyl(a, lerp(a, b, at + 0.05), r, r, 8, r * 0.25), cyl(lerp(a, b, at), b, r * 0.5, r * 0.5, 6));

  // A cable through a run of points, one rod per stretch, so it bends where it is clipped down.
  const cable = (points: V3[], r: number) => merge(...points.slice(1).map((p, i) => cyl(points[i]!, p, r, r, 6)));

  return { lod, near, mid, run, bar, cyl, slab, block, bolts, ram, cable };
}

// Leg joints (scripts/mechs/joints.ts), right side. A long straight leg: the knee a little ahead of the line from hip
// to ankle, so it bends forward as a person's does, and a high ankle over a long flat foot. The ankle sits high and
// the foot runs well forward of it, so the heel spade behind it still lies nearer the foot's bone than the shin's,
// and turns with the foot when the leg rig cuts the legs (packages/client/src/legRig.ts).
const LX = 0.34;
const HIP: V3 = [LX, 2.02, 0.04], KNEE: V3 = [LX, 1.12, -0.15], ANKLE: V3 = [LX, 0.38, 0.06], TOE: V3 = [LX, 0.05, -0.5];
const SHOULDER_R: V3 = [0.6, 3.1, 0.02], ELBOW_R: V3 = [0.76, 2.48, 0.22], WRIST_R: V3 = [0.84, 2.45, -0.3];
const SHOULDER_L = mirrorPoint(SHOULDER_R), ELBOW_L: V3 = [-0.4, 2.5, -0.5], WRIST_L: V3 = [0.56, 2.47, -0.98];
// The rifle's bore: a line along -Z at this height, right of the chest. Everything on the rifle is placed from it.
const RX = 0.88, RY = 2.64;
const MUZZLE: V3 = [RX, RY, -3.2];
// The serial number's plate on the right of the chest (data/mechKits.json serials: "05" there, from the front). Its
// face stays flat and clear of bolts over the whole number.
const SERIAL_AT: V3 = [0.19, 2.86, -0.325];

type Zone = "legs" | "arms" | "torso";
// `noHit`: lies inside another part's box, or would stretch one box across the body.
interface Part { name: string; zone: Zone; paint: string; glow?: true; rusts?: false; noHit?: true; mesh: MeshData }

function build(lod: Lod): Part[] {
  const { near, mid, run, bar, cyl, slab, block, bolts, ram, cable } = makers(lod);

  // ---- Legs. Built on the right, then mirrored. Camo alternates side to side: a bone thigh plate on the right, a
  // bone shin guard on the left, so the two legs never read as copies.
  const thighDir = norm(sub(KNEE, HIP)), shinDir = norm(sub(ANKLE, KNEE)), footDir = norm(sub(TOE, ANKLE));
  const thighFront = perp(thighDir, [0, 0, -1]), thighBack = scale(thighFront, -1);
  const shinFront = perp(shinDir, [0, 0, -1]), shinBack = scale(shinFront, -1);
  const footTop = perp(footDir, Y);
  const onThigh = (t: number, out: V3 = [0, 0, 0]) => add(lerp(HIP, KNEE, t), out);
  const onShin = (t: number, out: V3 = [0, 0, 0]) => add(lerp(KNEE, ANKLE, t), out);
  const onFoot = (t: number, out: V3 = [0, 0, 0]) => add(lerp(ANKLE, TOE, t), out);

  // The shell: a long thigh that is deepest a third of the way down where the hip's drive rods end, a long shin with a
  // calf behind it, an ankle housing that carries the foot.
  const legShellR = merge(
    run([[add(HIP, [0, 0.06, 0]), [0.24, 0.3]], [onThigh(0.32), [0.26, 0.34]], [KNEE, [0.19, 0.22]]], X, 0.035, 0.05),
    run([[KNEE, [0.19, 0.21]], [onShin(0.3), [0.21, 0.27]], [ANKLE, [0.14, 0.15]]], X, 0.03, 0.04),
    // The ankle housing, over the joint and on down onto the back of the foot.
    run([[add(ANKLE, [0, 0.06, 0.02]), [0.2, 0.2]], [onFoot(0.28, scale(footTop, 0.02)), [0.18, 0.13]]], X, 0.03),
  );
  // A knee cap hung off the bottom of the thigh over the front of the knee: what takes the hit when it kneels.
  const kneeCap = bar(add(KNEE, [0, 0.16, -0.13]), add(KNEE, [0, -0.13, -0.17]), X, [0.22, 0.11], [0.18, 0.09], 0.03);
  // Armour over the front of the thigh, and its twin over the shin: the leg's face, the side shots come from.
  const thighPlate = bar(onThigh(0.1, scale(thighFront, 0.16)), onThigh(0.8, scale(thighFront, 0.125)), X, [0.22, 0.06], [0.18, 0.06], 0.022);
  const shinGuard = bar(onShin(0.12, scale(shinFront, 0.13)), onShin(0.8, scale(shinFront, 0.095)), X, [0.2, 0.06], [0.15, 0.06], 0.02);
  // A plate on the outside of the thigh over the hip actuator's drive rods, and a second one lapped onto the shin.
  const outerPlates = mid(
    bar(onThigh(0.18, [0.135, 0, 0]), onThigh(0.66, [0.125, 0, 0]), X, [0.05, 0.24], [0.05, 0.2], 0.018),
    bar(onShin(0.18, [0.112, 0, 0]), onShin(0.58, [0.104, 0, 0]), X, [0.04, 0.17], [0.04, 0.14], 0.015),
  );
  // The foot: a long flat sole split into two toes at the front, so it grips on rock.
  const foot = merge(
    run([[add(ANKLE, [0, -0.25, 0.1]), [0.26, 0.13]], [add(TOE, [0, 0.03, 0.14]), [0.26, 0.1]]], X, 0.03),
    ...[-0.068, 0.068].map((dx) => mid(bar(add(TOE, [dx, 0.03, 0.18]), add(TOE, [dx, 0.02, -0.02]), X, [0.115, 0.1], [0.1, 0.07], 0.02))),
  );
  const hipDrum = cyl([0.2, HIP[1], HIP[2]], [0.5, HIP[1], HIP[2]], 0.15, 0.15, 10, 0.03);
  // Drives: a piston on the front of the thigh straightens the knee, a ram down the back of the shin (the calf)
  // works the ankle. Each stays on its own bone, so the walk never stretches one across a joint.
  const kneePiston = mid(ram(onThigh(0.14, scale(thighFront, 0.235)), onThigh(0.84, scale(thighFront, 0.2)), 0.045, 0.5));
  const calfRam = mid(ram(onShin(0.14, scale(shinBack, 0.16)), onShin(0.86, scale(shinBack, 0.1)), 0.045, 0.5));
  // The heel spade, the stabiliser that plants it for Rail Shot: a plate on a hinge behind the heel, angled down so
  // its edge bites into the ground when the mech leans back into the recoil. A short ram off the foot holds it.
  const spade = slab([LX, 0, 0], Z, Y, [[0.05, 0.16], [0.24, 0.02], [0.29, 0.0], [0.3, 0.06], [0.14, 0.2]], 0.2, 0.02);
  const spadeHinge = cyl([LX - 0.1, 0.17, 0.08], [LX + 0.1, 0.17, 0.08], 0.05, 0.05, 8);
  const spadeRam = near(ram(onFoot(0.15, add(scale(footTop, 0.1), [0.0, 0, 0])), [LX, 0.13, 0.22], 0.03, 0.5));
  // Under the sole a dark rubber pad a little wider than the foot, so the foot shows a rim at ground level.
  const sole = block(add(lerp(add(ANKLE, [0, -0.36, 0.06]), add(TOE, [0, -0.03, 0.06]), 0.5), [0, 0, 0]), [0.28, 0.04, 0.7], 0.012);
  // Bolts hold the thigh plate under the hip drum and the shin guard below the knee, clear of their middles.
  const plateBolts = merge(
    ...[0.07, -0.07].map((s) => bolts([add(onThigh(0.17, scale(thighFront, 0.195)), [s, 0, 0])], thighFront)),
    ...[0.06, -0.06].map((s) => bolts([add(onShin(0.2, scale(shinFront, 0.165)), [s, 0, 0])], shinFront)),
  );
  // Power to the knee and ankle motors, out of the hip drum and down the back of the thigh.
  const legCable = near(cable([add(HIP, [0.04, -0.05, 0.16]), onThigh(0.45, add(scale(thighBack, 0.16), [0.05, 0, 0])), onThigh(0.9, add(scale(thighBack, 0.12), [0.05, 0, 0]))], 0.02));
  // The hip actuator's two drive rods, from the drum down the outside of the thigh to where the shell is deepest.
  const driveRods = near(...[0.06, -0.06].map((s) => cyl(add(HIP, [0.17, -0.1, s]), onThigh(0.42, add([0.165, 0, 0], scale(thighFront, s))), 0.022, 0.022, 6)));
  // Teeth along the spade's bottom edge, the part that actually bites.
  const spadeTeeth = near(...[-0.06, 0, 0.06].map((dx) => turn(block([LX + dx, 0.035, 0.27], [0.04, 0.05, 0.07], 0), [0.6, 0, 0], [LX + dx, 0.035, 0.27])));
  // Two bolts hold the knee cap to the bottom of the thigh.
  const kneeBolts = bolts([add(KNEE, [0.06, 0.12, -0.19]), add(KNEE, [-0.06, 0.12, -0.19])], [0, 0.2, -1], 0.03);
  // The hinge pin each toe rocks on, so the foot can roll over rock.
  const toePins = near(cyl(add(TOE, [-0.14, 0.05, 0.17]), add(TOE, [0.14, 0.05, 0.17]), 0.04, 0.04, 8));
  const legFrameR = merge(
    hipDrum, driveRods, spadeTeeth, kneeBolts, toePins, kneePiston, calfRam, spadeHinge, spadeRam, plateBolts, legCable, sole,
    cyl([0.22, KNEE[1], KNEE[2]], [0.46, KNEE[1], KNEE[2]], 0.12, 0.12, 10, 0.025),
    mid(cyl([0.25, ANKLE[1], ANKLE[2]], [0.43, ANKLE[1], ANKLE[2]], 0.1, 0.1, 10, 0.02)),
    // The hip motor's end bell and the knee's, the round faces that show from the side.
    near(cyl([0.5, HIP[1], HIP[2]], [0.54, HIP[1], HIP[2]], 0.08, 0.08, 10), cyl([0.46, KNEE[1], KNEE[2]], [0.49, KNEE[1], KNEE[2]], 0.06, 0.06, 8)),
  );

  // ---- Torso: a narrow armoured chest on a bare spine, deepest at the shoulders and tapering down to the waist.
  const chestRing = (y: number, z: number, w: number, d: number, c = 0.1) => ring([0, y, z], X, Z, w, d, c);
  // Up close the chest is two shells with a seam between them where the frame shows; far off it is one.
  // Two shells: a dark lower one and a bone breastplate over the shoulders, with a seam between them where the frame
  // shows up close. Far off the seam would be a slit of sky, so the two meet.
  const seam = lod === 2 ? 0 : 0.02;
  const chestLower = loft([chestRing(2.38, 0.02, 0.44, 0.38), chestRing(2.64, -0.02, 0.7, 0.56), chestRing(2.74 - seam, -0.02, 0.71, 0.565)]);
  const breastplate = loft([chestRing(2.74 + seam, -0.02, 0.71, 0.565), chestRing(3.08, 0.0, 0.74, 0.58), chestRing(3.3, 0.04, 0.5, 0.44)]);
  const chestCore = mid(loft([chestRing(2.5, 0.0, 0.6, 0.5), chestRing(2.9, 0.0, 0.66, 0.52)]));
  // The plate carrying the serial: flat and plain, so the number has a clean face. No bolts on it: four dots round
  // two digits read as a face.
  const serialPlate = block(SERIAL_AT, [0.38, 0.28, 0.06], 0.02);
  // On the left of the chest, an intake that cools the capacitors' charger, crossed by three slats.
  const intakeAt: V3 = [-0.17, 2.86, -0.31];
  const intake = block(intakeAt, [0.26, 0.22, 0.04], 0.012);
  const intakeSlats = near(...[-0.06, 0, 0.06].map((dy) => block(add(intakeAt, [0, dy, -0.03]), [0.28, 0.03, 0.03], 0)));
  // A flank plate on the left side, armour on the side it turns to the enemy when it shoulders the rifle.
  const flankPlate = turn(block([-0.375, 2.88, 0.0], [0.06, 0.34, 0.44], 0.02), [0, 0, -0.07], [-0.375, 2.88, 0]);
  // Collar plates either side of the neck: the left one bone, the right one dark.
  const collarR = turn(block([0.22, 3.31, 0.04], [0.24, 0.08, 0.4], 0.025), [0, 0, -0.3], [0.22, 3.31, 0.04]);
  // Armour over the hip drums, hung from the belt, and a guard over the front of the pelvis.
  const hipSkirtR = lod === 2 ? empty() : turn(block([0.36, 2.2, 0.03], [0.2, 0.16, 0.36], 0.025), [0, 0, -0.35], [0.28, 2.26, 0.03]);
  const hipGuard = lod === 2 ? empty() : bar([0, 2.1, -0.21], [0, 1.86, -0.22], X, [0.26, 0.07], [0.2, 0.06], 0.02);
  // Rams from the front of the pelvis into the chest hold it upright against the rifle's kick.
  const waistRam = (x: number) => mid(ram([x, 2.06, -0.12], [x * 0.9, 2.44, -0.1], 0.035, 0.5));
  const torsoFrame = merge(
    block([0, 2.0, 0.04], [0.42, 0.26, 0.36], 0.04), // pelvis
    cyl([0, 2.08, 0.04], [0, 2.44, 0.04], 0.11, 0.11, 10), // the spine
    mid(cyl([0, 2.2, 0.04], [0, 2.26, 0.04], 0.17, 0.17, 10)), // a rib, where the waist turns
    cyl([0, 3.26, 0.02], [0, 3.52, 0.02], 0.09, 0.09, 8), // neck
    mid(cyl([0, 3.34, 0.02], [0, 3.4, 0.02], 0.14, 0.14, 10)), // the neck's turning ring
    chestCore, waistRam(0.15), waistRam(-0.15), intake,
  );

  // ---- Head: a narrow sensor housing with a long main optic forward, crossed at the brow by a rangefinder bar.
  // The bar puts a lens at each end: two eyes a metre apart judge range the way a pair of eyes does, which is why
  // the bar is as wide as the shoulders.
  const headRing = (z: number, y: number, w: number, h: number) => ring([0, y, z], X, Y, w, h, 0.06);
  const head = loft([headRing(0.16, 3.62, 0.28, 0.24), headRing(-0.04, 3.64, 0.34, 0.3), headRing(-0.24, 3.61, 0.28, 0.22)]);
  const barY = 3.71, barZ = -0.02, barEnd = 0.56;
  const rangeBar = merge(
    bar([-barEnd, barY, barZ], [barEnd, barY, barZ], Z, [0.17, 0.13], [0.17, 0.13], 0.025, lod === 2 ? undefined : 0.03),
    // The end housings, where the lenses sit, deeper than the bar.
    ...[1, -1].map((s) => block([s * (barEnd - 0.06), barY, barZ - 0.03], [0.16, 0.17, 0.24], 0.025)),
  );
  // The clamp that holds the bar on the crown, a hood over the main optic and its long lens barrel.
  const headFrame = merge(
    mid(block([0, barY + 0.02, barZ], [0.22, 0.19, 0.22], 0.02)),
    cyl([0, 3.6, -0.22], [0, 3.6, -0.44], 0.1, 0.105, 10, 0.015),
    mid(block([0, 3.7, -0.33], [0.24, 0.035, 0.28], 0.01)), // its sunshade
    // Fins on the bar that shed the rangefinder's heat, between the clamp and the lens housings.
    near(...[0.2, 0.27, 0.34].flatMap((x) => [block([x, barY + 0.08, barZ], [0.03, 0.04, 0.15], 0), block([-x, barY + 0.08, barZ], [0.03, 0.04, 0.15], 0)])),
    near(...[1, -1].map((s) => cyl([s * (barEnd - 0.06), barY, barZ - 0.15], [s * (barEnd - 0.06), barY, barZ - 0.19], 0.07, 0.075, 10))), // lens bezels
  );
  // The rangefinder's reading goes down to the rifle's fire control: a cable from the bar's clamp, down the back of
  // the neck and into the right collar.
  const rangeCable = near(cable([[0.1, barY - 0.02, barZ + 0.11], [0.12, 3.5, 0.14], [0.2, 3.36, 0.12]], 0.022));
  const headGlow = merge(
    cyl([0, 3.6, -0.44], [0, 3.6, -0.455], 0.075, 0.075, 10),
    ...[1, -1].map((s) => cyl([s * (barEnd - 0.06), barY, barZ - 0.19], [s * (barEnd - 0.06), barY, barZ - 0.2], 0.05, 0.05, 10)),
  );

  // ---- Pack: the capacitor bank that charges the rail, a narrow box between the shoulder blades with a drum of cells
  // on each side, a ballast block under it that balances the long barrel out front, and two jet nozzles.
  const pack = merge(
    block([0, 2.8, 0.42], [0.46, 0.66, 0.32], 0.05),
    mid(block([0, 3.15, 0.4], [0.36, 0.06, 0.26], 0.02)), // the lid over the cells' terminals
  );
  // Two vent stripes on the pack's back that show where the charger's heat leaves.
  const packVents = near(...[2.62, 2.68, 2.74].map((y) => block([0, y, 0.595], [0.28, 0.025, 0.03], 0)));
  const ballastAt: V3 = [0, 2.27, 0.6];
  const ballast = block(ballastAt, [0.38, 0.24, 0.26], 0.04);
  // Two straps hang it from the pack, so it reads as hung weight, not part of the body.
  const ballastStraps = mid(...[0.13, -0.13].map((x) => block([x, 2.44, 0.6], [0.05, 0.16, 0.2], 0)));
  const cellDrum = (x: number) => merge(
    cyl([x, 2.5, 0.44], [x, 3.08, 0.44], 0.11, 0.11, 10, 0.02),
    // Clamps that hold the cells in their drum.
    near(...[2.62, 2.96].map((y) => cyl([x, y - 0.025, 0.44], [x, y + 0.025, 0.44], 0.125, 0.125, 10))),
  );
  const nozzle = (x: number) => merge(
    cyl([x, 2.34, 0.55], [x, 1.9, 0.55], 0.085, 0.13, 10, 0.02),
    mid(cyl([x, 2.4, 0.55], [x, 2.32, 0.55], 0.105, 0.105, 10)), // the gimbal collar
    near(cyl([x, 2.14, 0.55], [x, 2.09, 0.55], 0.125, 0.125, 10)), // the band that stiffens the bell
  );
  // A hatch over the charger on the pack's back, with a dark grip to pull it open by, for swapping spent cells.
  const hatch = near(block([0, 2.95, 0.595], [0.24, 0.16, 0.03], 0.008), block([0, 2.95, 0.615], [0.12, 0.03, 0.03], 0));
  const jets = merge(
    hatch,
    nozzle(0.4), nozzle(-0.4),
    block([0, 2.44, 0.5], [0.74, 0.1, 0.18], 0.025), // the bar that carries both nozzles
    // Rams that tip each nozzle to steer a jump.
    near(cyl([0.3, 2.42, 0.44], [0.36, 2.2, 0.48], 0.022, 0.022, 6), cyl([-0.3, 2.42, 0.44], [-0.36, 2.2, 0.48], 0.022, 0.022, 6)),
    cellDrum(0.3), cellDrum(-0.3), ballastStraps, packVents,
    bolts([[0.17, 3.05, 0.585], [-0.17, 3.05, 0.585], [0.17, 2.5, 0.585], [-0.17, 2.5, 0.585]], Z, 0.03),
  );

  // ---- Arms. Slim and long. The right hand holds the rifle's grip at the hip; the left reaches across the chest to
  // the foregrip. Camo alternates: a bone right pauldron and left forearm guard, dark the other two.
  const upperDirR = norm(sub(ELBOW_R, SHOULDER_R)), upperDirL = norm(sub(ELBOW_L, SHOULDER_L));
  const upperArm = (s: V3, e: V3, d: V3) => merge(
    bar(lerp(s, e, 0.08), e, X, [0.18, 0.2], [0.15, 0.17], 0.03),
    mid(bar(add(lerp(s, e, 0.25), scale(perp(d, X), 0.09 * Math.sign(s[0]))), add(lerp(s, e, 0.75), scale(perp(d, X), 0.08 * Math.sign(s[0]))), perp(d, X), [0.04, 0.15], [0.04, 0.13], 0.012)),
  );
  const forearmR = bar(ELBOW_R, WRIST_R, X, [0.2, 0.21], [0.17, 0.17], 0.03);
  const forearmL = bar(ELBOW_L, WRIST_L, Y, [0.2, 0.2], [0.17, 0.17], 0.03);
  const pauldron = (side: number) => {
    const pivot: V3 = [0.62 * side, 3.22, 0.02];
    return turn(merge(
      block([0.7 * side, 3.26, 0.03], [0.32, 0.15, 0.5], 0.045),
      mid(block([0.86 * side, 3.14, 0.03], [0.05, 0.2, 0.42], 0.018)), // the lip that hangs over the arm's top
    ), [0, 0, -0.3 * side], pivot);
  };
  // The guard on the left forearm, the arm that crosses the body and takes shots aimed at the chest.
  const guardDir = norm(sub(WRIST_L, ELBOW_L)), guardOut = perp(guardDir, [0, 0, -1]);
  const forearmGuardL = bar(add(lerp(ELBOW_L, WRIST_L, 0.15), scale(guardOut, 0.11)), add(lerp(ELBOW_L, WRIST_L, 0.8), scale(guardOut, 0.1)), Y, [0.17, 0.05], [0.15, 0.05], 0.018);
  // The pilot's marking: a band round the left upper arm, under the pauldron.
  const band = bar(lerp(SHOULDER_L, ELBOW_L, 0.42), lerp(SHOULDER_L, ELBOW_L, 0.55), X, [0.22, 0.24], [0.21, 0.23], 0.015);
  // Fists closed on the grips, each a block with a knuckle plate.
  const fistR = merge(block([0.86, 2.4, -0.42], [0.15, 0.17, 0.2], 0.03), near(block([0.94, 2.42, -0.42], [0.03, 0.12, 0.16], 0)));
  const fistL = merge(block([0.68, 2.47, -1.05], [0.2, 0.15, 0.17], 0.03), near(block([0.68, 2.55, -1.12], [0.14, 0.03, 0.06], 0)));
  // The elbow pistons, from the front of each upper arm onto the forearm: they bend the elbows.
  const elbowPiston = (s: V3, e: V3, w: V3, d: V3) => {
    const f = perp(d, [0, 0, -1]);
    return near(ram(add(lerp(s, e, 0.2), scale(f, 0.11)), add(lerp(e, w, 0.25), [0, 0.1, 0]), 0.035, 0.45));
  };
  // A ram along the inside of the right forearm turns the wrist, so the rifle can follow the aim without the arm.
  const armFrame = merge(
    ...[1, -1].map((s) => cyl([0.44 * s, SHOULDER_R[1], SHOULDER_R[2]], [0.66 * s, SHOULDER_R[1], SHOULDER_R[2]], 0.13, 0.13, 10, 0.025)),
    mid(cyl([ELBOW_R[0] - 0.12, ELBOW_R[1], ELBOW_R[2]], [ELBOW_R[0] + 0.12, ELBOW_R[1], ELBOW_R[2]], 0.11, 0.11, 10, 0.02)),
    mid(cyl(add(ELBOW_L, [-0.03, -0.11, 0.0]), add(ELBOW_L, [0.03, 0.11, 0.0]), 0.11, 0.11, 10, 0.02)),
    fistR, fistL,
    elbowPiston(SHOULDER_R, ELBOW_R, WRIST_R, upperDirR), elbowPiston(SHOULDER_L, ELBOW_L, WRIST_L, upperDirL),
    near(ram([0.71, 2.43, 0.12], [0.76, 2.4, -0.26], 0.03)),
    near(...[1, -1].map((s) => turn(bolts([[0.7 * s, 3.34, -0.12], [0.7 * s, 3.34, 0.18]], Y, 0.03), [0, 0, -0.3 * s], [0.62 * s, 3.22, 0.02]))),
  );

  // ---- The rail rifle. Stock and receiver in bone, so the long pale line of it is the first thing seen; the rails
  // run out of the receiver to the muzzle with a glowing channel between them, held apart by coil collars that drive
  // the slug. A capacitor bank on the receiver's right side, the scope on top, its lens the laser's red.
  const R = (dy: number, z: number, dx = 0): V3 => [RX + dx, RY + dy, z];
  const stock = slab([RX, 0, 0], Z, Y, [[0.44, RY + 0.12], [0.44, RY - 0.17], [0.32, RY - 0.2], [-0.06, RY - 0.12], [-0.06, RY + 0.12]], 0.12, 0.02);
  const receiver = merge(
    block(R(0, -0.55), [0.18, 0.26, 1.0], 0.035),
    mid(block(R(0.15, -0.55), [0.1, 0.05, 0.7], 0.012)), // the rail the scope mounts clamp to
    near(block(R(0.08, 0.1), [0.16, 0.08, 0.2], 0.015)), // the cheek rest
  );
  const scopeHood = cyl(R(0.24, -0.99), R(0.24, -1.12), 0.095, 0.095, 10, 0.012);
  const barrelLength = 1.95, barrelStart = -1.05;
  // Coil collars every 40 cm round both rails; the far level keeps the two that break the barrel's line.
  const collarZ = lod === 2 ? [-1.75, -2.55] : [-1.35, -1.75, -2.15, -2.55, -2.92];
  const rails = merge(
    bar(R(0.085, barrelStart), R(0.085, barrelStart - barrelLength), X, [0.12, 0.065], [0.12, 0.065], 0.015),
    bar(R(-0.085, barrelStart), R(-0.085, barrelStart - barrelLength), X, [0.12, 0.065], [0.12, 0.065], 0.015),
    ...collarZ.map((z) => block(R(0, z), [0.2, 0.3, 0.07], 0.02)),
  );
  // The armature between the rails, the part the current runs through: pale between the two dark rails, so the barrel
  // reads as rails from the side. Far off the gap is under a pixel, so it fills the whole space between them.
  const armature = lod === 2
    ? block(R(0, barrelStart - barrelLength / 2), [0.08, 0.12, barrelLength], 0)
    : bar(R(0, barrelStart - 0.02), R(0, MUZZLE[2] + 0.06), X, [0.06, 0.11], [0.06, 0.11], 0);
  // Fins along the top rail between the coil collars: the rails heat up shot by shot and shed it here.
  const railFins = near(...[-1.55, -1.95, -2.35, -2.74].flatMap((z) => [-0.06, 0.06].map((dz) => block(R(0.14, z + dz), [0.1, 0.05, 0.025], 0))));
  const rifleFrame = merge(
    railFins,
    block(R(-0.03, 0.42), [0.13, 0.36, 0.06], 0.015), // butt pad, against the arm
    mid(bar(R(-0.13, -0.34), R(-0.3, -0.42), X, [0.08, 0.11], [0.07, 0.1], 0.015)), // pistol grip
    mid(bar(R(-0.13, -0.98, -0.02), R(-0.3, -1.03, -0.05), X, [0.08, 0.1], [0.07, 0.09], 0.015)), // foregrip
    // The scope: two mounts, the tube, the objective bell, and an eyepiece toward the pilot's camera.
    mid(...[-0.32, -0.78].map((z) => block(R(0.19, z), [0.08, 0.07, 0.06], 0))),
    cyl(R(0.24, -0.12), R(0.24, -0.86), 0.06, 0.06, 10, 0.01),
    cyl(R(0.24, -0.86), R(0.24, -0.99), 0.065, 0.09, 10),
    mid(cyl(R(0.24, -0.04), R(0.24, -0.13), 0.055, 0.065, 10)),
    near(cyl(R(0.31, -0.5), R(0.35, -0.5), 0.035, 0.035, 8), cyl(R(0.24, -0.5, 0.06), R(0.24, -0.5, 0.1), 0.035, 0.035, 8)), // range and wind knobs
    // The capacitor bank: the shot's charge waits here for the 1.2 s brace. Ribs along it shed the charging heat.
    block(R(-0.03, -0.62, 0.13), [0.08, 0.2, 0.6], 0.015),
    near(...[-0.4, -0.47, -0.54, -0.81, -0.88].map((z) => block(R(-0.03, z, 0.175), [0.025, 0.22, 0.03], 0))),
    // The power line from the pack, under the right elbow and into the back of the receiver.
    near(cable([[0.3, 2.56, 0.52], [0.56, 2.3, 0.44], [0.8, 2.36, 0.24], R(-0.1, -0.04, -0.02)], 0.026)),
  );
  // The weapon in hand's colour: the receiver's cover plates and the muzzle, so the rifle shows what you hold.
  const rifleWeapon = merge(
    block(R(0.0, -0.3, 0.1), [0.03, 0.14, 0.36], 0.008),
    mid(block(R(0.0, -0.3, -0.1), [0.03, 0.14, 0.36], 0.008)),
    // The muzzle: two jaws that let the slug out between them.
    ...[0.09, -0.09].map((dy) => block(R(dy, MUZZLE[2] + 0.08), [0.22, 0.12, 0.16], 0.02)),
    mid(block(R(0, MUZZLE[2] + 0.17), [0.24, 0.32, 0.04], 0.01)), // the plate that clamps the jaws to the rails
  );
  const rifleGlow = merge(
    mid(block(R(0, MUZZLE[2] + 0.07), [0.08, 0.06, 0.15], 0)), // the slug's path out between the jaws
    cyl(R(0.24, -1.07), R(0.24, -1.08), 0.07, 0.07, 10), // the scope's lens, sunk in its hood
    mid(block(R(-0.03, -0.62, 0.175), [0.012, 0.06, 0.18], 0)), // the bank's charge window
  );

  return [
    { name: "Torso", zone: "torso", paint: "slate", mesh: merge(chestLower, serialPlate, flankPlate, collarR, hipGuard, mirrorX(hipSkirtR), intakeSlats) },
    { name: "Torso_Camo", zone: "torso", paint: "bone", mesh: merge(breastplate, mirrorX(collarR), hipSkirtR) },
    { name: "Frame", zone: "torso", paint: "frame", rusts: false, mesh: merge(torsoFrame, headFrame, rangeCable) },
    { name: "Sensor", zone: "torso", paint: "slate", mesh: head },
    { name: "Rangefinder", zone: "torso", paint: "bone", mesh: rangeBar },
    { name: "Sensor_Glow", zone: "torso", paint: "lensGlow", glow: true, mesh: headGlow },
    { name: "Pack", zone: "torso", paint: "slate", mesh: pack },
    { name: "Ballast", zone: "torso", paint: "bone", mesh: ballast },
    { name: "Jets", zone: "torso", paint: "frame", rusts: false, mesh: jets },
    { name: "Leg_L", zone: "legs", paint: "slate", mesh: mirrorX(merge(legShellR, kneeCap, thighPlate, outerPlates, foot)) },
    { name: "Leg_R", zone: "legs", paint: "slate", mesh: merge(legShellR, kneeCap, shinGuard, outerPlates, foot) },
    { name: "Leg_Camo", zone: "legs", paint: "bone", mesh: merge(thighPlate, mirrorX(shinGuard)) },
    { name: "Leg_Frame", zone: "legs", paint: "frame", rusts: false, mesh: merge(legFrameR, mirrorX(legFrameR), spade, mirrorX(spade)) },
    { name: "Arm_L", zone: "arms", paint: "slate", mesh: merge(upperArm(SHOULDER_L, ELBOW_L, upperDirL), forearmL, pauldron(-1)) },
    { name: "Arm_R", zone: "arms", paint: "slate", mesh: merge(upperArm(SHOULDER_R, ELBOW_R, upperDirR), forearmR) },
    { name: "Arm_Camo", zone: "arms", paint: "bone", noHit: true, mesh: merge(pauldron(1), forearmGuardL) },
    { name: "Arm_Frame", zone: "arms", paint: "frame", rusts: false, noHit: true, mesh: armFrame },
    { name: "Arm_Band", zone: "arms", paint: "accent", noHit: true, mesh: band },
    { name: "Rifle", zone: "arms", paint: "bone", mesh: merge(stock, receiver, scopeHood, armature) },
    { name: "Rifle_Rails", zone: "arms", paint: "frame", rusts: false, mesh: rails },
    { name: "Rifle_Frame", zone: "arms", paint: "frame", rusts: false, noHit: true, mesh: rifleFrame },
    { name: "Rifle_Weapon", zone: "arms", paint: "weapon", noHit: true, mesh: rifleWeapon },
    { name: "Rifle_Glow", zone: "arms", paint: "lensGlow", glow: true, noHit: true, mesh: rifleGlow },
  ];
}
const scheme = { slate: "#4B4660", bone: "#D9CFB4", frame: "#1C2023", lensGlow: "#FF4D3D" };

const markers: NodeData[] = [
  // Shots and the Rail Shot leave the rifle's muzzle, between its jaws.
  { name: "Mount_Gun", translation: MUZZLE },
  { name: "Torso_Fx", translation: [0.2, 2.9, -0.36] },
  { name: "Arm_R_Fx", translation: ELBOW_R },
  { name: "Leg_L_Fx", translation: mirrorPoint(KNEE) },
  // The two-bone chain ends at the ankle; the long foot runs on from it to the toes.
  ...bothLegs(HIP, KNEE, ANKLE, TOE),
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
const dir = join(root, "assets/models/mechs/longshot");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Longshot.glb"), writeGlb([...parts.map((p) => ({ name: p.name, mesh: p.mesh })), ...lodNodes, ...markers], { quantize: true }));
const kitParts = Object.fromEntries(parts.map(({ name, mesh: _mesh, ...look }) => [name, look]));
writeFileSync(join(root, "scripts/mechs/longshot.kit.json"), `${JSON.stringify({ scheme, parts: kitParts }, null, 2)}\n`);
const totals = levels.map((l) => l.reduce((s, p) => s + triangles(p.mesh), 0));
console.log(`Wrote Mech_Longshot.glb to ${dir}: ${totals.join(" / ")} triangles (near / middle / far), ${totals[0]! + lodNodes.reduce((s, n) => s + triangles(n.mesh!), 0)} in the file`);
parts.forEach((p, i) => console.log(`  ${p.name.padEnd(13)} ${p.zone.padEnd(6)} ${p.paint.padEnd(12)} ${levels.map((l) => String(triangles(l[i]!.mesh)).padStart(5)).join(" ")}`));
