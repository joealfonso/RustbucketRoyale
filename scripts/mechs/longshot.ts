// Builds the Longshot (docs/MECH_ROSTER.md, section 5), the marksman: tall and thin on long straight legs whose knees
// bend forward like a person's (the Stiletto and the Arbiter stand on bird legs, the Ironclad's knees bend back), a
// narrow armoured chest, a rangefinder head whose crossbar puts a lens at each end, and a rail rifle nearly as long as
// the mech is tall, held at the right of the chest and steadied by the left hand. A capacitor pack on the back feeds
// the rifle and a ballast block under it balances the barrel; spades behind the heels dig in when it braces for Rail
// Shot. Deep slate violet with a bone breastplate and bone splinter plates, bare gunmetal joints, black rails and
// rubber, red lenses: the scope glows the colour of the laser it throws. No other mech wears violet, and it sits
// darker than moss and rust while the bone sits lighter.
// Every part is built in place on the assembled mech (metres, Y up, facing -Z, right side +X).
// Writes the model and scripts/mechs/longshot.kit.json, the paint and zone of every part.
// Run: npx tsx scripts/mechs/longshot.ts  →  assets/models/mechs/longshot/Mech_Longshot.glb
//
// Levels of detail: the same build runs three times. The nearest has bevels, rounder joints and the big turned forms
// a player sees within 25 m (the rifle's flanged coil collars, its muzzle brake and deep scope hood, the ribbed cell
// drums, hollow jet bells, the lenses sunk in their barrels, the heel spades built of plates); the middle (past 25 m,
// data/mechKits.json lodDistances) drops the bevels, keeps the pistons, hoses and seams, and fills each of those forms
// in solid with the same outline, so nothing jumps at the switch; the far one (past 80 m) keeps only what makes the
// silhouette: the long legs, the chest, the pauldrons, the head's crossbar, the pack and the rifle. Bolts, slats,
// vents and fins are not modelled at all: the painted atlas draws plates, rivets and chips up close, and modelled ones
// under the 6 cm outline only turned into ink blots.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { bothLegs } from "./joints";
import { leftOf, piston, sway } from "./motion";
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
// How many sides a round shape has: one count, which the simpler levels cut down by rule, or one count per level, so a
// shape can be rounder up close and keep exactly the sides it had before on the middle and far levels.
type Sides = number | [number, number, number];

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

// The shape makers for one level of detail. Bevels and fine round shapes only on the nearest level; `mid` keeps a
// shape on the nearest two levels.
function makers(lod: Lod) {
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

  const count = (sides: Sides) => typeof sides !== "number" ? sides[lod]
    : lod === 0 ? sides : lod === 1 ? Math.max(6, Math.round(sides * 0.6)) : Math.max(4, Math.round(sides / 2));
  // Rings of `n` points round the line through a and b, all set the same way round so they line up face to face.
  const rings = (a: V3, b: V3, n: number) => {
    const dir = norm(sub(b, a)), [u, v] = across(dir, Math.abs(dir[1]) < 0.9 ? Y : X);
    const circle = (c: V3, r: number) => Array.from({ length: n }, (_, i) => {
      const t = ((i + 0.5) / n) * Math.PI * 2;
      return add(c, add(scale(u, Math.cos(t) * r), scale(v, Math.sin(t) * r)));
    });
    return { dir, u, v, circle };
  };

  // A round shaft from a to b (a cone with two radii), its end rims bevelled on the nearest level.
  function cyl(a: V3, b: V3, r0: number, r1 = r0, sides: Sides = 12, bevel = 0): MeshData {
    const { dir, circle } = rings(a, b, count(sides));
    const e = lod === 0 ? Math.min(bevel, r0 * 0.4, r1 * 0.4, length(sub(b, a)) * 0.3) : 0;
    if (e <= 0) return loft([circle(a, r0), circle(b, r1)]);
    return loft([circle(a, r0 - e), circle(add(a, scale(dir, e)), r0), circle(sub(b, scale(dir, e)), r1), circle(b, r1 - e)]);
  }

  // A solid turned about the line from a toward b, through `profile`: [metres along from a, radius] pairs, every
  // radius above 0, capped flat at both ends. Unlike `loft` it may step in and out (ribs, flanges) and run back on
  // itself (the inner wall of a hood or a nozzle's bell, ending on the floor inside), so it cannot lean on `convex` to
  // turn its faces out. The profile runs round the outside of the solid's half section, so each face's outside follows
  // from the way the profile runs there: a step forward faces out from the axis, a step outward faces back toward a,
  // a step inward faces on toward b, and a step back faces in toward the axis.
  function lathe(a: V3, b: V3, profile: [number, number][], sides: Sides): MeshData {
    const n = count(sides), { dir, u, v, circle } = rings(a, b, n);
    const out = empty();
    const face = (points: V3[], outward: V3) => {
      let normal = norm(cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!)));
      if (dot(normal, outward) < 0) { normal = scale(normal, -1); points = [...points].reverse(); }
      const base = out.positions.length / 3;
      for (const p of points) { out.positions.push(...p); out.normals.push(...normal); }
      for (let i = 1; i < points.length - 1; i++) out.indices.push(base, base + i, base + i + 1);
    };
    const at = profile.map(([t, r]) => circle(add(a, scale(dir, t)), r));
    face(at[0]!, scale(dir, -1));
    face(at.at(-1)!, dir);
    for (let k = 0; k + 1 < profile.length; k++) {
      const [t0, r0] = profile[k]!, [t1, r1] = profile[k + 1]!;
      if (Math.abs(t1 - t0) < 1e-6 && Math.abs(r1 - r0) < 1e-6) continue;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, mid = ((i + 1) / n) * Math.PI * 2;
        const away = add(scale(u, Math.cos(mid)), scale(v, Math.sin(mid)));
        face([at[k]![i]!, at[k]![j]!, at[k + 1]![j]!, at[k + 1]![i]!], add(scale(dir, -(r1 - r0)), scale(away, t1 - t0)));
      }
    }
    return out;
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


  // A hydraulic ram from `a` to `b`: a fat cylinder most of the way, a thin rod out of it. `at` is where the rod
  // leaves the cylinder, as a share of the length. The rod runs on deep inside the cylinder, out of sight, so it never
  // pulls out when the game slides it (gate V9b).
  const ram = (a: V3, b: V3, r: number, at = 0.55) =>
    merge(cyl(a, lerp(a, b, at + 0.05), r, r, [12, 6, 4], r * 0.25), cyl(lerp(a, b, Math.min(at, 0.2)), b, r * 0.5, r * 0.5, [10, 6, 4]));

  // A cable through a run of points, one rod per stretch, so it bends where it is clipped down.
  const cable = (points: V3[], r: number) => merge(...points.slice(1).map((p, i) => cyl(points[i]!, p, r, r, [10, 6, 4])));

  return { lod, mid, run, bar, cyl, lathe, slab, block, ram, cable };
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

