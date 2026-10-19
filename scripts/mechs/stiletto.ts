// Builds the Stiletto-B (docs/MECH_ROSTER.md, section 2), a light recon and flanker: backward-bending bird legs on
// sprung joints, a slim chest on a thin skeleton waist, a raptor head with one swept-back sensor fin and a thin green
// visor, a plasma blade on the right wrist, a burst carbine under the left forearm, and a big jump pack whose two
// stabilizer fins rise above the shoulders. Blue and white urban camo is modelled as blue plates laid over the white
// shell, each paint its own part. Every part is built in place on the assembled mech (metres, Y up, facing -Z, right
// side +X). Writes the model and scripts/mechs/stiletto.kit.json, the paint and zone of every part.
// Run: npx tsx scripts/mechs/stiletto.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { bothLegs } from "./joints";
import { box, convex, cylinder, merge, mirrorX, prism, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));
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

// A plate lying along part of a limb (from t0 to t1 of a→b), pushed out from its centre line by `out` metres along
// the limb's depth axis (negative is the other face). The plate is `width` wide and `thick` deep, so its inner face
// sinks into the limb and its outer face stands proud: that is how the camo patches and guards sit on the shell.
function limbPlate(a: V3, b: V3, t0: number, t1: number, out: [number, number], width: [number, number], thick: number): MeshData {
  const [, ey] = sideAxes(norm(sub(b, a)));
  return limb(add(lerp(a, b, t0), scale(ey, out[0])), add(lerp(a, b, t1), scale(ey, out[1])), [width[0], thick], [width[1], thick]);
}

const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
const mirrorPoint = (p: V3): V3 => [-p[0], p[1], p[2]];
const joint = (at: V3, radius: number, length: number) => cylinder(at, radius, length, "x", 12);
// The small orange conduit strips: an upright bar standing out from the outer end of a joint.
const conduit = (at: V3, height: number) => box(at, [0.06, height, 0.08], 0.01);

// ---- Legs: thigh forward to the knee, shin back to the hock, a long foot forward to three talons and a back toe.
// Built on the right side, then mirrored. The camo alternates side to side: blue thigh and shin plates on the right,
// a blue knee cap and foot guard on the left, so the two legs never read as copies.
const HIP: V3 = [0.42, 1.55, 0.02], KNEE: V3 = [0.42, 1.0, -0.32], HOCK: V3 = [0.42, 0.48, 0.26], BALL: V3 = [0.42, 0.12, -0.16];
const THIGH_TOP = add(HIP, [0, 0.05, 0]);

const legShellR = merge(
  limb(THIGH_TOP, KNEE, [0.3, 0.36], [0.2, 0.22]),
  limb(KNEE, HOCK, [0.2, 0.22], [0.15, 0.17]),
  limb(HOCK, BALL, [0.15, 0.15], [0.18, 0.12]),
);
// A forward-pointing knee cap: the first thing that reads as "bird legs" from the side.
const kneeCapR = turn(box([0.42, 1.02, -0.43], [0.22, 0.3, 0.12], 0.03), [0.35, 0, 0], [0.42, 1.02, -0.43]);
const thighPlateR = turn(box([0.6, 1.28, -0.14], [0.08, 0.36, 0.28], 0.02), [-0.45, 0, 0], [0.6, 1.28, -0.14]);
// The shin's depth axis points up and back, so the front plate sits on its negative side.
const shinPlateR = limbPlate(KNEE, HOCK, 0.15, 0.75, [-0.127, -0.11], [0.14, 0.11], 0.07);
// The foot's depth axis points down and back, so its top guard also sits on the negative side.
const footGuardR = limbPlate(HOCK, BALL, 0.12, 0.7, [-0.09, -0.08], [0.12, 0.13], 0.06);
// The pilot's marking: one band round the left thigh, a little proud of the shell.
const thighBandR = limbPlate(THIGH_TOP, KNEE, 0.34, 0.46, [0, 0], [0.31, 0.3], 0.35);

