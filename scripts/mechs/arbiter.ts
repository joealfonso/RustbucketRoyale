// Arbiter, the electronic warfare and command mech (docs/MECH_ROSTER.md, section 4): slender digitigrade legs on broad
// magnetic feet, a narrow white chassis with teal energy strips, an oversized round radome for a head, a comms mast on
// the left shoulder, and four utility drones held round the body on jointed pylons. At range it should read as
// "the big round head and the ring of drones". Each part's paint and flags are in arbiter.kit.json next to this file.
// Run: npx tsx scripts/mechs/arbiter.ts  →  assets/models/mechs/arbiter/Mech_Arbiter.glb
// Metres, Y up, facing -Z, right side +X, feet at y = 0. Every part is built in place on the assembled mech.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MeshData, NodeData } from "../assets/glbWrite";
import { writeGlb } from "../assets/glbWrite";
import { bothLegs } from "./joints";
import { box, convex, cylinder, merge, mirrorX, prism, triangles, turn, wedge, type V3 } from "../../packages/client/src/dressing/shapes";

const deg = Math.PI / 180;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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

// A straight bar from a to b, `w` wide across its sideways axis and `h` across the other, for limbs and pylons that
// run at an angle. Sideways is horizontal where it can be, so a leg bar's width stays across x.
function beam(a: V3, b: V3, w: number, h: number): MeshData {
  const d = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  let side = cross(d, [0, 1, 0]);
  if (Math.hypot(...side) < 1e-3) side = cross(d, [1, 0, 0]);
  const u = scale(unit(side), w / 2), v = scale(unit(cross(unit(side), d)), h / 2);
  const corners = (p: V3): V3[] => [add(add(p, u), v), add(add(p, scale(u, -1)), v), add(add(p, scale(u, -1)), scale(v, -1)), add(add(p, u), scale(v, -1))];
  const ca = corners(a), cb = corners(b);
  return convex([ca, cb, ...ca.map((_, i) => { const j = (i + 1) % 4; return [ca[i]!, ca[j]!, cb[j]!, cb[i]!]; })]);
}

// ---- Legs (legs zone). Built for the right leg, mirrored for the left. Digitigrade: the thigh runs down and forward to
// the knee, the shin back to a raised hock, a short bone forward to the ankle, then a broad flat magnetic foot.
const legX = 0.42;
const hip: V3 = [legX, 1.52, 0.02], knee: V3 = [legX, 1.02, -0.2], hock: V3 = [legX, 0.42, 0.22], ankle: V3 = [legX, 0.17, 0.0];
const rightLeg = merge(
  beam(lerp(knee, hip, 1.1), lerp(hip, knee, 1.08), 0.24, 0.28), // thigh
  beam(lerp(hock, knee, 1.06), lerp(knee, hock, 1.06), 0.2, 0.22), // shin
  beam(hock, ankle, 0.16, 0.16), // the bone from hock to ankle
  wedge([legX, 1.04, -0.32], [0.2, 0.22, 0.12], 0.5), // knee cap
  box([legX, 0.11, -0.04], [0.42, 0.1, 0.62], 0.03), // foot
  wedge([legX, 0.11, -0.4], [0.38, 0.08, 0.14], 0.7), // toe
);
// The magnetic pad is a little wider than the foot, so the locking plate shows as a dark rim at ground level.
const rightLegFrame = merge(
  cylinder(hip, 0.13, 0.26, "x", 8),
  cylinder(knee, 0.11, 0.26, "x", 8),
  cylinder(hock, 0.09, 0.22, "x", 8),
  cylinder(ankle, 0.08, 0.2, "x", 6),
  beam([legX, 1.32, 0.16], [legX, 0.6, 0.3], 0.07, 0.07), // calf piston
  box([legX, 0.035, -0.04], [0.48, 0.07, 0.68], 0.02), // magnetic pad
);
const legFrame = merge(rightLegFrame, mirrorX(rightLegFrame), box([0, 1.55, 0.02], [0.62, 0.22, 0.36], 0.04)); // pelvis
// A teal energy strip down the front of each shin. The front of a shin that slopes back faces forward and down.
const shinFront = unit([0, -(hock[2] - knee[2]), hock[1] - knee[1]]);
const shinStrip = beam(add(lerp(knee, hock, 0.25), scale(shinFront, 0.12)), add(lerp(knee, hock, 0.7), scale(shinFront, 0.12)), 0.08, 0.06);
const legGlow = merge(shinStrip, mirrorX(shinStrip));

