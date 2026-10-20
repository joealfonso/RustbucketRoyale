// Builds the Junk Titan (gate 13c), the roaming scrap boss: a giant about four mechs tall, welded together in the
// junkyard out of what was lying there. A shipping container laid across the shoulders is its chest, with a furnace
// burning behind a grate in the middle of it (the weak spot) and a stovepipe chimney behind the head. The head is the
// front end of a car, its headlights the glowing eyes and its bumper the jaw. A car upright and crosswise is the
// pelvis, a stack of tyres the waist, tractor tyres the shoulders. The legs are paired girders for thighs and big
// pipes for shins, with car doors bolted on as shin guards, standing on two crushed cars for feet. The right arm is a
// salvaged excavator boom with a scrapyard grapple for a hand, the one that picks up cars and throws them; the left is
// girders and a culvert pipe ending in an engine block for a fist, chained on.
// Every part is built in place on the assembled Titan (metres, Y up, facing -Z, right side +X, feet at y 0).
// Writes the model, the thrown car (its own small file) and scripts/mechs/titan.kit.json, the paint and zone of every
// part; scripts/merge-mech-kits.ts copies that into data/mechKits.json and scripts/make-hitboxes.ts measures it.
// Run: npx tsx scripts/mechs/titan.ts  →  assets/models/titan/Junk_Titan.glb and Junk_Car.glb
//
// The look: the silhouette is what sells it at 300 m, so the masses are few and big: the wide bar of the container
// and its two tyres, a small head poking forward, a chimney, two long arms (one with a car hanging under it) and two
// pillar legs. The parts keep the paint they came with, so the junk reads as junk: a faded blue container, a cream
// car and a red one, an excavator's yellow, bare iron girders. Wear is where it would be: the edge chips the master
// material already draws, rust as it is hurt, bright steel only where things turn or slide.
//
// Levels of detail: the same build runs three times. The nearest keeps the bevels, tyre lugs, container ribs, chains
// and pipe corrugations; the middle drops bevels, lugs and chains and keeps fewer ribs; the far one keeps the masses.
// The Titan is about four times a mech's size, so its levels should switch about four times farther out than a mech's
// (data/mechKits.json lodDistances are a mech's); that is the client's call.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { parseHardSurfaceLook } from "../assets/hardSurface";
import { bothLegs } from "./joints";
import { leftOf, piston } from "./motion";
import { box, convex, cylinder, empty, merge, mirrorX, prism, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

type UV = [number, number];
type Axis = "x" | "y" | "z";
type Level = 0 | 1 | 2;
type Size = [number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const mirrorPoint = (p: V3): V3 => [-p[0], p[1], p[2]];
// The part of `toward` square to `dir`, as a unit vector: "the side of this limb that faces that way".
const perp = (dir: V3, toward: V3): V3 => norm(sub(toward, scale(dir, dot(toward, dir))));
const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
const FRONT: V3 = [0, 0, -1];

// A point in an axis's own frame (u, v across it, w along it), as `prism` in shapes.ts maps them.
const onAxis = (axis: Axis, c: V3, u: number, v: number, w: number): V3 =>
  axis === "x" ? [c[0] + w, c[1] + u, c[2] + v] : axis === "y" ? [c[0] + v, c[1] + w, c[2] + u] : [c[0] + u, c[1] + v, c[2] + w];

// A solid through matching rings of points in order, capped at both ends. With `split`, side quads are cut in two so
// each face stays flat when neighbouring rings are not parallel (a dented car roof).
function loft(rings: V3[][], split = false): MeshData {
  const faces: V3[][] = [rings[0]!, rings.at(-1)!];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!, b = rings[r + 1]!;
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      if (split) faces.push([a[i]!, a[j]!, b[j]!], [a[i]!, b[j]!, b[i]!]);
      else faces.push([a[i]!, a[j]!, b[j]!, b[i]!]);
    }
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

// A rectangle round `centre`, `w` along `ex` and `h` along `ey`, its corners cut by `c` (an octagon) when c > 0.
function ring(centre: V3, ex: V3, ey: V3, w: number, h: number, c: number): V3[] {
  const hw = w / 2, hh = h / 2, k = Math.min(c, hw * 0.45, hh * 0.45);
  const uv: UV[] = k > 0.004
    ? [[-hw + k, -hh], [hw - k, -hh], [hw, -hh + k], [hw, hh - k], [hw - k, hh], [-hw + k, hh], [-hw, hh - k], [-hw, -hh + k]]
    : [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return uv.map(([u, v]) => add(centre, add(scale(ex, u), scale(ey, v))));
}

// A straight bar from a to b, [w, h] across it at a and `s1` at b (`w` along the axis nearest `side`), its long edges
// cut by `c`. Girders, booms and tines are these.
function bar(a: V3, b: V3, side: V3, s0: Size, s1: Size = s0, c = 0): MeshData {
  const [ex, ey] = across(norm(sub(b, a)), side);
  return loft([ring(a, ex, ey, s0[0], s0[1], c), ring(b, ex, ey, s1[0], s1[1], c)]);
}

// A round bar from `a` to `b` in any direction (a pipe, a ram, an axle), `rb` its radius at `b`.
function rod(a: V3, b: V3, r: number, sides: number, rb = r): MeshData {
  const d = norm(sub(b, a));
  const [u, v] = across(d, Math.abs(d[1]) < 0.9 ? Y : X);
  const circle = (c: V3, radius: number) => Array.from({ length: sides }, (_, i) => {
    const t = ((i + 0.5) / sides) * Math.PI * 2;
    return add(c, add(scale(u, Math.cos(t) * radius), scale(v, Math.sin(t) * radius)));
  });
  return loft([circle(a, r), circle(b, rb)]);
}

// A box from its min and max corners, which reads more easily than centre and size for stacked plating.
function boxAt(min: V3, max: V3, bevel = 0): MeshData {
  return box([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], [max[0] - min[0], max[1] - min[1], max[2] - min[2]], bevel);
}

const signedArea = (o: UV[]) => o.reduce((s, p, i) => { const q = o[(i + 1) % o.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

// A convex outline with every edge moved inward by `c`, corners kept sharp.
function inset(outline: UV[], c: number): UV[] {
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

// A convex outline swept along an axis, as `prism` in shapes.ts, with every edge chamfered by `c`.
function block(outline: UV[], axis: Axis, from: number, to: number, c = 0): MeshData {
  if (c <= 0) return prism(outline, axis, from, to);
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const small = inset(outline, c);
  const o: V3 = [0, 0, 0];
  const rings = ([[small, lo], [outline, lo + c], [outline, hi - c], [small, hi]] as [UV[], number][]).map(([pts, w]) => pts.map(([u, v]) => onAxis(axis, o, u, v, w)));
  return loft(rings);
}

// A tyre round `axis` through `c`: a drum whose shoulders are cut in, so it reads as rubber and not as a can. With
// `plain` (past 80 m, where the shoulders are under a pixel) just the drum.
function tyre(c: V3, axis: Axis, r: number, width: number, sides: number, plain = false): MeshData {
  const w = width / 2, s = Math.min(r * 0.16, w * 0.6);
  const circle = (radius: number, along: number) => Array.from({ length: sides }, (_, i) => {
    const t = ((i + 0.5) / sides) * Math.PI * 2;
    return onAxis(axis, c, Math.cos(t) * radius, Math.sin(t) * radius, along);
  });
  return loft(plain ? [circle(r - s / 2, -w), circle(r - s / 2, w)] : [circle(r - s, -w), circle(r, -w + s), circle(r, w - s), circle(r - s, w)]);
}

// The lugs on a tractor tyre's tread round the X axis, slanted alternately left and right in a chevron, `count`
// round it. They are what tells a tractor tyre from a car's, from far off as a toothed edge on the shoulder.
function lugs(c: V3, r: number, width: number, count: number): MeshData {
  return merge(...Array.from({ length: count }, (_, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const lug = turn(box([side * width * 0.2, r + 0.04, 0], [width * 0.5, 0.12, 0.2]), [0, side * 0.5, 0]);
    return turn(lug, [((i + 0.5) / count) * Math.PI * 2, 0, 0], [0, 0, 0], c);
  }));
}

// A chain from `a` to `b`: links `pitch` apart, each turned a quarter round from the last, as real links hang.
function chain(a: V3, b: V3, pitch: number, size: number): MeshData {
  const d = norm(sub(b, a)), [u, v] = across(d, X);
  const count = Math.max(1, Math.round(Math.hypot(...sub(b, a)) / pitch));
  return merge(...Array.from({ length: count }, (_, i) => {
    const centre = lerp(a, b, (i + 0.5) / count);
    const flat = i % 2 === 0 ? u : v;
    return loft([ring(sub(centre, scale(d, pitch * 0.62)), flat, cross(d, flat), size, size * 0.35, 0), ring(add(centre, scale(d, pitch * 0.62)), flat, cross(d, flat), size, size * 0.35, 0)]);
  }));
}

// A girder with an I section from a to b: two flanges `fw` wide across `side`'s square and a web between them, `d`
// deep along `deep`. Past 80 m it is one bar of the same size.
function girder(a: V3, b: V3, deep: V3, fw: number, d: number, far: boolean): MeshData {
  const dir = norm(sub(b, a)), [ex, ey] = across(dir, cross(deep, dir));
  if (far) return bar(a, b, ex, [fw, d]);
  const ft = d * 0.14;
  const flange = (s: number) => bar(add(a, scale(ey, s * (d - ft) / 2)), add(b, scale(ey, s * (d - ft) / 2)), ex, [fw, ft]);
  return merge(flange(1), flange(-1), bar(a, b, ex, [fw * 0.28, d - 2 * ft]));
}

// A car, built along Z (front -Z), centred on x = z = 0 with its tyres on y = 0. The Titan wears three (a pelvis and
// two crushed feet) and throws a fourth. `squash` is how much of the cabin's height is left; `wreck` dents the roof,
// stoves in the bonnet, bends the front bumper down and loses the front left wheel, so a thrown car reads as junk.
interface Car { body: MeshData; glass: MeshData; trim: MeshData; tyres: MeshData }
const CAR = { length: 4.0, width: 1.8, wheel: 0.32 };
function car(lv: Level, squash: number, wreck: boolean): Car {
  const near = lv === 0, far = lv === 2;
  const { length: L, width: W, wheel: R } = CAR;
  const hl = L / 2, hw = W / 2;
  const top = 0.82, cabin = 0.52 * squash;
  // The body's side outline in (y, z): sill, a squared boot, the bonnet sloping to the nose. A wreck's bonnet is
  // stoved in, lower at the nose.
  const nose = wreck ? 0.56 : 0.68, bonnet = wreck ? -hl + 0.7 : -hl + 0.3;
  const side: UV[] = [[0.22, -hl + 0.12], [0.22, hl - 0.12], [0.32, hl], [0.74, hl], [top, hl - 0.22], [top, bonnet], [nose, -hl], [0.32, -hl]];
  const body = merge(
    block(side, "x", -hw, hw, near ? 0.05 : 0),
    // A wreck's boot lid sprung open, standing up off the back.
    wreck && !far ? turn(boxAt([-hw + 0.08, top, hl - 0.75], [hw - 0.08, top + 0.05, hl - 0.05]), [-0.6, 0, 0], [0, top, hl - 0.75]) : empty(),
  );
  // The cabin is the glass; the roof and the pillar between the doors are body panels laid over it.
  const zb: UV = [-0.5, 0.95], zt: UV = [-0.12, 0.7];
  const dent = wreck ? 0.14 : 0;
  const yt = top + cabin;
  const cabinBottom: V3[] = [[-hw + 0.1, top, zb[0]], [hw - 0.1, top, zb[0]], [hw - 0.1, top, zb[1]], [-hw + 0.1, top, zb[1]]];
  const cabinTop: V3[] = [[-hw + 0.16, yt, zt[0]], [hw - 0.16, yt - dent, zt[0]], [hw - 0.16, yt - dent, zt[1]], [-hw + 0.16, yt, zt[1]]];
  const glass = loft([cabinBottom, cabinTop], wreck);
  const roofTilt = Math.atan2(dent, W - 0.32);
  const roof = turn(boxAt([-hw + 0.13, yt - 0.02, zt[0] - 0.06], [hw - 0.13, yt + 0.06, zt[1] + 0.06]), [0, 0, -roofTilt], [0, yt, 0]);
  const pillar = far ? empty() : boxAt([-hw + 0.08, top, 0.12], [hw - 0.08, yt - dent - 0.01, 0.26]);
  // Bumpers front and back; a wreck's front one hangs off at one end. Headlights and tail lights are trim too: on a
  // car that is not driving they are only glass and chrome.
  const frontBumper = boxAt([-hw + 0.04, 0.26, -hl - 0.1], [hw - 0.04, 0.44, -hl + 0.04], near ? 0.03 : 0);
  const lights = near ? merge(...[1, -1].flatMap((s) => [
    boxAt([s * (hw - 0.42) - 0.16, 0.52, -hl - 0.02], [s * (hw - 0.42) + 0.16, 0.64, -hl + 0.02]),
    boxAt([s * (hw - 0.3) - 0.14, 0.56, hl - 0.02], [s * (hw - 0.3) + 0.14, 0.68, hl + 0.02]),
  ])) : empty();
  const wheelAt = (x: number, z: number): V3 => [x * (hw - 0.12), R, z * 1.3];
  const wheels = ([[1, 1], [-1, 1], [1, -1], [-1, -1]] as const).filter(([x, z]) => !(wreck && x === -1 && z === -1));
  const tyreSides = [12, 8, 6][lv]!;
  const trim = merge(
    wreck ? turn(frontBumper, [0, 0, 0.2], [hw - 0.04, 0.35, -hl]) : frontBumper,
    boxAt([-hw + 0.04, 0.26, hl - 0.04], [hw - 0.04, 0.44, hl + 0.1], near ? 0.03 : 0),
    lights,
    // Hubs, and on a wreck the bare brake drum where the lost wheel was.
    ...(far ? [] : ([[1, 1], [-1, 1], [1, -1], [-1, -1]] as const).map(([x, z]) => cylinder(add(wheelAt(x, z), [x * 0.02, 0, 0]), R * 0.52, 0.3, "x", tyreSides))),
  );
  const tyres = merge(...wheels.map(([x, z]) => tyre(wheelAt(x, z), "x", R, 0.26, tyreSides, far)));
  return { body: merge(body, roof, pillar), glass, trim, tyres };
}

// Moves a car (or any part of one) into place, turned `yaw` about Y.
const placeCar = (m: MeshData, yaw: number, at: V3) => turn(m, [0, yaw, 0], [0, 0, 0], at);

// ---- Fixed points the game reads. They are the same at every level of detail.
// Leg joints, right side: a person's leg, the knee ahead of the line from hip to ankle so it bends forward, and the
// ankle over the back third of a crushed car, which runs forward from it to the toe. The car sits well forward of
// the ankle, so its rear wheels lie nearer the foot's bone than the shin's and turn with the foot when the leg rig
// cuts the legs (packages/client/src/legRig.ts).
const LX = 1.7;
const HIP: V3 = [LX, 5.3, 0.25], KNEE: V3 = [LX, 3.15, -0.45], ANKLE: V3 = [LX, 1.45, 0.75], TOE: V3 = [LX, 0.45, -2.75];
const FOOT_CAR_Z = -0.85;
// The upper body (the container and everything on it: the head, the chimney, the shoulder tyres) is built upright
// and then leaned forward about the waist, a brute's hunch, so the head and the fire come forward over the legs.
// From the side the upright build read as a table on legs.
const LEAN = -0.14; // radians about X; negative tips the top toward the front
const WAIST: V3 = [0, 7.3, 0.2];
const leanMesh = (m: MeshData) => turn(m, [LEAN, 0, 0], WAIST);
const lean = (p: V3): V3 => leanMesh({ positions: [...p], normals: [0, 1, 0], indices: [] }).positions as V3;
// The arms. Long, so the hands hang near the knees: a gorilla's reach reads as strength from any distance. They
// hang from the leaned shoulders.
const SHOULDER_UP: V3 = [3.4, 9.0, 0.22];
const SHOULDER_R: V3 = add(lean(SHOULDER_UP), [0.7, 0, 0]), ELBOW_R: V3 = [4.35, 5.95, 0.75], WRIST_R: V3 = [4.45, 3.75, -0.9];
const SHOULDER_L = mirrorPoint(SHOULDER_R), ELBOW_L: V3 = [-4.4, 6.05, 0.55], WRIST_L: V3 = [-4.5, 3.55, -0.55];
// Where a held car sits in the grapple and where a thrown one leaves from: the middle of the car model
// (Junk_Car.glb, built round its own middle, front -Z), so the client puts the car here unturned.
const HAND: V3 = [4.45, 2.25, -0.9];
// The container across the shoulders, and the furnace in its middle.
const BOX = { x: 3.03, y0: 7.3, y1: 9.9, z0: -1.0, z1: 1.44, front: -0.55 };
const CORE_UP: V3 = [0, 8.5, -0.82];
const OPENING = { x: 0.8, y0: 7.85, y1: 9.15 };
// The chimney's mouth, where the furnace's smoke comes out.
const SMOKE_UP: V3 = [-1.9, 12.0, 0.75];
const CORE = lean(CORE_UP), SMOKE = lean(SMOKE_UP), NECK = lean([0, 9.9, -0.9]);
// The knee rams' mounts (moving, as on the mechs): the sleeve on the front of the thigh, the rod on the front of the
// shin below the knee and above its door, so the rod slides out as the knee bends.
const thighDir = norm(sub(KNEE, HIP)), shinDir = norm(sub(ANKLE, KNEE));
const thighFront = perp(thighDir, FRONT), shinFront = perp(shinDir, FRONT);
const RAM: [V3, V3] = [add(lerp(HIP, KNEE, 0.3), scale(thighFront, 0.78)), add(lerp(KNEE, ANKLE, 0.14), scale(shinFront, 0.88))];

type Zone = "legs" | "arms" | "torso";
type Finish = "paint" | "metal" | "rubber";
// `noHit`: lies inside another part's box, or spans the body and would stretch one box across it.
interface Part { name: string; zone: Zone; paint: string; finish?: Finish; glow?: true; rusts?: false; noHit?: true; mesh: MeshData }

function build(lv: Level): Part[] {
  const near = lv === 0, far = lv === 2;
  const only = (make: () => MeshData) => (near ? make() : empty()); // small detail, nearest level only
  const notFar = (make: () => MeshData) => (far ? empty() : make());
  const bev = (b: number) => (near ? b : 0);
  const sides = (n: number) => [n, Math.max(6, Math.round(n * 0.6)), Math.max(5, Math.round(n * 0.35))][lv]!;

  // ---- Torso: the container. Its front is cut open round the furnace, so the front is four panels round a hole and
  // the box behind is set back; the ribs are a container's corrugation, and the rails and corner castings its frame.
  const { x: bx, y0, y1, z0, z1, front } = BOX;
  const panels = merge(
    boxAt([-bx, y0, z0], [-OPENING.x, y1, front], bev(0.06)),
    boxAt([OPENING.x, y0, z0], [bx, y1, front], bev(0.06)),
    boxAt([-OPENING.x, OPENING.y1, z0], [OPENING.x, y1, front], bev(0.04)),
    boxAt([-OPENING.x, y0, z0], [OPENING.x, OPENING.y0, front], bev(0.04)),
  );
  const ribEvery = [0.42, 0.84, 0][lv]!;
  const ribs: MeshData[] = [];
  if (ribEvery > 0) {
    for (let x = -bx + 0.35; x < bx - 0.3; x += ribEvery) {
      ribs.push(boxAt([x - 0.07, y0 + 0.16, z1], [x + 0.07, y1 - 0.16, z1 + 0.06])); // the back
      if (Math.abs(x) > OPENING.x + 0.15) ribs.push(boxAt([x - 0.07, y0 + 0.16, z0 - 0.06], [x + 0.07, y1 - 0.16, z0])); // the front
    }
  }
  // The frame a container is lifted by: rails along the top and bottom edges, a casting at each corner.
  const rails = notFar(() => merge(...[y0 + 0.08, y1 - 0.08].flatMap((y) => [z0 - 0.04, z1 + 0.04].map((z) => boxAt([-bx, y - 0.1, z - 0.06], [bx, y + 0.1, z + 0.06])))));
  const castings = only(() => merge(...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => {
    const corner: V3 = [sx * bx, sy < 0 ? y0 : y1, sz < 0 ? z0 : z1];
    return box([corner[0] - sx * 0.14, corner[1] - sy * 0.11, corner[2] - sz * 0.07], [0.34, 0.28, 0.3]);
  })))));
  const container = merge(boxAt([-bx, y0, front], [bx, y1, z1], bev(0.06)), panels, ...ribs, rails, castings);
  // A car bonnet welded over the back where the container had rusted through, low down where the water stood.
  const patch = turn(boxAt([-1.5, y0 + 0.3, z1 + 0.06], [-0.1, y0 + 1.35, z1 + 0.13], bev(0.02)), [0, 0, 0.06], [-0.8, y0 + 0.8, z1]);

  // The furnace: the firebox's round mouth set into the hole, the fire behind a grate of bars that holds the burning
  // junk in. The glow is a part of its own: the weak spot, flat lit, and dark when the torso breaks.
  const furnace = merge(
    cylinder([CORE_UP[0], CORE_UP[1], -0.675], 0.72, 0.25, "z", sides(20)), // the firebox mouth, its rim round the fire
    ...[-0.54, -0.18, 0.18, 0.54].map((x) => boxAt([x - 0.065, OPENING.y0, -0.97], [x + 0.065, OPENING.y1, -0.84])),
    notFar(() => boxAt([-OPENING.x, CORE_UP[1] - 0.06, -0.95], [OPENING.x, CORE_UP[1] + 0.06, -0.85])), // the cross bar
  );
  const core = cylinder(CORE_UP, 0.6, 0.04, "z", sides(20));
  // The flue: a stovepipe out of the container's top behind the head, a collar where it goes through the roof and a
  // rain cap on three legs at the top, open underneath so the smoke has a way out.
  const [cx, smokeY, cz] = SMOKE_UP;
  const chimney = merge(
    rod([cx, y1 - 0.1, cz], [cx, smokeY - 0.1, cz], 0.42, sides(12)),
    notFar(() => cylinder([cx, y1 + 0.08, cz], 0.58, 0.16, "y", sides(12))),
    cylinder([cx, smokeY + 0.24, cz], 0.72, 0.26, "y", sides(12), 0.14),
    only(() => merge(...[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2; return rod([cx + Math.cos(a) * 0.36, smokeY - 0.2, cz + Math.sin(a) * 0.36], [cx + Math.cos(a) * 0.52, smokeY + 0.13, cz + Math.sin(a) * 0.52], 0.05, 5); }))),
  );

  // ---- Head: the front end of a car, cut off at the windscreen and sat on the container's front edge, hunched
  // forward. The headlights are the eyes and the bonnet lid, sprung and bent down at the front, is the brow over
  // them; the grille is the mouth and the bumper the jaw.
  const headSide: UV[] = [[9.6, -2.05], [9.6, -0.55], [10.55, -0.55], [10.8, -0.85], [10.8, -1.55], [10.45, -2.05]]; // (y, z)
  const head = merge(
    block(headSide, "x", -0.85, 0.85, bev(0.06)),
    turn(boxAt([-0.9, 10.78, -2.2], [0.9, 10.86, -0.9], bev(0.02)), [-0.32, 0, 0], [0, 10.82, -0.9]), // the brow
    // The stubs of the windscreen pillars, where the car was cut: what says this was the front of a car.
    notFar(() => merge(...[1, -1].map((s) => bar([s * 0.78, 10.74, -0.86], [s * 0.7, 11.18, -0.6], X, [0.12, 0.14])))),
  );
  const eyes = merge(...[1, -1].map((s) => cylinder([s * 0.52, 10.12, -2.09], 0.2, 0.06, "z", sides(12))));
  const headTrim = merge(
    boxAt([-0.96, 9.52, -2.24], [0.96, 9.76, -1.96], bev(0.03)), // the bumper jaw
    notFar(() => merge(...[1, -1].map((s) => cylinder([s * 0.52, 10.12, -2.07], 0.27, 0.05, "z", sides(12))))), // headlight bezels
    only(() => merge(...[9.84, 9.97, 10.1].map((y) => boxAt([-0.32, y - 0.025, -2.1], [0.32, y + 0.025, -2.05])))), // grille bars
  );
  const grille = boxAt([-0.34, 9.78, -2.08], [0.34, 10.18, -2.03]);

  // ---- Pelvis: a car upright and crosswise, nose to the right. The hips hang under it on two drums on an axle.
  const pelvisCar = car(lv, 1, false);
  const pelvisAt: V3 = [0, 5.23, 0.2];
  const pelvis = (m: MeshData) => placeCar(m, -Math.PI / 2, pelvisAt);
  const hipDrums = merge(
    ...[1, -1].map((s) => rod([s * 0.95, HIP[1], HIP[2]], [s * 2.35, HIP[1], HIP[2]], 0.42, sides(14))),
    // The clamps that hang each drum from the car's floor.
    only(() => merge(...[1, -1].flatMap((s) => [1.08, 2.22].map((x) => merge(
      cylinder([s * x, HIP[1], HIP[2]], 0.48, 0.14, "x", 14),
      boxAt([s * x - 0.07, HIP[1] + 0.3, HIP[2] - 0.3], [s * x + 0.07, 5.5, HIP[2] + 0.3]),
    ))))),
  );
  // The waist: two tyres stacked on the pelvis car's roof, the spine's give, and chains from the container's front
  // corners down to the pelvis car hold the two halves together.
  const roofY = 5.23 + 0.82 + 0.52 + 0.06;
  const waist = merge(tyre([-0.1, roofY + 0.17, 0.2], "y", 0.88, 0.34, sides(18), far), tyre([0.06, roofY + 0.51, 0.24], "y", 0.86, 0.34, sides(18), far));
  const chestChains = near
    ? merge(...[1, -1].map((s) => chain(lean([s * 1.5, y0 + 0.02, -0.85]), [s * 1.62, 6.0, -0.78], 0.27, 0.15)))
    : merge(...[1, -1].map((s) => rod(lean([s * 1.5, y0 + 0.02, -0.85]), [s * 1.62, 6.0, -0.78], 0.06, 4)));

  // ---- Shoulders: a tractor tyre on each end of the container round a steel wheel, the arms hung outside them.
  const shoulderAt = (s: number): V3 => [s * SHOULDER_UP[0], SHOULDER_UP[1], SHOULDER_UP[2]];
  const shoulder = (s: number) => merge(tyre(shoulderAt(s), "x", 1.15, 0.72, sides(22), far), near ? lugs(shoulderAt(s), 1.15, 0.72, 16) : empty());
  const rims = merge(...[1, -1].map((s) => cylinder(shoulderAt(s), 0.6, 0.8, "x", sides(14))));

  // ---- Right arm: an excavator's boom and stick, still in the faded yellow it came in. The boom bends at a knuckle
  // as a real one does; the boom ram lifts it from a bracket on the container, the stick ram on its back swings the
  // stick, and both rams' hoses run up the boom.
  const KNUCKLE: V3 = [4.25, 7.55, 0.7];
  const boomUp = norm(sub(KNUCKLE, SHOULDER_R)), stickDir = norm(sub(WRIST_R, ELBOW_R));
  const heel = sub(ELBOW_R, scale(stickDir, 0.55)); // the stick runs on past the elbow, where its ram pulls
  const boom = merge(
    bar(add(SHOULDER_R, [0, 0.35, -0.05]), KNUCKLE, X, [0.86, 1.15], [0.76, 1.02], bev(0.07)),
    bar(KNUCKLE, ELBOW_R, X, [0.76, 1.02], [0.62, 0.8], bev(0.06)),
  );
  const stick = bar(heel, add(WRIST_R, [0, 0.15, 0]), X, [0.66, 0.76], [0.54, 0.56], bev(0.05));
  const boomBack = perp(boomUp, [0, 0, 1]);
  const liftRam = { from: lean([3.25, 7.45, -0.62]), to: add(lerp(SHOULDER_R, KNUCKLE, 0.85), scale(perp(boomUp, FRONT), 0.5)) };
  const stickRam = { from: add(lerp(SHOULDER_R, KNUCKLE, 0.35), scale(boomBack, 0.62)), to: add(heel, scale(perp(stickDir, [0, 0, 1]), 0.3)) };
  const ram = (a: V3, b: V3, r: number) => merge(rod(a, lerp(a, b, 0.6), r, sides(10)), rod(lerp(a, b, 0.5), b, r * 0.5, sides(8)));
  const armFrameR = merge(
    rod([3.0, SHOULDER_R[1], SHOULDER_R[2]], [4.5, SHOULDER_R[1], SHOULDER_R[2]], 0.3, sides(12)), // shoulder pin
    rod([3.95, ELBOW_R[1], ELBOW_R[2]], [4.75, ELBOW_R[1], ELBOW_R[2]], 0.22, sides(10)), // elbow pin
    ram(liftRam.from, liftRam.to, 0.2),
    ram(stickRam.from, stickRam.to, 0.17),
    notFar(() => leanMesh(boxAt([3.02, 7.2, -0.85], [3.4, 7.7, -0.4], bev(0.03)))), // the lift ram's bracket on the container
  );
  const armHosesR = notFar(() => merge(
    rod(add(liftRam.from, [0.12, 0.2, 0.15]), add(lerp(SHOULDER_R, KNUCKLE, 0.4), add(scale(boomBack, 0.5), [0.2, 0, 0])), 0.07, 6),
    rod(add(lerp(SHOULDER_R, KNUCKLE, 0.4), add(scale(boomBack, 0.5), [0.2, 0, 0])), add(lerp(KNUCKLE, ELBOW_R, 0.6), add(scale(boomBack, 0.4), [0.2, 0, 0])), 0.07, 6),
  ));
  // The hand: a scrapyard grapple on a rotator. A crossbar along the car's length carries four tines, two a side,
  // that close round a car's sides and hook under its sills: the hand reads as holding a car because it is shaped
  // round one, whether or not a car is in it.
  const [hx, , hz] = HAND;
  const tineSize: Size = [0.24, 0.15];
  const tine = (s: number, z: number) => {
    const p0: V3 = [hx + s * 0.18, 3.32, z], p1: V3 = [hx + s * 1.14, 3.06, z], p2: V3 = [hx + s * 1.12, 1.98, z], p3: V3 = [hx + s * 0.84, 1.58, z];
    return far
      ? merge(bar(p0, p1, Z, tineSize), bar(p1, p3, Z, tineSize))
      : merge(bar(p0, p1, Z, tineSize, tineSize, bev(0.03)), bar(p1, p2, Z, tineSize, tineSize, bev(0.03)), bar(p2, p3, Z, tineSize, [0.2, 0.1], bev(0.03)));
  };
  const hand = merge(
    cylinder([hx, 3.62, hz], 0.36, 0.4, "y", sides(12)), // rotator
    boxAt([hx - 0.24, 3.18, hz - 1.08], [hx + 0.24, 3.44, hz + 1.08], bev(0.03)), // crossbar
    ...[hz - 0.9, hz + 0.9].flatMap((z) => [tine(1, z), tine(-1, z)]),
    only(() => merge(...[hz - 0.9, hz + 0.9].map((z) => rod([hx - 0.34, 3.32, z], [hx + 0.34, 3.32, z], 0.09, 8)))), // the tines' hinge pins
  );
  // A ram to each tine from the rotator, the push that closes it on a car.
  const handRams = notFar(() => merge(...[hz - 0.9, hz + 0.9].flatMap((z) => [1, -1].map((s) => ram([hx + s * 0.2, 3.72, hz + (z - hz) * 0.35], [hx + s * 0.98, 3.2, z], 0.1)))));

  // ---- Left arm: two girders for the upper arm, a car tyre on the elbow where it knocks on things, a culvert pipe
  // for the forearm and an engine block for a fist, chained to the pipe's end. The block hangs head down: its
  // cylinder head and the exhaust stubs are the knuckles.
  const upperArmL = merge(...[0.34, -0.34].map((dz) => girder(add(SHOULDER_L, [-0.05, 0.3, dz]), add(ELBOW_L, [0, 0, dz]), X, 0.4, 0.66, far)));
  const strapsL = notFar(() => merge(...[0.3, 0.72].map((t) => bar(lerp(SHOULDER_L, ELBOW_L, t), lerp(SHOULDER_L, ELBOW_L, t + 0.07), X, [0.78, 1.26]))));
  const forearmDir = norm(sub(WRIST_L, ELBOW_L));
  const forearmL = merge(
    rod(sub(ELBOW_L, scale(forearmDir, 0.2)), WRIST_L, 0.56, sides(16)),
    ...(near ? [0.18, 0.36, 0.54, 0.72].map((t) => rod(lerp(ELBOW_L, WRIST_L, t - 0.025), lerp(ELBOW_L, WRIST_L, t + 0.025), 0.62, 16)) : []), // corrugation
    notFar(() => rod(sub(WRIST_L, scale(forearmDir, 0.12)), WRIST_L, 0.66, sides(16))), // the end flange the chains bite on
  );
  const fistAt: V3 = [WRIST_L[0], 2.75, WRIST_L[2] - 0.1];
  const fist = merge(
    box(fistAt, [1.15, 1.2, 1.6], bev(0.06)), // block
    box(add(fistAt, [0, -0.7, 0]), [1.0, 0.2, 1.5], bev(0.03)), // cylinder head
    notFar(() => box(add(fistAt, [0, -0.88, 0]), [0.62, 0.16, 1.3], bev(0.04))), // valve cover
    cylinder(add(fistAt, [0, 0.05, 0.86]), 0.6, 0.14, "z", sides(16)), // flywheel
    only(() => merge(...[-0.54, -0.18, 0.18, 0.54].map((dz) => rod(add(fistAt, [-0.56, -0.45, dz]), add(fistAt, [-0.82, -0.62, dz]), 0.07, 6)))), // exhaust stubs
  );
  const elbowTyreL = tyre([ELBOW_L[0] - 0.3, ELBOW_L[1], ELBOW_L[2]], "x", 0.6, 0.42, sides(16), far);
  const armFrameL = merge(
    rod([-3.0, SHOULDER_L[1], SHOULDER_L[2]], [-4.45, SHOULDER_L[1], SHOULDER_L[2]], 0.3, sides(12)), // shoulder pin
    rod([-3.95, ELBOW_L[1], ELBOW_L[2]], [-4.95, ELBOW_L[1], ELBOW_L[2]], 0.24, sides(10)), // elbow axle
  );
  const fistChains = near
    ? merge(...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const a = (i / 8) * Math.PI * 2, b = ((i + 1) / 8) * Math.PI * 2;
      const [u, v] = across(forearmDir, X);
      const at = (t: number) => add(add(WRIST_L, scale(forearmDir, -0.25)), add(scale(u, Math.cos(t) * 0.63), scale(v, Math.sin(t) * 0.63)));
      return chain(at(a), at(b), 0.25, 0.13);
    }), ...[-0.4, 0.4].map((dx) => chain(add(WRIST_L, [dx, -0.1, 0.2]), add(fistAt, [dx * 1.2, 0.3, 0.55]), 0.25, 0.13)))
    : notFar(() => merge(...[-0.4, 0.4].map((dx) => rod(add(WRIST_L, [dx, -0.1, 0.2]), add(fistAt, [dx * 1.2, 0.3, 0.55]), 0.06, 4))));

  // ---- Legs, right side, then mirrored. Leg pieces are cut apart at the joints by which bone each shape sits nearest
  // (legRig.ts), so nothing here straddles a joint: the knee ram is a sleeve on the thigh and a rod on the shin, and
  // a joint's own drum sits 2 cm up its bone so which piece it rides is never a coin toss.
  const kneeAt = add(KNEE, scale(thighDir, -0.02)), ankleAt = add(ANKLE, scale(shinDir, -0.02));
  // Thigh: two girders side by side, strapped together top and bottom.
  const thighR = merge(
    ...[0.36, -0.36].map((dx) => girder(add(HIP, [dx, 0.1, 0]), add(KNEE, [dx, 0, 0]), Z, 0.52, 1.0, far)),
    notFar(() => merge(...[0.25, 0.7].map((t) => bar(lerp(HIP, KNEE, t), lerp(HIP, KNEE, t + 0.08), X, [1.36, 1.1])))),
  );
  // Shin: a big steel pipe with a bolting flange at each end, and a car door bolted on the front as a guard.
  const shinR = merge(
    rod(add(KNEE, scale(shinDir, 0.15)), ANKLE, 0.66, sides(16)),
    notFar(() => rod(lerp(KNEE, ANKLE, 0.08), lerp(KNEE, ANKLE, 0.14), 0.8, sides(16))),
    notFar(() => rod(lerp(KNEE, ANKLE, 0.84), lerp(KNEE, ANKLE, 0.9), 0.8, sides(16))),
  );
  const doorR = merge(
    bar(add(lerp(KNEE, ANKLE, 0.2), scale(shinFront, 0.71)), add(lerp(KNEE, ANKLE, 0.78), scale(shinFront, 0.71)), X, [1.24, 0.1], [1.24, 0.1], bev(0.03)),
    only(() => bar(add(lerp(KNEE, ANKLE, 0.62), add(scale(shinFront, 0.78), [0.34, 0, 0])), add(lerp(KNEE, ANKLE, 0.66), add(scale(shinFront, 0.78), [0.34, 0, 0])), X, [0.26, 0.05])), // its handle
  );
  const legFrameR = merge(
    rod([LX - 0.72, kneeAt[1], kneeAt[2]], [LX + 1.08, kneeAt[1], kneeAt[2]], 0.26, sides(12)), // knee axle
    notFar(() => cylinder([LX - 0.74, kneeAt[1], kneeAt[2]], 0.46, 0.1, "x", sides(12))), // hub cap inside the knee
    rod([LX - 0.5, ankleAt[1], ankleAt[2]], [LX + 0.5, ankleAt[1], ankleAt[2]], 0.38, sides(12)), // ankle drum
    notFar(() => ram(RAM[0], RAM[1], 0.15)), // knee ram
    // The plate the shin is welded to on the crushed car's roof.
    boxAt([LX - 0.55, 1.12, 0.1], [LX + 0.55, 1.24, 1.05], bev(0.02)),
  );
  const kneeTyreR = tyre([LX + 0.86, kneeAt[1], kneeAt[2]], "x", 0.82, 0.42, sides(18), far);
  // Foot: a crushed car, nose forward, its cabin flattened by the weight on it.
  const footCar = car(lv, 0.42, false);
  const foot = (m: MeshData) => placeCar(m, 0, [LX, 0, FOOT_CAR_Z]);
  const footR = { body: foot(footCar.body), glass: foot(footCar.glass), trim: foot(footCar.trim), tyres: foot(footCar.tyres) };

  const P = (name: string, zone: Zone, paint: string, finish: Finish, mesh: MeshData, extra: Partial<Part> = {}): Part =>
    ({ name, zone, paint, finish, ...extra, mesh });
  const bare = { rusts: false } as const, inside = { noHit: true } as const, bareInside = { rusts: false, noHit: true } as const;
  return [
    P("Torso", "torso", "container", "paint", leanMesh(container)),
    P("Furnace", "torso", "iron", "metal", leanMesh(furnace)),
    { name: "Furnace_Core", zone: "torso", paint: "fire", glow: true, mesh: leanMesh(core) },
    P("Chimney", "torso", "rust", "metal", leanMesh(chimney)),
    P("Head", "torso", "carCream", "paint", leanMesh(head)),
    P("Torso_Patch", "torso", "carRed", "paint", leanMesh(patch), inside),
    P("Head_Trim", "torso", "steel", "metal", leanMesh(headTrim), bareInside),
    P("Head_Grille", "torso", "iron", "metal", leanMesh(grille), inside),
    { name: "Eyes", zone: "torso", paint: "eyes", glow: true, noHit: true, mesh: leanMesh(eyes) },
    P("Pelvis", "torso", "carRed", "paint", pelvis(pelvisCar.body)),
    P("Pelvis_Trim", "torso", "steel", "metal", merge(pelvis(pelvisCar.trim), hipDrums), bare),
    P("Torso_Glass", "torso", "glass", "metal", pelvis(pelvisCar.glass), bareInside),
    P("Torso_Rubber", "torso", "rubber", "rubber", merge(waist, pelvis(pelvisCar.tyres))),
    P("Torso_Chains", "torso", "iron", "metal", chestChains, inside),
    P("Shoulder_R", "arms", "rubber", "rubber", leanMesh(shoulder(1))),
    P("Shoulder_L", "arms", "rubber", "rubber", leanMesh(shoulder(-1))),
    P("Shoulder_Rims", "arms", "steel", "metal", leanMesh(rims), bareInside),
    P("Arm_R", "arms", "excavator", "paint", boom),
    P("Forearm_R", "arms", "excavator", "paint", stick),
    P("Arm_R_Frame", "arms", "steel", "metal", merge(armFrameR, handRams), bareInside),
    P("Arm_R_Hoses", "arms", "rubber", "rubber", armHosesR, inside),
    P("Hand_R", "arms", "iron", "metal", hand),
    P("Arm_L", "arms", "iron", "metal", merge(upperArmL, strapsL)),
    P("Forearm_L", "arms", "pipe", "metal", forearmL),
    P("Fist_L", "arms", "iron", "metal", fist),
    P("Arm_L_Tyre", "arms", "rubber", "rubber", elbowTyreL),
    P("Arm_L_Frame", "arms", "steel", "metal", armFrameL, bareInside),
    P("Arm_L_Chains", "arms", "iron", "metal", fistChains, inside),
    P("Leg_R", "legs", "iron", "metal", thighR),
    P("Leg_L", "legs", "iron", "metal", mirrorX(thighR)),
    P("Shin_R", "legs", "pipe", "metal", shinR),
    P("Shin_L", "legs", "pipe", "metal", mirrorX(shinR)),
    // Each door came off a different car from the foot below it, so the two legs never read as copies.
    P("Door_R", "legs", "carRed", "paint", doorR),
    P("Door_L", "legs", "carCream", "paint", mirrorX(doorR)),
    P("Leg_Frame_R", "legs", "steel", "metal", legFrameR, bareInside),
    P("Leg_Frame_L", "legs", "steel", "metal", mirrorX(legFrameR), bareInside),
    P("Knee_Tyre_R", "legs", "rubber", "rubber", kneeTyreR),
    P("Knee_Tyre_L", "legs", "rubber", "rubber", mirrorX(kneeTyreR)),
    P("Foot_R", "legs", "carCream", "paint", footR.body),
    P("Foot_L", "legs", "carRed", "paint", mirrorX(footR.body)),
    P("Foot_Trim", "legs", "steel", "metal", merge(footR.trim, mirrorX(footR.trim)), bareInside),
    P("Foot_Glass", "legs", "glass", "metal", merge(footR.glass, mirrorX(footR.glass)), bareInside),
    P("Foot_Tyres", "legs", "rubber", "rubber", merge(footR.tyres, mirrorX(footR.tyres)), inside),
  ];
}

// The junk's own colours. Light: the cream car and the excavator's yellow. Mid: the faded container blue, the red
// car, galvanised pipe and bare steel. Dark: rusted iron, rubber and glass. The fire and the headlights are the only
// lit colours, both warm, and nothing else on it is near their hue. The container's blue is the one cool mass, so
// the chest reads as a block apart from the rust and moss of the yard.
const scheme = {
  container: "#4A7896", carCream: "#DCCFA8", carRed: "#A23B2C", excavator: "#D9A324", iron: "#3B3633", pipe: "#7F8A8E",
  steel: "#9AA1A4", rust: "#C4622D", rubber: "#1F2123", glass: "#2B3438", fire: "#FF8A2A", eyes: "#FFC93C",
};

const markers: NodeData[] = [
  // Where a held car sits and a thrown one leaves from (the car model's middle).
  { name: "Mount_Hand", translation: HAND },
  // The middle of the glowing furnace, the weak spot, and the chimney's mouth, where its smoke comes out.
  { name: "Mount_Core", translation: CORE },
  { name: "Mount_Smoke", translation: SMOKE },
  // Pivots for animating the arms (the throw), the head (the roar). The leg joints are below.
  { name: "Joint_Shoulder_R", translation: SHOULDER_R },
  { name: "Joint_Elbow_R", translation: ELBOW_R },
  { name: "Joint_Wrist_R", translation: WRIST_R },
  { name: "Joint_Shoulder_L", translation: SHOULDER_L },
  { name: "Joint_Elbow_L", translation: ELBOW_L },
  { name: "Joint_Neck", translation: NECK },
  { name: "Torso_Fx", translation: lean([0.9, 9.4, -1.05]) },
  { name: "Arm_R_Fx", translation: ELBOW_R },
  { name: "Arm_L_Fx", translation: ELBOW_L },
  { name: "Leg_R_Fx", translation: KNEE },
  { name: "Leg_L_Fx", translation: mirrorPoint(KNEE) },
  ...bothLegs(HIP, KNEE, ANKLE, TOE),
];

// The Titan's chamfers are about twice a mech's, so a face twice as wide still counts as a worn edge
// (scripts/assets/hardSurface.ts); with the mechs' width its chamfers would never chip.
const look = JSON.parse(readFileSync(new URL("../../data/look.json", import.meta.url), "utf8"));
const mechSurface = parseHardSurfaceLook(look.mech?.normals);
const surface = { ...mechSurface, wearWidthMeters: mechSurface.wearWidthMeters * 2 };

// Each part at its nearest level, then each simpler level while it has fewer triangles than the one before. The game
// reads <Part>_LOD1 and then <Part>_LOD2, stopping at the first missing one, and a part keeps its last level farther out.
function withLevels(levels: Part[][]): { nodes: NodeData[]; totals: number[] } {
  const nodes: NodeData[] = [];
  const totals = [0, 0, 0];
  levels[0]!.forEach((p, i) => {
    let last = p.mesh;
    nodes.push({ name: p.name, mesh: last });
    totals[0]! += triangles(last);
    let simpler = true;
    for (const lv of [1, 2] as const) {
      const mesh = levels[lv]![i]!.mesh;
      simpler &&= triangles(mesh) > 0 && triangles(mesh) < triangles(last);
      if (simpler) { nodes.push({ name: `${p.name}_LOD${lv}`, mesh }); last = mesh; }
      totals[lv]! += triangles(last);
    }
  });
  return { nodes, totals };
}

const levels = [build(0), build(1), build(2)];
const titan = withLevels(levels);

// The thrown car: a wrecked one, built round its own middle so it can tumble about it in flight and sit in the hand
// at Mount_Hand unturned.
const carHeight = 0.82 + 0.52 + 0.06;
const carParts = (lv: Level): Part[] => {
  const c = car(lv, 1, true);
  const mid = (m: MeshData) => turn(m, [0, 0, 0], [0, 0, 0], [0, -carHeight / 2, 0]);
  return [
    { name: "Car_Body", zone: "torso", paint: "carCream", finish: "paint", mesh: mid(c.body) },
    { name: "Car_Glass", zone: "torso", paint: "glass", finish: "metal", mesh: mid(c.glass) },
    { name: "Car_Trim", zone: "torso", paint: "steel", finish: "metal", mesh: mid(c.trim) },
    { name: "Car_Tyres", zone: "torso", paint: "rubber", finish: "rubber", mesh: mid(c.tyres) },
  ];
};
const thrown = withLevels([carParts(0), carParts(1), carParts(2)]);

const root = new URL("../..", import.meta.url).pathname;
const dir = join(root, "assets/models/titan");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Junk_Titan.glb"), writeGlb([...titan.nodes, ...markers], { quantize: true, hardSurface: surface }));
writeFileSync(join(dir, "Junk_Car.glb"), writeGlb(thrown.nodes, { quantize: true, hardSurface: surface }));

const kitLook = (p: Part) => ({ zone: p.zone, paint: p.paint, ...(p.finish ? { finish: p.finish } : {}), ...(p.glow ? { glow: true } : {}), ...(p.rusts === false ? { rusts: false } : {}), ...(p.noHit ? { noHit: true } : {}) });
const kitParts = Object.fromEntries(levels[0]!.map((p) => [p.name, kitLook(p)]));
// The car's parts carry no zone in play (it is not hit); its paints come from the Titan's scheme.
const carKit = { file: "models/titan/Junk_Car.glb", parts: Object.fromEntries(carParts(0).map((p) => [p.name, { paint: p.paint, finish: p.finish }])) };
const motionR = [piston("Knee_Ram_R", ["Leg_Frame_R"], ["thigh_R", RAM[0]], ["shin_R", RAM[1]], 0.24)];
writeFileSync(join(root, "scripts/mechs/titan.kit.json"), `${JSON.stringify({ scheme, parts: kitParts, motion: [...motionR, ...motionR.map(leftOf)], car: carKit }, null, 2)}\n`);

console.log(`Wrote Junk_Titan.glb to ${dir}: ${titan.totals.join(" / ")} triangles drawn near / middle / far`);
levels[0]!.forEach((p, i) => console.log(`  ${p.name.padEnd(14)} ${p.zone.padEnd(6)} ${p.paint.padEnd(10)} ${levels.map((l) => String(triangles(l[i]!.mesh)).padStart(5)).join(" ")}`));
console.log(`Wrote Junk_Car.glb: ${thrown.totals.join(" / ")} triangles near / middle / far`);