// Coil discs on a rod from the back of the thigh to the hock: the spring-loaded joint.
const SPRING_TOP: V3 = [0.42, 1.36, 0.02], SPRING_END: V3 = [0.42, 0.56, 0.34];
const coils = [0.3, 0.42, 0.54, 0.66].map((t) => {
  const d = scale(norm(sub(SPRING_END, SPRING_TOP)), 0.03), c = lerp(SPRING_TOP, SPRING_END, t);
  return limb(sub(c, d), add(c, d), [0.15, 0.15], [0.15, 0.15]);
});
const legFrameR = merge(
  joint(HIP, 0.16, 0.26),
  joint(KNEE, 0.12, 0.26),
  joint(HOCK, 0.11, 0.22),
  joint(BALL, 0.09, 0.2),
  limb(SPRING_TOP, SPRING_END, [0.07, 0.07], [0.07, 0.07]),
  ...coils,
  // Three talons forward and one back toe, flat on the ground.
  limb([0.42, 0.1, -0.16], [0.42, 0.052, -0.62], [0.13, 0.13], [0.09, 0.09]),
  limb([0.46, 0.1, -0.16], [0.62, 0.052, -0.5], [0.11, 0.11], [0.09, 0.09]),
  limb([0.38, 0.1, -0.16], [0.24, 0.052, -0.5], [0.11, 0.11], [0.09, 0.09]),
  limb([0.42, 0.1, -0.12], [0.42, 0.052, 0.14], [0.11, 0.11], [0.09, 0.09]),
);
const legConduitsR = merge(conduit([0.58, 1.55, 0.02], 0.22), conduit([0.575, 1.0, -0.32], 0.18));

// ---- Torso: a bird's chest that widens up from the thin waist, with a keel in front. The waist, pelvis and neck
// are the bare skeleton.
const chest = loft([
  ring([0, 2.3, 0.02], X, Z, 0.56, 0.46),
  ring([0, 2.72, -0.05], X, Z, 1.06, 0.8),
  ring([0, 3.02, -0.02], X, Z, 1.1, 0.74),
  ring([0, 3.16, 0.02], X, Z, 0.84, 0.56),
]);
// Collar plates either side of the neck, so the chest top is not a flat lid. The right one is white, the left blue.
const collarR = turn(box([0.28, 3.18, -0.06], [0.3, 0.1, 0.46], 0.03), [0, 0, -0.25], [0.28, 3.18, -0.06]);
const torsoCamo = merge(
  prism([[3.0, -0.36], [2.42, -0.22], [2.74, -0.58]], "x", -0.08, 0.08), // the keel
  turn(box([0.26, 2.89, -0.43], [0.28, 0.22, 0.08], 0.02), [0.2, 0, 0], [0.26, 2.89, -0.43]), // right chest plate
  turn(box([-0.467, 2.58, -0.04], [0.08, 0.28, 0.36], 0.02), [0, 0, 0.537], [-0.467, 2.58, -0.04]), // left flank
  mirrorX(collarR),
);
const torsoFrame = merge(
  box([0, 1.72, 0.02], [0.6, 0.26, 0.42], 0.05), // pelvis
  cylinder([0, 2.06, 0.02], 0.16, 0.64, "y", 10), // the thin waist
  cylinder([0, 3.24, -0.02], 0.11, 0.26, "y", 8), // neck
  // Ribs over the waist, the skeleton between chest and hips.
  cylinder([0, 1.96, 0.02], 0.21, 0.07, "y", 10),
  cylinder([0, 2.16, 0.02], 0.21, 0.07, "y", 10),
);

// ---- Head: a raptor's skull, deepest just behind the eyes and running forward to a low beak point. One sharp fin
// sweeps up and back off the crown, and the visor is a thin band round the front a little wider than the skull.
const head = loft([
  ring([0, 3.42, 0.12], X, Y, 0.3, 0.26),
  ring([0, 3.45, -0.12], X, Y, 0.38, 0.3),
  ring([0, 3.42, -0.4], X, Y, 0.26, 0.2),
  ring([0, 3.395, -0.7], X, Y, 0.08, 0.07),
]);
const visor = loft([ring([0, 3.47, -0.1], X, Y, 0.43, 0.07), ring([0, 3.43, -0.55], X, Y, 0.22, 0.065)]);
const fin = prism([[3.57, -0.24], [3.53, 0.1], [4.02, 0.66]], "x", -0.04, 0.04);