// ---- Torso (torso zone). Narrow and a little lopsided: the right (gun) side of the chest carries a raised armour plate,
// the left side shows its energy strips instead.
const torso = merge(
  prism([[-0.22, 1.9], [0.22, 1.9], [0.42, 2.35], [0.4, 2.92], [-0.36, 2.92], [-0.4, 2.35]], "z", -0.28, 0.28),
  turn(box([0.12, 2.56, -0.32], [0.5, 0.6, 0.12], 0.04), [-0.12, 0, 0], [0.12, 2.56, -0.32]), // chest plate
  box([0, 3.02, 0.04], [1.1, 0.24, 0.52], 0.06), // shoulder yoke
);
const torsoFrame = merge(
  box([0, 1.78, 0.02], [0.34, 0.3, 0.3], 0.04), // waist
  box([0, 2.5, 0.42], [0.6, 0.72, 0.26], 0.05), // electronics pack
  cylinder([0.66, 2.9, 0.02], 0.13, 0.24, "x", 8), // shoulder joints
  cylinder([-0.66, 2.9, 0.02], 0.13, 0.24, "x", 8),
);
const torsoTrim = merge(
  box([0.41, 2.62, 0], [0.06, 0.4, 0.34], 0.02), // flank panels
  box([-0.39, 2.62, 0], [0.06, 0.4, 0.34], 0.02),
  box([0, 2.5, 0.56], [0.44, 0.52, 0.06], 0.02), // pack cover
);
const torsoGlow = merge(
  box([-0.2, 2.52, -0.3], [0.07, 0.44, 0.06]),
  box([-0.08, 2.47, -0.3], [0.07, 0.34, 0.06]),
  box([0.1, 2.12, -0.3], [0.3, 0.07, 0.06]), // under the chest plate
);

// ---- Radome head (torso zone). Far bigger than a head needs to be, sitting low in a collar: it is the silhouette.
// Round in plan so the glowing ring round its middle stands proud by the same amount all the way round.
const domeCentre: V3 = [0, 3.68, 0];
const sensor = ellipsoid(domeCentre, [0.68, 0.62, 0.68], 16, [-50, -32, -15, 0, 18, 36, 54, 72]);
const sensorRing = cylinder(domeCentre, 0.71, 0.07, "y", 16);
const sensorFrame = cylinder([0, 3.2, 0.02], 0.34, 0.18, "y", 12, 0.44); // collar, flaring up to cup the dome

// ---- Comms mast on the left shoulder, behind the dome. The asymmetry has a job: the mast relays the drones, and it sits
// on the side away from the gun so it stays out of the line of fire.
const mastX = -0.68, mastZ = 0.42;
const mast = merge(
  box([-0.6, 3.2, 0.38], [0.26, 0.12, 0.26], 0.03),
  cylinder([mastX, 3.76, mastZ], 0.05, 1.16, "y", 6),
  box([mastX, 3.96, mastZ], [0.34, 0.07, 0.07]),
  box([mastX, 4.16, mastZ], [0.24, 0.07, 0.07]),
  cylinder([mastX, 4.38, mastZ], 0.08, 0.1, "y", 6, 0.04),
);

// ---- Arms (arms zone). Slim upper arms, forearms held forward with a light SMG in each wrist. The right one is the
// weapon in hand (Mount_Gun at its muzzle); the left is a backup in the frame colour.
const rightArm = merge(
  box([1.0, 2.55, 0.02], [0.2, 0.56, 0.22], 0.04),
  box([1.08, 2.34, -0.42], [0.22, 0.24, 0.72], 0.04),
);
const armFrameR = cylinder([1.02, 2.3, 0], 0.11, 0.24, "x", 8); // elbow
const gunR = merge(
  box([1.2, 2.4, -0.98], [0.18, 0.2, 0.46], 0.03),
  box([1.2, 2.24, -0.92], [0.1, 0.16, 0.12], 0.02), // magazine
  cylinder([1.2, 2.4, -1.3], 0.08, 0.18, "z", 8), // shroud
  cylinder([1.2, 2.4, -1.5], 0.04, 0.3, "z", 6), // barrel, muzzle at z = -1.65
);
const armGlowR = box([1.08, 2.48, -0.42], [0.07, 0.06, 0.4]);
const pauldronR = turn(box([0.92, 2.98, 0.02], [0.34, 0.26, 0.46], 0.06), [0, 0, -0.15], [0.92, 2.98, 0.02]);

const leftArm = merge(
  box([-1.0, 2.55, 0.02], [0.18, 0.54, 0.2], 0.04),
  box([-1.06, 2.32, -0.38], [0.2, 0.22, 0.66], 0.04),
);
const armFrameL = merge(
  cylinder([-1.02, 2.3, 0], 0.1, 0.22, "x", 8), // elbow
  box([-1.14, 2.37, -0.88], [0.14, 0.16, 0.36], 0.03), // backup SMG
  cylinder([-1.14, 2.37, -1.18], 0.035, 0.24, "z", 6),
);
const armGlowL = box([-1.06, 2.46, -0.26], [0.06, 0.06, 0.3]);
const armAccent = box([-1.06, 2.32, -0.52], [0.24, 0.26, 0.1], 0.02); // the pilot's band round the left forearm
const pauldronL = turn(box([-0.9, 2.96, 0.02], [0.3, 0.22, 0.42], 0.06), [0, 0, 0.15], [-0.9, 2.96, 0.02]);