// The leg rams' mounts (gate V9b): the knee piston from the front of the thigh to the shin just below the knee, the
// calf ram from the back of the shin to the foot behind the ankle, so the game slides each as its joint bends.
const KNEE_PISTON: [V3, V3] = [
  add(lerp(HIP, KNEE, 0.16), scale(perp(norm(sub(KNEE, HIP)), [0, 0, -1]), 0.27)),
  add(lerp(HIP, KNEE, 0.84), scale(perp(norm(sub(KNEE, HIP)), [0, 0, -1]), 0.215)),
];
const CALF_RAM: [V3, V3] = [
  add(lerp(KNEE, ANKLE, 0.14), scale(perp(norm(sub(ANKLE, KNEE)), [0, 0, -1]), -0.2)),
  add(lerp(KNEE, ANKLE, 0.86), scale(perp(norm(sub(ANKLE, KNEE)), [0, 0, -1]), -0.12)),
];
// The ballast hangs from the pack on two straps (their tops at 2.52 m), and swings on them.
const BALLAST_AT: V3 = [0, 2.27, 0.6];

type Zone = "legs" | "arms" | "torso";
// How the master material shades a part: painted armour, bare metal (one hard highlight), or rubber (dark, no rim).
type Finish = "paint" | "metal" | "rubber";
// `noHit`: lies inside another part's box, or would stretch one box across the body.
interface Part { name: string; zone: Zone; paint: string; finish?: Finish; glow?: true; rusts?: false; noHit?: true; mesh: MeshData }