// ---- Jump pack: a white housing between the shoulders, blue camo plates, two stabilizer fins canted out above the
// shoulders, and two big flared nozzles under it pointing down, back and out.
const pack = box([0, 2.78, 0.54], [0.66, 0.76, 0.4], 0.06);
const packFinR = turn(prism([[3.1, 0.36], [3.1, 0.74], [3.98, 1.02], [3.6, 0.62]], "x", 0.22, 0.3), [0, 0, -0.35], [0.26, 3.12, 0.56]);
const packCamo = merge(
  packFinR, mirrorX(packFinR),
  box([0.345, 2.74, 0.54], [0.06, 0.5, 0.3], 0.01), // right side panel
  box([-0.16, 2.94, 0.75], [0.26, 0.3, 0.06], 0.01), // back plate, upper left
);
// Nozzles flare wider at the exhaust, which is the bottom of the cone.
const nozzleR = turn(cylinder([0.22, 2.24, 0.64], 0.2, 0.4, "y", 12, 0.13), [-0.3, 0, 0.2], [0.22, 2.44, 0.64]);
const jets = merge(
  nozzleR, mirrorX(nozzleR),
  box([0, 2.44, 0.64], [0.5, 0.14, 0.24], 0.03), // the bar that carries both nozzles
  box([0.14, 2.62, 0.75], [0.26, 0.1, 0.06], 0.01), // a vent on the pack's back
);

// ---- Arms. Right: a slim arm with the blade emitter on the wrist. Left: the same shoulder with a burst carbine in
// the lower forearm. Camo alternates: blue right shoulder and left forearm guard, white the other two.
const SHOULDER_R: V3 = [0.78, 2.84, 0], ELBOW_R: V3 = [1.12, 2.42, 0.08], WRIST_R: V3 = [1.2, 2.42, -0.7];
const ELBOW_L = mirrorPoint(ELBOW_R), WRIST_L: V3 = [-1.18, 2.32, -0.44];

const pauldronR = turn(box([0.96, 3.0, 0.02], [0.36, 0.2, 0.5], 0.05), [0, 0, -0.32], [0.8, 3.0, 0.02]);
const upperArmR = limb(SHOULDER_R, ELBOW_R, [0.22, 0.24], [0.17, 0.19]);
const armR = merge(
  upperArmR,
  limb(ELBOW_R, WRIST_R, [0.24, 0.26], [0.2, 0.2]),
  box([1.3, 2.44, -0.36], [0.08, 0.22, 0.56], 0.02), // outer forearm guard
);
const armL = merge(mirrorX(upperArmR), limb(ELBOW_L, WRIST_L, [0.24, 0.26], [0.2, 0.2]), mirrorX(pauldronR));
const armCamo = merge(pauldronR, box([-1.29, 2.4, -0.18], [0.08, 0.2, 0.4], 0.02));
const armFrame = merge(
  joint(SHOULDER_R, 0.15, 0.22), joint(mirrorPoint(SHOULDER_R), 0.15, 0.22),
  joint(ELBOW_R, 0.11, 0.24), joint(ELBOW_L, 0.11, 0.24),
  joint(WRIST_L, 0.09, 0.2),
);
const armConduits = merge(conduit([1.255, 2.42, 0.08], 0.16), conduit([-1.255, 2.42, 0.08], 0.16));
const emitter = merge(
  box([1.2, 2.42, -0.8], [0.24, 0.3, 0.22], 0.03),
  cylinder([1.2, 2.42, -0.95], 0.08, 0.1, "z", 8), // the nozzle the blade comes out of
);
// The blade: a flat tapered plate held straight forward, longer than the forearm, its tip region round Mount_Gun.
const blade = prism([[2.5, -0.98], [2.34, -0.98], [2.37, -1.35], [2.44, -1.78], [2.51, -1.45]], "x", 1.16, 1.24);
const carbine = merge(
  box([-1.2, 2.17, -0.52], [0.2, 0.24, 0.66], 0.04), // receiver, clamped under the forearm
  box([-1.2, 1.98, -0.42], [0.14, 0.18, 0.18], 0.02), // magazine
  box([-1.2, 2.33, -0.66], [0.1, 0.08, 0.24], 0.02), // sight
  cylinder([-1.2, 2.2, -1.0], 0.055, 0.3, "z", 8), // barrel
  cylinder([-1.2, 2.2, -1.13], 0.085, 0.12, "z", 8), // muzzle shroud
);