// ---- Drones (torso zone, no hit boxes). Four small white pods with a glowing teal eye, each held out on a two-segment
// pylon from the shoulders or the back, at different heights so the ring looks like it is turning.
// Built at the origin facing -Z, then turned so the eye looks out from the chassis.
const pod = merge(
  ellipsoid([0, 0, 0], [0.17, 0.13, 0.22], 8, [-90, -45, 0, 45]),
  box([0, 0, 0.04], [0.48, 0.06, 0.14], 0.02), // stabiliser fins
);
const eye = cylinder([0, 0, -0.19], 0.085, 0.08, "z", 8);
interface DronePlace { at: V3; mount: V3; elbow: V3 }
const placesR: DronePlace[] = [
  { at: [1.92, 3.35, -0.2], mount: [0.5, 3.12, 0.12], elbow: [1.15, 3.7, 0.25] },
  { at: [1.3, 3.95, 1.3], mount: [0.22, 2.88, 0.45], elbow: [0.75, 3.55, 0.95] },
];
const placesL: DronePlace[] = [
  { at: [-1.95, 3.55, -0.3], mount: [-0.48, 3.12, 0.0], elbow: [-1.15, 3.85, 0.0] },
  { at: [-1.25, 2.7, 1.42], mount: [-0.22, 2.5, 0.56], elbow: [-0.7, 2.85, 1.1] },
];
const places = [...placesR, ...placesL];
// Faces out from the body, leaning forward so the eyes show from the front.
const placed = (mesh: MeshData, p: DronePlace) => turn(mesh, [0, Math.atan2(-p.at[0], -(p.at[2] - 1.0)), 0], [0, 0, 0], p.at);
const drones = merge(...places.map((p) => placed(pod, p)));
const droneEyes = merge(...places.map((p) => placed(eye, p)));
const joint = (at: V3) => ellipsoid(at, [0.075, 0.075, 0.075], 6, [-90, 0]);
const dronePylons = merge(...places.map((p) => merge(
  joint(p.mount),
  beam(p.mount, p.elbow, 0.08, 0.08),
  joint(p.elbow),
  beam(p.elbow, p.at, 0.07, 0.07),
)));

const nodes: NodeData[] = [
  { name: "Torso", mesh: torso },
  { name: "Torso_Frame", mesh: torsoFrame },
  { name: "Torso_Trim", mesh: torsoTrim },
  { name: "Torso_Glow", mesh: torsoGlow },
  { name: "Sensor", mesh: sensor },
  { name: "Sensor_Ring", mesh: sensorRing },
  { name: "Sensor_Frame", mesh: sensorFrame },
  { name: "Mast", mesh: mast },
  { name: "Drones", mesh: drones },
  { name: "Drone_Eyes", mesh: droneEyes },
  { name: "Drone_Pylons", mesh: dronePylons },
  { name: "Leg_L", mesh: mirrorX(rightLeg) },
  { name: "Leg_R", mesh: rightLeg },
  { name: "Leg_Frame", mesh: legFrame },
  { name: "Leg_Glow", mesh: legGlow },
  { name: "Arm_L", mesh: leftArm },
  { name: "Arm_R", mesh: rightArm },
  { name: "Arm_Frame_L", mesh: armFrameL },
  { name: "Arm_Frame_R", mesh: armFrameR },
  { name: "Arm_Glow_L", mesh: armGlowL },
  { name: "Arm_Glow_R", mesh: armGlowR },
  { name: "Arm_Accent", mesh: armAccent },
  { name: "Pauldron_L", mesh: pauldronL },
  { name: "Pauldron_R", mesh: pauldronR },
  { name: "Gun_R", mesh: gunR },
  { name: "Mount_Gun", translation: [1.2, 2.4, -1.65] },
  { name: "Torso_Fx", translation: [0, 2.6, -0.34] },
  { name: "Arm_R_Fx", translation: [1.08, 2.34, -0.3] },
  { name: "Leg_L_Fx", translation: [-legX, 1.02, -0.3] },
  // The two-bone chain ends at the hock; the short bone to the ankle and the magnetic foot stay as they are.
  ...bothLegs(hip, knee, hock, [legX, 0, ankle[2]]),
];

const dir = join(new URL("../..", import.meta.url).pathname, "assets/models/mechs/arbiter");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Arbiter.glb"), writeGlb(nodes));
const total = nodes.reduce((s, n) => s + (n.mesh ? triangles(n.mesh) : 0), 0);
console.log(`Mech_Arbiter.glb: ${total} triangles`);
