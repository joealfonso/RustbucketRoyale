// Builds the Stiletto-B, a light recon and flanker: backward-bending bird legs, a narrow chest on a thin waist, a
// small pointed head with swept fins, a plasma blade on the right arm, a burst carbine on the left and a two-nozzle
// jump pack. Every part is built in place on the assembled mech (metres, Y up, facing -Z, right side +X).
// Run: npx tsx scripts/mechs/stiletto.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { box, convex, cylinder, merge, mirrorX, prism, triangles, turn, type V3 } from "../assets/shapes";

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));

// A chamfered rectangle (an octagon) round `centre`, `w` wide along `ex` and `h` tall along `ey`. The chamfer stands
// in for a bevel on the limb lofts below.
function ring(centre: V3, ex: V3, ey: V3, w: number, h: number, chamfer = 0.3): V3[] {
  const hw = w / 2, hh = h / 2, c = Math.min(hw, hh) * chamfer;
  const uv: [number, number][] = [[-hw + c, -hh], [hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c]];
  return uv.map(([u, v]) => add(centre, add(scale(ex, u), scale(ey, v))));
}

// A solid through matching rings in order, capped at both ends. Side quads are split in two so every face stays
// flat when neighbouring rings differ in size. Keeps faces outward the same way `convex` does, so the rings must
// describe a convex shape.
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