function build(lod: Lod): Part[] {
  const { mid, run, bar, cyl, lathe, slab, block, ram, cable } = makers(lod);

  // ---- Legs. Built on the right, then mirrored. Camo alternates side to side: a bone thigh plate on the right, a
  // bone shin guard on the left, so the two legs never read as copies.
  const thighDir = norm(sub(KNEE, HIP)), shinDir = norm(sub(ANKLE, KNEE)), footDir = norm(sub(TOE, ANKLE));
  const thighFront = perp(thighDir, [0, 0, -1]), thighBack = scale(thighFront, -1);
  const shinFront = perp(shinDir, [0, 0, -1]), shinBack = scale(shinFront, -1);
  const footTop = perp(footDir, Y);
  const onThigh = (t: number, out: V3 = [0, 0, 0]) => add(lerp(HIP, KNEE, t), out);
  const onShin = (t: number, out: V3 = [0, 0, 0]) => add(lerp(KNEE, ANKLE, t), out);
  const onFoot = (t: number, out: V3 = [0, 0, 0]) => add(lerp(ANKLE, TOE, t), out);

  // The shell: a long thigh that swells a third of the way down where the hip's drive rods end, a long shin with a
  // full calf behind it, an ankle housing that carries the foot. Thigh and calf are drawn fuller than the knee and
  // ankle on purpose: a straight tube of a leg turns into a stick past 50 m, a leg with a thigh and a calf stays a leg.
  const legShellR = merge(
    run([[add(HIP, [0, 0.06, 0]), [0.27, 0.32]], [onThigh(0.32), [0.32, 0.4]], [KNEE, [0.2, 0.23]]], X, 0.035, 0.05),
    run([[KNEE, [0.2, 0.22]], [onShin(0.3), [0.27, 0.33]], [ANKLE, [0.16, 0.17]]], X, 0.03, 0.04),
    // The ankle housing, over the joint and on down onto the back of the foot.
    run([[add(ANKLE, [0, 0.06, 0.02]), [0.23, 0.22]], [onFoot(0.28, scale(footTop, 0.02)), [0.22, 0.15]]], X, 0.03),
  );
  // A knee cap hung off the bottom of the thigh over the front of the knee: what takes the hit when it kneels.
  const kneeCap = bar(add(KNEE, [0, 0.18, -0.14]), add(KNEE, [0, -0.14, -0.19]), X, [0.25, 0.13], [0.2, 0.1], 0.03);
  // Armour over the front of the thigh, and its twin over the shin: the leg's face, the side shots come from. The
  // thigh plate's top stands proud of the shell as a lip under the hip, a step in the leg's outline from the side.
  const thighPlate = bar(onThigh(0.06, scale(thighFront, 0.21)), onThigh(0.8, scale(thighFront, 0.15)), X, [0.27, 0.08], [0.2, 0.06], 0.022);
  const shinGuard = bar(onShin(0.1, scale(shinFront, 0.155)), onShin(0.8, scale(shinFront, 0.105)), X, [0.23, 0.07], [0.17, 0.06], 0.02);
  // A plate on the outside of the thigh over the hip actuator's drive rods, and a second one lapped onto the shin.
  const outerPlates = mid(
    bar(onThigh(0.18, [0.155, 0, 0]), onThigh(0.66, [0.145, 0, 0]), X, [0.05, 0.28], [0.05, 0.22], 0.018),
    bar(onShin(0.18, [0.13, 0, 0]), onShin(0.58, [0.12, 0, 0]), X, [0.04, 0.2], [0.04, 0.16], 0.015),
  );
  // The foot: a long flat sole split into two toes at the front, so it grips on rock. Broad and deep for a thin mech,
  // so it plants like it means it.
  const foot = merge(
    run([[add(ANKLE, [0, -0.24, 0.1]), [0.32, 0.16]], [add(TOE, [0, 0.04, 0.14]), [0.32, 0.12]]], X, 0.03),
    ...[-0.085, 0.085].map((dx) => mid(bar(add(TOE, [dx, 0.04, 0.18]), add(TOE, [dx, 0.03, -0.06]), X, [0.145, 0.12], [0.125, 0.08], 0.02))),
  );
  const hipDrum = cyl([0.2, HIP[1], HIP[2]], [0.54, HIP[1], HIP[2]], 0.16, 0.16, [20, 10, 8], 0.03);
  // Drives: a piston on the front of the thigh straightens the knee, a ram down the back of the shin (the calf)
  // works the ankle. Each stays on its own bone, so the walk never stretches one across a joint.
  const kneePiston = mid(ram(KNEE_PISTON[0], KNEE_PISTON[1], 0.05, 0.5));
  const calfRam = mid(ram(CALF_RAM[0], CALF_RAM[1], 0.05, 0.5));
  // The heel spade, the stabiliser that plants it for Rail Shot: a pointed blade on a hinge behind the heel, angled
  // down so its point bites into the ground when the mech leans back into the recoil, braced by a cheek plate down
  // each side, and held by a short ram off the foot. Up close it is those plates, each with real thickness, open
  // underneath; past 25 m one solid wedge of the same outline. Behind the heel the foot's bone and the shin's are all
  // but equally near, so the middle of every piece must lie on the toe side of the line through the ankle square to
  // the foot, or the walk hangs it on the shin (legRig.ts): the spade sits low, its point at the ground, and the ram
  // starts well along the foot.
  const spadeSide: [number, number][] = [[0.04, 0.2], [0.21, 0.015], [0.31, 0.0], [0.15, 0.2]]; // [z, y], from the side
  const bladeTop: V3 = [LX, 0.2, 0.15], bladeDir = norm([0, -0.2, 0.16]), bladeIn = norm([0, -0.16, -0.2]);
  const bladeLength = 0.256;
  const spade = lod > 0 ? slab([LX, 0, 0], Z, Y, spadeSide, 0.24, 0.02) : merge(
    // The blade along the back edge, its corners cut back to the point that digs in.
    slab(add(bladeTop, scale(bladeIn, 0.025)), bladeDir, X, [[0, -0.125], [bladeLength - 0.045, -0.125], [bladeLength, -0.05], [bladeLength, 0.05], [bladeLength - 0.045, 0.125], [0, 0.125]], 0.05, 0.015),
    ...[1, -1].map((s) => slab([LX + s * 0.105, 0, 0], Z, Y, spadeSide, 0.035, 0.01)),
  );
  const spadeHinge = cyl([LX - 0.13, 0.165, 0.1], [LX + 0.13, 0.165, 0.1], 0.05, 0.05, [16, 6, 4], 0.012);
  const spadeRam = mid(ram(onFoot(0.3, scale(footTop, 0.08)), add(add(bladeTop, scale(bladeDir, 0.06)), scale(bladeIn, 0.05)), 0.035, 0.5));
  // Under the sole a rubber pad a little wider than the foot, so the foot shows a dark rim at ground level.
  const sole = block(lerp(add(ANKLE, [0, -0.36, 0.06]), add(TOE, [0, -0.03, 0.02]), 0.5), [0.35, 0.05, 0.76], 0.012);
  // Hoses to the knee and ankle motors, each kept on one bone so the walk never stretches one: out of the hip drum and
  // down the back of the thigh into the knee motor, and from the calf ram's head down into the ankle housing. They
  // stand off the shell and show against the sky behind the leg.
  const legHoses = mid(
    cable([add(HIP, [0.06, -0.06, 0.17]), onThigh(0.42, add(scale(thighBack, 0.23), [0.07, 0, 0])), onThigh(0.88, add(scale(thighBack, 0.15), [0.1, 0, 0]))], 0.032),
    cable([onShin(0.1, add(scale(shinBack, 0.15), [0.1, 0, 0])), onShin(0.5, add(scale(shinBack, 0.21), [0.1, 0, 0])), onShin(0.92, add(scale(shinBack, 0.1), [0.08, 0, 0]))], 0.03),
  );
  // The hip actuator's two drive rods, from the drum down the outside of the thigh to where the shell is deepest.
  const driveRods = mid(...[0.07, -0.07].map((s) => cyl(add(HIP, [0.19, -0.1, s]), onThigh(0.42, add([0.185, 0, 0], scale(thighFront, s))), 0.03, 0.03, [10, 6, 4])));
  const legFrameR = merge(
    hipDrum, driveRods, kneePiston, calfRam, spadeHinge, spadeRam,
    cyl([0.2, KNEE[1], KNEE[2]], [0.48, KNEE[1], KNEE[2]], 0.13, 0.13, [18, 8, 7], 0.025),
    mid(cyl([0.24, ANKLE[1], ANKLE[2]], [0.44, ANKLE[1], ANKLE[2]], 0.11, 0.11, [16, 7, 6], 0.02)),
  );

  // ---- Torso: a narrow armoured chest on a bare spine, deepest at the shoulders and tapering down to the waist.
  const chestRing = (y: number, z: number, w: number, d: number, c = 0.1) => ring([0, y, z], X, Z, w, d, c);
  // Two shells: a dark lower one and a bone breastplate over the shoulders, with a seam between them where the frame
  // shows up close. Far off the seam would be a slit of sky, so the two meet. The breastplate flares wider and deeper
  // than the waist below it: the narrow waist and broad chest are the one heroic line a thin mech has.
  const seam = lod === 2 ? 0 : 0.02;
  const chestLower = loft([chestRing(2.38, 0.02, 0.42, 0.38), chestRing(2.64, -0.02, 0.7, 0.56), chestRing(2.74 - seam, -0.02, 0.72, 0.57)]);
  const breastplate = loft([chestRing(2.74 + seam, -0.02, 0.72, 0.57), chestRing(3.1, -0.02, 0.82, 0.64), chestRing(3.32, 0.04, 0.54, 0.46)]);
  const chestCore = mid(loft([chestRing(2.5, 0.0, 0.6, 0.5), chestRing(2.9, 0.0, 0.66, 0.52)]));
  // The plate carrying the serial: flat and plain, so the number has a clean face. No bolts on it: four dots round
  // two digits read as a face.
  const serialPlate = block(SERIAL_AT, [0.38, 0.28, 0.06], 0.02);
  // On the left of the chest, an intake that cools the capacitors' charger. Its slats are paint: at 20 m they were
  // three lines of ink.
  const intake = block([-0.17, 2.86, -0.31], [0.26, 0.22, 0.04], 0.012);
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
    cyl([0, 2.08, 0.04], [0, 2.44, 0.04], 0.11, 0.11, [16, 6, 5]), // the spine
    mid(cyl([0, 2.2, 0.04], [0, 2.26, 0.04], 0.17, 0.17, [16, 6, 5])), // a rib, where the waist turns
    cyl([0, 3.26, 0.02], [0, 3.52, 0.02], 0.09, 0.09, [14, 6, 4]), // neck
    mid(cyl([0, 3.34, 0.02], [0, 3.4, 0.02], 0.14, 0.14, [16, 6, 5])), // the neck's turning ring
    chestCore, waistRam(0.15), waistRam(-0.15), intake,
  );

  // ---- Head: a narrow sensor housing with a long main optic forward, crossed at the brow by a rangefinder bar.
  // The bar puts a lens at each end: two eyes well apart judge range the way a pair of eyes does, and the wider apart
  // the better they judge it, which is why the bar is as wide as the shoulders.
  const headRing = (z: number, y: number, w: number, h: number) => ring([0, y, z], X, Y, w, h, 0.06);
  const head = loft([headRing(0.16, 3.62, 0.28, 0.24), headRing(-0.04, 3.64, 0.34, 0.3), headRing(-0.24, 3.61, 0.28, 0.22)]);
  // The T it makes is what tells the Longshot at 150 m, so the bar runs out to the pauldrons, a hammerhead wider
  // than any other mech's head. The bar is deepest at the clamp and thins toward the ends, and the lens housings are
  // only a little taller than it and run forward rather than up: with a thin bar between two tall knobs the head read
  // as a dog's bone from behind, which is how a player sees it most (gate V13).
  const barY = 3.72, barZ = -0.02, barEnd = 0.74;
  const lensX = barEnd - 0.1, lensR = 0.09, lensFront = barZ - 0.06 - 0.19;
  const rangeBar = merge(
    run([[[-lensX, barY, barZ], [0.2, 0.13]], [[0, barY, barZ], [0.24, 0.2]], [[lensX, barY, barZ], [0.2, 0.13]]], Z, 0.025, lod === 2 ? undefined : 0.03),
    // The end housings, where the lenses sit, deeper than the bar and reaching forward.
    ...[1, -1].map((s) => block([s * lensX, barY, barZ - 0.06], [0.2, 0.21, 0.38], 0.03)),
  );
  // Each lens sits deep in a barrel standing out of its housing, so the red eye shows only from in front and the
  // barrel's lip throws a ring of shade round it. Past 25 m the barrel is solid, with the lens on its face.
  const lensBarrel = (s: number) => lod === 0
    ? lathe([s * lensX, barY, lensFront], [s * lensX, barY, lensFront - 1], [[0, lensR], [0.08, lensR], [0.1, lensR - 0.014], [0.1, lensR - 0.03], [0.045, lensR - 0.03]], 18)
    : mid(cyl([s * lensX, barY, lensFront], [s * lensX, barY, lensFront - 0.1], lensR, lensR, [18, 6, 5]));
  const lensAt = lod === 0 ? lensFront - 0.046 : lod === 1 ? lensFront - 0.101 : lensFront - 0.05;
  // The clamp that holds the bar on the crown, a hood over the main optic and its long lens barrel.
  const headFrame = merge(
    mid(block([0, barY + 0.02, barZ], [0.22, 0.19, 0.22], 0.02)),
    cyl([0, 3.6, -0.22], [0, 3.6, -0.44], 0.1, 0.105, [16, 6, 5], 0.015),
    mid(block([0, 3.7, -0.33], [0.24, 0.035, 0.28], 0.01)), // its sunshade
    lensBarrel(1), lensBarrel(-1),
  );
  // The rangefinder's reading goes down to the rifle's fire control: a cable from the bar's clamp, down the back of
  // the neck and into the right collar.
  const rangeCable = mid(cable([[0.1, barY - 0.02, barZ + 0.11], [0.13, 3.5, 0.15], [0.22, 3.36, 0.13]], 0.03));
  const headGlow = merge(
    cyl([0, 3.6, -0.44], [0, 3.6, -0.455], 0.075, 0.075, [16, 6, 5]),
    ...[1, -1].map((s) => cyl([s * lensX, barY, lensAt], [s * lensX, barY, lensAt - 0.006], lensR - 0.034, lensR - 0.034, [16, 6, 5])),
  );

  // ---- Pack: the capacitor bank that charges the rail, a narrow box between the shoulder blades with a drum of cells
  // on each side, a ballast block under it that balances the long barrel out front, and two jet nozzles.
  // The box is as wide as the drums' middles, so they sink into it to half their width and the back reads as one
  // violet mass with two rounded grey edges, not two grey columns with a dark gap between (gate V13).
  const pack = merge(
    block([0, 2.8, 0.44], [0.6, 0.66, 0.36], 0.05), // its back face just behind the drums', so they show only as edges
    mid(block([0, 3.15, 0.4], [0.5, 0.06, 0.26], 0.02)), // the lid over the cells' terminals
  );
  const ballast = block(BALLAST_AT, [0.38, 0.24, 0.26], 0.04);
  // Two webbing straps hang it from the pack, so it reads as hung weight, not part of the body.
  const ballastStraps = mid(...[0.13, -0.13].map((x) => block([x, 2.44, 0.6], [0.06, 0.16, 0.22], 0)));
  // The cell drums stand a little above the pack's lid, so from behind the pack has two round shoulders of its own.
  // Up close each is ringed by four cooling ribs, a stack of cells you can count; past 25 m a plain drum as wide as
  // the ribs. The clamps, the vents and the hatch are paint: none of them was wider than the 6 cm outline.
  const ribs = [0.12, 0.25, 0.38, 0.51];
  const cellDrum = (x: number) => lod === 0
    ? lathe([x, 2.48, 0.44], [x, 3.18, 0.44], [
      [0, 0.118], [0.015, 0.134],
      ...ribs.flatMap((t): [number, number][] => [[t, 0.134], [t, 0.148], [t + 0.05, 0.148], [t + 0.05, 0.134]]),
      [0.685, 0.134], [0.7, 0.118],
    ], 16)
    : cyl([x, 2.48, 0.44], [x, 3.18, 0.44], 0.145, 0.145, [16, 8, 7]);
  // A jet nozzle: the gimbal collar, a narrow throat and a bell that flares to the exit, hollow up close, so you look
  // up into it from behind and below. Its exit stays at 1.88 m, just over where the flame starts (data/thrusterFx.json
  // nozzles, the default pair). Past 25 m a solid cone. Slim, so from behind they hang beside the hips rather than
  // over them like a skirt.
  const nozzle = (x: number) => lod === 0
    ? lathe([x, 2.4, 0.56], [x, 1.88, 0.56], [
      [0, 0.09], [0.012, 0.105], [0.068, 0.105], [0.08, 0.082], [0.14, 0.082], [0.3, 0.096], [0.43, 0.115], [0.52, 0.127],
      [0.52, 0.104], [0.4, 0.094], [0.27, 0.074],
    ], 16)
    : merge(
      cyl([x, 2.34, 0.56], [x, 1.88, 0.56], 0.078, 0.125, 14, 0.02),
      mid(cyl([x, 2.4, 0.56], [x, 2.32, 0.56], 0.103, 0.103, 10)), // the gimbal collar
    );
  const jets = merge(
    nozzle(0.4), nozzle(-0.4),
    block([0, 2.44, 0.5], [0.74, 0.1, 0.18], 0.025), // the bar that carries both nozzles
    cellDrum(0.3), cellDrum(-0.3),
  );

  // ---- Arms. Slim and long. The right hand holds the rifle's grip at the hip; the left reaches across the chest to
  // the foregrip. Camo alternates: a bone right pauldron and left forearm guard, dark the other two.
  const upperDirR = norm(sub(ELBOW_R, SHOULDER_R)), upperDirL = norm(sub(ELBOW_L, SHOULDER_L));
  const upperArm = (s: V3, e: V3, d: V3) => merge(
    bar(lerp(s, e, 0.08), e, X, [0.2, 0.22], [0.17, 0.19], 0.03),
    mid(bar(add(lerp(s, e, 0.25), scale(perp(d, X), 0.09 * Math.sign(s[0]))), add(lerp(s, e, 0.75), scale(perp(d, X), 0.08 * Math.sign(s[0]))), perp(d, X), [0.04, 0.15], [0.04, 0.13], 0.012)),
  );
  const forearmR = bar(ELBOW_R, WRIST_R, X, [0.23, 0.24], [0.2, 0.2], 0.03);
  const forearmL = bar(ELBOW_L, WRIST_L, Y, [0.23, 0.23], [0.2, 0.2], 0.03);
  // Broad pauldrons with a deep lip hanging over the arm: the shoulders are drawn wider than the hips so the thin body
  // stands in a V and not a column. The lip stays on every level, it is half the shoulder's outline.
  const pauldron = (side: number) => {
    const pivot: V3 = [0.62 * side, 3.22, 0.02];
    return turn(merge(
      block([0.74 * side, 3.27, 0.03], [0.4, 0.19, 0.6], 0.05),
      block([0.93 * side, 3.15, 0.04], [0.06, 0.24, 0.54], 0.02),
    ), [0, 0, -0.3 * side], pivot);
  };
  // The guard on the left forearm, the arm that crosses the body and takes shots aimed at the chest.
  const guardDir = norm(sub(WRIST_L, ELBOW_L)), guardOut = perp(guardDir, [0, 0, -1]);
  const forearmGuardL = bar(add(lerp(ELBOW_L, WRIST_L, 0.15), scale(guardOut, 0.11)), add(lerp(ELBOW_L, WRIST_L, 0.8), scale(guardOut, 0.1)), Y, [0.17, 0.05], [0.15, 0.05], 0.018);
  // The pilot's marking: a band round the left upper arm, under the pauldron.
  const band = bar(lerp(SHOULDER_L, ELBOW_L, 0.42), lerp(SHOULDER_L, ELBOW_L, 0.55), X, [0.22, 0.24], [0.21, 0.23], 0.015);
  // Fists closed on the grips, big enough to read as hands holding the rifle from 50 m.
  const fistR = block([0.87, 2.4, -0.42], [0.19, 0.21, 0.24], 0.035);
  const fistL = block([0.68, 2.47, -1.05], [0.24, 0.19, 0.21], 0.035);
  // The elbow pistons, from the front of each upper arm onto the forearm: they bend the elbows.
  const elbowPiston = (s: V3, e: V3, w: V3, d: V3) => {
    const f = perp(d, [0, 0, -1]);
    return mid(ram(add(lerp(s, e, 0.2), scale(f, 0.12)), add(lerp(e, w, 0.25), [0, 0.11, 0]), 0.042, 0.45));
  };
  const armFrame = merge(
    ...[1, -1].map((s) => cyl([0.44 * s, SHOULDER_R[1], SHOULDER_R[2]], [0.68 * s, SHOULDER_R[1], SHOULDER_R[2]], 0.14, 0.14, [18, 8, 7], 0.025)),
    mid(cyl([ELBOW_R[0] - 0.13, ELBOW_R[1], ELBOW_R[2]], [ELBOW_R[0] + 0.13, ELBOW_R[1], ELBOW_R[2]], 0.12, 0.12, [16, 6, 5], 0.02)),
    mid(cyl(add(ELBOW_L, [-0.03, -0.12, 0.0]), add(ELBOW_L, [0.03, 0.12, 0.0]), 0.12, 0.12, [16, 6, 5], 0.02)),
    fistR, fistL,
    elbowPiston(SHOULDER_R, ELBOW_R, WRIST_R, upperDirR), elbowPiston(SHOULDER_L, ELBOW_L, WRIST_L, upperDirL),
  );
  // Hydraulic hoses round the back of each elbow, from the upper arm into the forearm: they loop out past the joint,
  // so the bend of the arm shows as a shape. The arms do not bend in play, so a hose may cross the joint.
  const elbowHose = (s: V3, e: V3, w: V3, out: V3) => cable([
    add(lerp(s, e, 0.45), scale(out, 0.11)), add(e, scale(out, 0.17)), add(lerp(e, w, 0.4), scale(out, 0.12)),
  ], 0.032);
  const armHoses = mid(
    elbowHose(SHOULDER_R, ELBOW_R, WRIST_R, norm([0.3, 0, 1])),
    elbowHose(SHOULDER_L, ELBOW_L, WRIST_L, norm([-1, 0, 0.2])),
  );

  // ---- The rail rifle. Stock and receiver in bone, so the long pale line of it is the first thing seen; the rails
  // run out of the receiver to the muzzle with a glowing channel between them, held apart by coil collars that drive
  // the slug. A capacitor bank on the receiver's right side, the scope on top, its lens the laser's red.
  const R = (dy: number, z: number, dx = 0): V3 => [RX + dx, RY + dy, z];
  const stock = slab([RX, 0, 0], Z, Y, [[0.44, RY + 0.12], [0.44, RY - 0.17], [0.32, RY - 0.2], [-0.06, RY - 0.12], [-0.06, RY + 0.12]], 0.12, 0.02);
  const receiver = merge(
    block(R(0, -0.55), [0.18, 0.26, 1.0], 0.035),
    mid(block(R(0.15, -0.55), [0.1, 0.05, 0.7], 0.012)), // the rail the scope mounts clamp to
  );
  // The scope's hood, a deep tube with the lens sunk at its floor so it glows from in front and hides from the side.
  // Past 25 m it is solid with the lens on its face.
  const scopeHood = lod === 0
    ? lathe(R(0.24, -0.99), R(0.24, -2), [[0, 0.11], [0.012, 0.122], [0.158, 0.122], [0.17, 0.11], [0.17, 0.096], [0.075, 0.096]], 16)
    : cyl(R(0.24, -0.99), R(0.24, -1.16), 0.122, 0.122, [16, 8, 7]);
  const scopeLensZ = lod === 0 ? -1.066 : -1.161;
  const barrelLength = 1.95, barrelStart = -1.05;
  // Coil collars every 40 cm round both rails, the last butted against the muzzle's clamp; the far level keeps the two
  // that break the barrel's line. Each is a heavy round drum, two flanges with the coil's winding between them. The
  // barrel is drawn heavier than a rifle's would be: past 50 m a true-to-scale rail is a hair, and the rifle is the mech.
  const collarZ = lod === 2 ? [-1.75, -2.55] : [-1.35, -1.75, -2.15, -2.55, -2.875];
  const collar = (z: number) => lod === 0
    ? lathe(R(0, z + 0.055), R(0, z - 1), [[0, 0.168], [0.012, 0.185], [0.03, 0.185], [0.03, 0.17], [0.08, 0.17], [0.08, 0.185], [0.098, 0.185], [0.11, 0.168]], 18)
    : cyl(R(0, z + 0.055), R(0, z - 0.055), 0.185, 0.185, [16, 8, 6]);
  const rails = merge(
    bar(R(0.1, barrelStart), R(0.1, barrelStart - barrelLength), X, [0.14, 0.08], [0.14, 0.08], 0.015),
    bar(R(-0.1, barrelStart), R(-0.1, barrelStart - barrelLength), X, [0.14, 0.08], [0.14, 0.08], 0.015),
    ...collarZ.map(collar),
  );
  // The armature between the rails, the part the current runs through: pale between the two dark rails, so the barrel
  // reads as rails from the side. Far off the gap is under a pixel, so it fills the whole space between them.
  const armature = lod === 2
    ? block(R(0, barrelStart - barrelLength / 2), [0.1, 0.16, barrelLength], 0)
    : bar(R(0, barrelStart - 0.02), R(0, MUZZLE[2] + 0.06), X, [0.07, 0.13], [0.07, 0.13], 0);
  const rifleFrame = merge(
    mid(bar(R(-0.13, -0.34), R(-0.3, -0.42), X, [0.08, 0.11], [0.07, 0.1], 0.015)), // pistol grip
    mid(bar(R(-0.13, -0.98, -0.02), R(-0.3, -1.03, -0.05), X, [0.08, 0.1], [0.07, 0.09], 0.015)), // foregrip
    // The scope: two mounts, the tube, the objective bell, and an eyepiece toward the pilot's camera. Its knobs and the
    // capacitor bank's cooling ribs are paint now.
    mid(...[-0.32, -0.78].map((z) => block(R(0.19, z), [0.09, 0.08, 0.07], 0))),
    cyl(R(0.24, -0.12), R(0.24, -0.86), 0.072, 0.072, [16, 7, 6], 0.01),
    // The objective bell, flaring in a curve from the tube to the hood.
    lod === 0
      ? lathe(R(0.24, -0.86), R(0.24, -2), [[0, 0.074], [0.05, 0.084], [0.1, 0.103], [0.13, 0.117]], 16)
      : cyl(R(0.24, -0.86), R(0.24, -0.99), 0.078, 0.115, 14),
    mid(cyl(R(0.24, -0.04), R(0.24, -0.13), 0.065, 0.078, [16, 6, 5])),
    // The capacitor bank: the shot's charge waits here for the 1.2 s brace.
    block(R(-0.03, -0.62, 0.135), [0.09, 0.22, 0.6], 0.015),
  );
  // Rubber on the rifle: the butt pad against the arm, and the power line from the pack, under the right elbow and
  // into the back of the receiver.
  const rifleRubber = merge(
    block(R(-0.03, 0.42), [0.14, 0.38, 0.07], 0.015),
    mid(cable([[0.3, 2.56, 0.52], [0.56, 2.3, 0.44], [0.8, 2.36, 0.24], R(-0.1, -0.04, -0.02)], 0.032)),
  );
  // The weapon in hand's colour: the receiver's cover plates and the muzzle, so the rifle shows what you hold.
  const rifleWeapon = merge(
    block(R(0.0, -0.3, 0.1), [0.03, 0.14, 0.36], 0.008),
    mid(block(R(0.0, -0.3, -0.1), [0.03, 0.14, 0.36], 0.008)),
    // The muzzle, a blunt block at the barrel's end that still shows as a knot on the line at 150 m. Up close it is a
    // brake: plates top and bottom and three baffles across, the front one round the bore, with two ports open
    // right through between them, so the blast vents sideways and the slug's glow shows through. Past 25 m two
    // solid jaws fill the same block.
    ...(lod === 0 ? [
      ...[0.165, -0.165].map((dy) => block(R(dy, MUZZLE[2] + 0.0975), [0.3, 0.05, 0.245], 0.015)),
      ...[0.1, -0.1].map((dx) => block(R(0, MUZZLE[2] - 0.0025, dx), [0.1, 0.28, 0.045], 0.012)),
      ...[0.095, -0.095].map((dy) => block(R(dy, MUZZLE[2] - 0.0025), [0.1, 0.09, 0.045], 0.012)),
      ...[0.1, 0.2].map((dz) => block(R(0, MUZZLE[2] + dz), [0.3, 0.28, 0.04], 0.012)),
    ] : [0.11, -0.11].map((dy) => block(R(dy, MUZZLE[2] + 0.1), [0.3, 0.16, 0.24], 0.025))),
    block(R(0, MUZZLE[2] + 0.245), [0.32, 0.44, 0.05], 0.012), // the plate that clamps the brake to the rails
  );
  const rifleGlow = merge(
    mid(block(R(0, MUZZLE[2] + 0.08), [0.09, 0.07, 0.2], 0)), // the slug's path out between the jaws
    cyl(R(0.24, scopeLensZ), R(0.24, scopeLensZ - 0.006), 0.09, 0.09, [16, 6, 5]), // the scope's lens, at the floor of its hood
    mid(block(R(-0.03, -0.62, 0.182), [0.012, 0.06, 0.18], 0)), // the bank's charge window
  );

  const P = (name: string, zone: Zone, paint: string, finish: Finish, mesh: MeshData, extra: Partial<Part> = {}): Part =>
    ({ name, zone, paint, finish, ...extra, mesh });
  const bare = { rusts: false } as const, hose = { rusts: false, noHit: true } as const;
  return [
    P("Torso", "torso", "slate", "paint", merge(chestLower, serialPlate, flankPlate, collarR, hipGuard, mirrorX(hipSkirtR))),
    P("Torso_Camo", "torso", "bone", "paint", merge(breastplate, mirrorX(collarR), hipSkirtR)),
    P("Frame", "torso", "frame", "metal", merge(torsoFrame, headFrame), bare),
    P("Sensor", "torso", "slate", "paint", head),
    P("Rangefinder", "torso", "bone", "paint", rangeBar),
    { name: "Sensor_Glow", zone: "torso", paint: "lensGlow", glow: true, mesh: headGlow },
    P("Pack", "torso", "slate", "paint", pack),
    P("Ballast", "torso", "bone", "paint", ballast),
    P("Jets", "torso", "frame", "metal", jets, bare),
    P("Hoses", "torso", "black", "rubber", merge(rangeCable, ballastStraps), hose),
    P("Leg_L", "legs", "slate", "paint", mirrorX(merge(legShellR, kneeCap, thighPlate, outerPlates, foot))),
    P("Leg_R", "legs", "slate", "paint", merge(legShellR, kneeCap, shinGuard, outerPlates, foot)),
    P("Leg_Camo", "legs", "bone", "paint", merge(thighPlate, mirrorX(shinGuard))),
    P("Leg_Frame", "legs", "frame", "metal", merge(legFrameR, mirrorX(legFrameR), spade, mirrorX(spade)), bare),
    P("Leg_Rubber", "legs", "black", "rubber", merge(sole, legHoses, mirrorX(merge(sole, legHoses))), hose),
    P("Arm_L", "arms", "slate", "paint", merge(upperArm(SHOULDER_L, ELBOW_L, upperDirL), forearmL, pauldron(-1))),
    P("Arm_R", "arms", "slate", "paint", merge(upperArm(SHOULDER_R, ELBOW_R, upperDirR), forearmR)),
    P("Arm_Camo", "arms", "bone", "paint", merge(pauldron(1), forearmGuardL), { noHit: true }),
    P("Arm_Frame", "arms", "frame", "metal", armFrame, hose),
    P("Arm_Band", "arms", "accent", "paint", band, { noHit: true }),
    P("Arm_Rubber", "arms", "black", "rubber", merge(armHoses, rifleRubber), hose),
    P("Rifle", "arms", "bone", "paint", merge(stock, receiver, scopeHood, armature)),
    P("Rifle_Rails", "arms", "black", "metal", rails, bare),
    P("Rifle_Frame", "arms", "frame", "metal", rifleFrame, hose),
    P("Rifle_Weapon", "arms", "weapon", "paint", rifleWeapon, { noHit: true }),
    { name: "Rifle_Glow", zone: "arms", paint: "lensGlow", glow: true, noHit: true, mesh: rifleGlow },
  ];
}
// Three values well apart, and the two big ones outside the ground's band (moss, dirt and rust all sit near L* 30 to
// 53): a deep slate violet below it for the armour (L* 23), bone above it (L* 87), bare gunmetal between them for the
// joints and pistons (L* 41), so plates, joints and the light parts read as three steps in greyscale. Black (L* 13)
// is the rifle's rails and the rubber: the rails sit on the rifle's outline, where a mid grey would melt into the
// ground behind them.
const scheme = { slate: "#3A3058", bone: "#E2D8BC", frame: "#5A6168", black: "#202226", lensGlow: "#FF4D3D" };

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
const motionR = [
  piston("Knee_Piston_R", ["Leg_Frame"], ["thigh_R", KNEE_PISTON[0]], ["shin_R", KNEE_PISTON[1]], 0.08),
  piston("Calf_Ram_R", ["Leg_Frame"], ["shin_R", CALF_RAM[0]], ["foot_R", CALF_RAM[1]], 0.08),
];
const motion = [...motionR, ...motionR.map(leftOf), sway("Ballast", ["Ballast", "Hoses"], "body", [[0, 2.52, 0.6], BALLAST_AT], 0.3, "ballast")];
writeFileSync(join(root, "scripts/mechs/longshot.kit.json"), `${JSON.stringify({ scheme, parts: kitParts, motion }, null, 2)}\n`);
const totals = levels.map((l) => l.reduce((s, p) => s + triangles(p.mesh), 0));
console.log(`Wrote Mech_Longshot.glb to ${dir}: ${totals.join(" / ")} triangles (near / middle / far), ${totals[0]! + lodNodes.reduce((s, n) => s + triangles(n.mesh!), 0)} in the file`);
parts.forEach((p, i) => console.log(`  ${p.name.padEnd(13)} ${p.zone.padEnd(6)} ${p.paint.padEnd(12)} ${levels.map((l) => String(triangles(l[i]!.mesh)).padStart(5)).join(" ")}`));