type Zone = "legs" | "arms" | "torso";
interface Part { name: string; zone: Zone; paint: string; glow?: true; rusts?: false; mesh: MeshData }
const parts: Part[] = [
  { name: "Torso", zone: "torso", paint: "white", mesh: merge(chest, collarR) },
  { name: "Torso_Camo", zone: "torso", paint: "blue", mesh: torsoCamo },
  { name: "Frame", zone: "torso", paint: "frame", rusts: false, mesh: torsoFrame },
  { name: "Sensor", zone: "torso", paint: "white", mesh: head },
  { name: "Fin", zone: "torso", paint: "blue", mesh: fin },
  { name: "Visor", zone: "torso", paint: "visorGlow", glow: true, mesh: visor },
  { name: "Pack", zone: "torso", paint: "white", mesh: pack },
  { name: "Pack_Camo", zone: "torso", paint: "blue", mesh: packCamo },
  { name: "Jets", zone: "torso", paint: "frame", rusts: false, mesh: jets },
  { name: "Leg_L", zone: "legs", paint: "white", mesh: mirrorX(legShellR) },
  { name: "Leg_R", zone: "legs", paint: "white", mesh: merge(legShellR, kneeCapR) },
  { name: "Leg_Camo", zone: "legs", paint: "blue", mesh: merge(thighPlateR, shinPlateR, mirrorX(kneeCapR), mirrorX(footGuardR)) },
  { name: "Leg_Frame", zone: "legs", paint: "frame", rusts: false, mesh: merge(legFrameR, mirrorX(legFrameR)) },
  { name: "Leg_Conduits", zone: "legs", paint: "conduitGlow", glow: true, mesh: merge(legConduitsR, mirrorX(legConduitsR)) },
  { name: "Thigh_Band", zone: "legs", paint: "accent", mesh: mirrorX(thighBandR) },
  { name: "Arm_L", zone: "arms", paint: "white", mesh: armL },
  { name: "Arm_R", zone: "arms", paint: "white", mesh: armR },
  { name: "Arm_Camo", zone: "arms", paint: "blue", mesh: armCamo },
  { name: "Arm_Frame", zone: "arms", paint: "frame", rusts: false, mesh: armFrame },
  { name: "Arm_Conduits", zone: "arms", paint: "conduitGlow", glow: true, mesh: armConduits },
  { name: "Emitter", zone: "arms", paint: "weapon", mesh: emitter },
  { name: "Blade", zone: "arms", paint: "bladeGlow", glow: true, mesh: blade },
  { name: "Carbine", zone: "arms", paint: "frame", rusts: false, mesh: carbine },
];
const scheme = { white: "#E8EAEE", blue: "#2F6FD0", frame: "#22303F", visorGlow: "#5CFF7A", conduitGlow: "#FF8A1F", bladeGlow: "#4FC3FF" };

const markers: NodeData[] = [
  { name: "Mount_Gun", translation: [1.2, 2.4, -1.65] },
  { name: "Torso_Fx", translation: [0.3, 2.9, -0.42] },
  { name: "Arm_R_Fx", translation: ELBOW_R },
  { name: "Leg_L_Fx", translation: mirrorPoint(KNEE) },
  // The two-bone chain ends at the hock; the long bird foot from hock to ball stays as it is.
  ...bothLegs(HIP, KNEE, HOCK, BALL),
];

const root = new URL("../..", import.meta.url).pathname;
const dir = join(root, "assets/models/mechs/stiletto");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Stiletto.glb"), writeGlb([...parts.map((p) => ({ name: p.name, mesh: p.mesh })), ...markers]));
const kitParts = Object.fromEntries(parts.map(({ name, mesh: _mesh, ...look }) => [name, look]));
writeFileSync(join(root, "scripts/mechs/stiletto.kit.json"), `${JSON.stringify({ scheme, parts: kitParts }, null, 2)}\n`);
const total = parts.reduce((s, p) => s + triangles(p.mesh), 0);
console.log(`Wrote Mech_Stiletto.glb to ${dir}: ${total} triangles`);
for (const p of parts) console.log(`  ${p.name.padEnd(13)} ${p.zone.padEnd(6)} ${p.paint.padEnd(12)} ${triangles(p.mesh)}`);