// The two side axes for a limb running along `dir`: the first stays as close to +X as it can.
function sideAxes(dir: V3): [V3, V3] {
  const ref: V3 = Math.abs(dir[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const ex = norm(cross(dir, ref));
  return [ex, norm(cross(ex, dir))];
}

// A limb segment from `a` to `b`, `[width, depth]` at each end, chamfered.
function limb(a: V3, b: V3, start: [number, number], end: [number, number]): MeshData {
  const [ex, ey] = sideAxes(norm(sub(b, a)));
  return loft([ring(a, ex, ey, start[0], start[1]), ring(b, ex, ey, end[0], end[1])]);
}

const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
const mirrorPoint = (p: V3): V3 => [-p[0], p[1], p[2]];
// Note on bevels: shapes.ts `box` folds its faces inside out when the bevel is more than a quarter of the box's
// smallest side, so thin plates here use small bevels.
const joint = (at: V3, radius: number, length: number) => cylinder(at, radius, length, "x", 12);

// ---- Legs: thigh forward to the knee, shin back to the ankle, a long foot forward to three toes. Right side, then
// mirrored. Armour is the slim thigh, shin and foot; the frame is joints, a hydraulic strut and the talons.
const HIP: V3 = [0.42, 1.55, 0], KNEE: V3 = [0.42, 0.98, -0.3], ANKLE: V3 = [0.42, 0.44, 0.26], BALL: V3 = [0.42, 0.1, -0.2];

const legArmourR = merge(
  limb(add(HIP, [0, 0.05, 0]), KNEE, [0.3, 0.36], [0.2, 0.22]),
  // A thigh plate on the outside, so the leg is not one plain stick from the side.
  turn(box([0.6, 1.3, -0.12], [0.08, 0.42, 0.3], 0.02), [-0.45, 0, 0], [0.6, 1.3, -0.12]),
  limb(KNEE, ANKLE, [0.2, 0.22], [0.15, 0.17]),
  limb(ANKLE, BALL, [0.16, 0.16], [0.2, 0.12]),
  // A knee cap that points forward: the first thing that reads as "bird legs" from the side.
  turn(box([0.42, 1.0, -0.42], [0.22, 0.3, 0.12], 0.03), [0.35, 0, 0], [0.42, 1.0, -0.42]),
);
const legFrameR = merge(
  joint(HIP, 0.17, 0.24),
  joint(KNEE, 0.13, 0.26),
  joint(ANKLE, 0.11, 0.22),
  // The strut behind the shin: the light skeleton showing through.
  limb([0.42, 1.25, 0.08], [0.42, 0.55, 0.34], [0.1, 0.1], [0.1, 0.1]),
  // Three toes and a heel spur, all flat on the ground.
  limb([0.42, 0.1, -0.18], [0.42, 0.05, -0.62], [0.14, 0.14], [0.1, 0.09]),
  limb([0.46, 0.1, -0.18], [0.62, 0.05, -0.5], [0.12, 0.12], [0.09, 0.09]),
  limb([0.38, 0.1, -0.18], [0.24, 0.05, -0.5], [0.12, 0.12], [0.09, 0.09]),
  limb([0.42, 0.42, 0.3], [0.42, 0.05, 0.44], [0.12, 0.12], [0.09, 0.09]),
);

// ---- Torso: a bird's chest that widens up from a thin waist, with a keel in front.
const chest = merge(
  loft([
    ring([0, 2.35, 0.0], X, Z, 0.62, 0.5),
    ring([0, 2.75, -0.06], X, Z, 1.15, 0.86),
    ring([0, 3.05, -0.02], X, Z, 1.2, 0.78),
    ring([0, 3.18, 0.02], X, Z, 0.9, 0.6),
  ]),
  prism([[3.02, -0.38], [2.45, -0.22], [2.78, -0.62]], "x", -0.14, 0.14),
  // Collar plates either side of the neck, so the chest top is not a flat lid.
  turn(box([0.3, 3.2, -0.08], [0.32, 0.12, 0.5], 0.03), [0, 0, -0.25], [0.3, 3.2, -0.08]),
  turn(box([-0.3, 3.2, -0.08], [0.32, 0.12, 0.5], 0.03), [0, 0, 0.25], [-0.3, 3.2, -0.08]),
);
const torsoFrame = merge(
  box([0, 1.73, 0.02], [0.66, 0.28, 0.44], 0.05), // pelvis
  cylinder([0, 2.1, 0.02], 0.17, 0.72, "y", 10), // the thin waist
  cylinder([0, 3.22, -0.04], 0.14, 0.24, "y", 8), // neck
  // Ribs over the waist, the skeleton between chest and hips.
  cylinder([0, 1.98, 0.02], 0.22, 0.08, "y", 10),
  cylinder([0, 2.2, 0.02], 0.22, 0.08, "y", 10),
);

// ---- Head: small and pointed forward, with a dark visor band and two fins a side swept back.
const head = loft([
  ring([0, 3.42, 0.06], X, Y, 0.34, 0.26),
  ring([0, 3.43, -0.18], X, Y, 0.4, 0.3),
  ring([0, 3.39, -0.56], X, Y, 0.12, 0.1),
]);
const visor = loft([ring([0, 3.45, -0.2], X, Y, 0.42, 0.1), ring([0, 3.42, -0.44], X, Y, 0.22, 0.08)]);
const finR = merge(
  turn(prism([[3.4, -0.18], [3.52, 0.08], [3.92, 0.55]], "x", 0.15, 0.23), [0, 0, -0.3], [0.19, 3.45, 0]),
  turn(prism([[3.32, -0.05], [3.4, 0.1], [3.55, 0.45]], "x", 0.15, 0.23), [0, 0, -0.7], [0.19, 3.36, 0]),
);

// ---- Jump pack: a white housing on the back, two dark nozzles angled down, back and out.
const pack = box([0, 2.75, 0.52], [0.72, 0.7, 0.36], 0.06);
const nozzleR = turn(cylinder([0.3, 2.3, 0.66], 0.17, 0.42, "y", 10, 0.11), [-0.5, 0, 0.3], [0.3, 2.45, 0.66]);
const jets = merge(
  nozzleR, mirrorX(nozzleR),
  box([0, 2.45, 0.62], [0.56, 0.14, 0.2], 0.03), // the bar that carries both nozzles
  box([0, 2.95, 0.72], [0.5, 0.1, 0.1], 0.02), // two vents across the pack's back
  box([0, 2.77, 0.72], [0.5, 0.1, 0.1], 0.02),
);

// ---- Arms. Right: a slim arm ending in a blade emitter. Left: the same shoulder holding a burst carbine.
const SHOULDER_R: V3 = [0.84, 2.82, 0], ELBOW_R: V3 = [1.14, 2.4, 0.06], WRIST_R: V3 = [1.2, 2.4, -0.74];
const ELBOW_L: V3 = [-1.14, 2.38, 0.06], WRIST_L: V3 = [-1.18, 2.3, -0.42];

const pauldronR = turn(box([1.0, 2.98, 0.02], [0.36, 0.2, 0.52], 0.05), [0, 0, -0.32], [0.84, 2.98, 0.02]);
const upperArmR = limb(SHOULDER_R, ELBOW_R, [0.22, 0.24], [0.17, 0.19]);
const upperArmL = mirrorX(upperArmR);
const armR = merge(
  upperArmR,
  limb(ELBOW_R, WRIST_R, [0.24, 0.26], [0.2, 0.2]),
  box([1.32, 2.44, -0.36], [0.08, 0.22, 0.56], 0.02), // outer forearm guard
);
const armL = merge(upperArmL, limb(ELBOW_L, WRIST_L, [0.24, 0.26], [0.2, 0.2]));
const armFrame = merge(
  joint(SHOULDER_R, 0.15, 0.22), joint(mirrorPoint(SHOULDER_R), 0.15, 0.22),
  joint(ELBOW_R, 0.11, 0.24), joint(mirrorPoint(ELBOW_R), 0.11, 0.24),
  box([1.2, 2.4, -0.8], [0.22, 0.32, 0.16], 0.03), // blade emitter at the right wrist
);
// The blade: a flat tapered plate held straight forward, longer than the forearm, its tip region round Mount_Gun.
const blade = prism([[2.55, -0.86], [2.26, -0.86], [2.3, -1.35], [2.4, -1.8], [2.52, -1.5]], "x", 1.155, 1.245);
const carbine = merge(
  box([-1.2, 2.22, -0.56], [0.2, 0.26, 0.72], 0.04), // receiver, clamped under the forearm
  box([-1.2, 2.02, -0.44], [0.14, 0.2, 0.18], 0.02), // magazine
  box([-1.2, 2.39, -0.62], [0.1, 0.09, 0.26], 0.02), // sight
  cylinder([-1.2, 2.26, -1.06], 0.055, 0.32, "z", 8), // barrel
  cylinder([-1.2, 2.26, -1.2], 0.085, 0.12, "z", 8), // muzzle shroud
);


// Each part: its zone and paint live in the game's kit data, noted here so whoever writes that entry can copy them.
const parts: { name: string; zone: "legs" | "arms" | "torso"; paint: "body" | "accent" | "trim"; mesh: MeshData }[] = [
  { name: "Torso", zone: "torso", paint: "body", mesh: chest },
  { name: "Frame", zone: "torso", paint: "trim", mesh: torsoFrame },
  { name: "Sensor", zone: "torso", paint: "body", mesh: head },
  { name: "Visor", zone: "torso", paint: "trim", mesh: visor },
  { name: "Fins", zone: "torso", paint: "accent", mesh: merge(finR, mirrorX(finR)) },
  { name: "Pack", zone: "torso", paint: "body", mesh: pack },
  { name: "Jets", zone: "torso", paint: "trim", mesh: jets },
  { name: "Leg_L", zone: "legs", paint: "body", mesh: mirrorX(legArmourR) },
  { name: "Leg_R", zone: "legs", paint: "body", mesh: legArmourR },
  { name: "Leg_Frame", zone: "legs", paint: "trim", mesh: merge(legFrameR, mirrorX(legFrameR)) },
  { name: "Arm_L", zone: "arms", paint: "body", mesh: armL },
  { name: "Arm_R", zone: "arms", paint: "body", mesh: armR },
  { name: "Shoulders", zone: "arms", paint: "accent", mesh: merge(pauldronR, mirrorX(pauldronR)) },
  { name: "Arm_Frame", zone: "arms", paint: "trim", mesh: armFrame },
  { name: "Blade", zone: "arms", paint: "accent", mesh: blade },
  { name: "Carbine", zone: "arms", paint: "trim", mesh: carbine },
];

const markers: NodeData[] = [
  { name: "Mount_Gun", translation: [1.2, 2.4, -1.65] },
  { name: "Torso_Fx", translation: [0.3, 2.9, -0.42] },
  { name: "Arm_R_Fx", translation: ELBOW_R },
  { name: "Leg_L_Fx", translation: mirrorPoint(KNEE) },
];

const dir = join(new URL("../..", import.meta.url).pathname, "assets/models/mechs/stiletto");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Stiletto.glb"), writeGlb([...parts.map((p) => ({ name: p.name, mesh: p.mesh })), ...markers]));
const total = parts.reduce((s, p) => s + triangles(p.mesh), 0);
console.log(`Wrote Mech_Stiletto.glb to ${dir}: ${total} triangles`);
for (const p of parts) console.log(`  ${p.name.padEnd(10)} ${p.zone.padEnd(6)} ${p.paint.padEnd(7)} ${triangles(p.mesh)}`);
