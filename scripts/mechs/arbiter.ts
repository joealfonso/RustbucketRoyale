// Arbiter, the command and electronic warfare mech: slim limbs, a narrow torso, a big flattened radome for a head and
// three sensor drones hanging in the air around it. It should read at range as "the one with the big dome and the drones".
// Run: npx tsx scripts/mechs/arbiter.ts  →  assets/models/mechs/arbiter/Mech_Arbiter.glb
// Metres, Y up, facing -Z, right side +X, feet at y = 0. Every part is built in place on the assembled mech.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MeshData, NodeData } from "../assets/glbWrite";
import { writeGlb } from "../assets/glbWrite";
import { box, convex, cylinder, merge, mirrorX, prism, triangles, turn, wedge, type V3 } from "../assets/shapes";

// A flattened lens: a dome of `up` metres above the rim and a shallow bowl of `down` metres below it, elliptical in
// plan (rx across, rz front to back). Rings follow a quarter circle so the dome reads round with few faces.
function dome(centre: V3, rx: number, rz: number, up: number, down: number, sides: number, rings: number): MeshData {
  const ring = (scale: number, y: number): V3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return [centre[0] + Math.cos(a) * rx * scale, centre[1] + y, centre[2] + Math.sin(a) * rz * scale] as V3;
    });
  const layers: V3[][] = [ring(0.45, -down), ring(1, 0)];
  for (let r = 1; r <= rings; r++) {
    const t = (r / (rings + 1)) * (Math.PI / 2);
    layers.push(ring(Math.cos(t), Math.sin(t) * up));
  }
  const faces: V3[][] = [layers[0]!, layers[layers.length - 1]!];
  for (let l = 0; l < layers.length - 1; l++) {
    const a = layers[l]!, b = layers[l + 1]!;
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; faces.push([a[i]!, a[j]!, b[j]!, b[i]!]); }
  }
  return convex(faces);
}

// ---- Legs (legs zone). Built for the right leg, mirrored for the left. Slim shins, a forward-raked foot.
const legX = 0.36;
const rightLeg = merge(
  box([legX, 0.09, -0.08], [0.32, 0.18, 0.62], 0.04),
  wedge([legX, 0.2, -0.24], [0.26, 0.1, 0.3], 0.6),
  turn(box([legX, 0.5, 0.02], [0.24, 0.62, 0.28], 0.05), [0.08, 0, 0], [legX, 0.5, 0]),
  box([legX, 1.18, 0], [0.28, 0.56, 0.32], 0.05),
);
const rightLegFrame = merge(
  cylinder([legX, 0.86, 0], 0.13, 0.3, "x", 8),
  cylinder([legX, 0.2, 0.02], 0.1, 0.22, "x", 6),
  cylinder([legX, 1.45, 0], 0.13, 0.26, "x", 8),
);
const legFrame = merge(
  rightLegFrame,
  mirrorX(rightLegFrame),
  box([0, 1.5, 0], [0.56, 0.22, 0.36], 0.04), // pelvis
);
// Knee guards in the pilot colour, so a running Arbiter flashes colour at the joints.
const rightKnee = box([legX, 0.9, -0.15], [0.2, 0.24, 0.1], 0.03);

// ---- Torso (torso zone). Narrow, tapering to the waist, a shoulder yoke on top, a trim backpack.
const torso = merge(
  prism([[-0.24, 1.9], [0.24, 1.9], [0.4, 2.3], [0.38, 2.82], [-0.38, 2.82], [-0.4, 2.3]], "z", -0.3, 0.3),
  box([0, 2.92, 0.02], [0.96, 0.26, 0.56], 0.06),
);
// Offset to the right on purpose: the plate shields the gun-side of the chest, the side that faces the enemy.
const chestPlate = turn(box([0.06, 2.45, -0.33], [0.5, 0.5, 0.1], 0.03), [-0.12, 0, 0], [0.06, 2.45, -0.33]);
const torsoFrame = merge(
  box([0, 1.74, 0], [0.36, 0.3, 0.3], 0.04), // waist
  box([0, 2.45, 0.42], [0.56, 0.7, 0.26], 0.05), // backpack
  cylinder([0.6, 2.82, 0], 0.13, 0.3, "x", 8), // shoulder joints
  cylinder([-0.6, 2.82, 0], 0.13, 0.3, "x", 8),
);

// ---- Radome head (torso zone). Bigger than a normal head on a short neck; it is the silhouette.
const domeY = 3.36;
const sensor = dome([0, domeY, 0.02], 0.74, 0.62, 0.42, 0.18, 16, 4);
const sensorBand = cylinder([0, domeY, 0.02], 0.77, 0.08, "y", 16, 0.77);
const sensorFrame = merge(
  cylinder([0, 3.1, 0.02], 0.16, 0.24, "y", 8), // neck
  turn(box([0, domeY + 0.13, -0.56], [0.42, 0.11, 0.14], 0.03), [0.35, 0, 0], [0, domeY + 0.13, -0.56]), // eye slit
);

// ---- Comms mast on the left shoulder. The asymmetry has a job: the mast relays the drones, and it sits on the side
// away from the gun so it is not in the line of fire.
const mastX = -0.86, mastZ = 0.3;
const mast = merge(
  box([-0.68, 3.0, mastZ], [0.4, 0.16, 0.2], 0.03),
  cylinder([mastX, 3.66, mastZ], 0.055, 1.3, "y", 6),
  box([mastX, 3.9, mastZ], [0.4, 0.08, 0.08]),
  box([mastX, 4.16, mastZ], [0.28, 0.08, 0.08]),
  cylinder([mastX, 4.37, mastZ], 0.09, 0.12, "y", 6, 0.04),
);

// ---- Arms (arms zone).
// Right arm: upper arm hangs, forearm points forward and carries the compact wrist SMG.
const rightArm = merge(
  box([1.1, 2.48, 0], [0.22, 0.5, 0.24], 0.04),
  box([1.14, 2.36, -0.55], [0.26, 0.26, 0.78], 0.05),
);
const gunR = merge(
  box([1.2, 2.42, -1.06], [0.22, 0.24, 0.5], 0.04),
  box([1.2, 2.24, -1.02], [0.12, 0.2, 0.14], 0.02), // magazine
  cylinder([1.2, 2.42, -1.37], 0.1, 0.14, "z", 8), // shroud
  cylinder([1.2, 2.42, -1.52], 0.06, 0.26, "z", 6), // barrel, muzzle at z = -1.65
);
// Left arm: slimmer, hangs at the side, forearm angled a little forward with an emitter dish on its front.
const leftForearmPivot: V3 = [-1.12, 2.24, 0];
const forearmTilt = 0.35; // radians about x; positive swings the hanging forearm forward
const leftArm = merge(
  box([-1.1, 2.5, 0], [0.18, 0.46, 0.2], 0.04),
  turn(box([-1.12, 2.0, 0], [0.2, 0.5, 0.22], 0.04), [forearmTilt, 0, 0], leftForearmPivot),
);
// Where the dish sits: a point on the forearm's front, turned with the forearm about x.
const dy = 1.98 - leftForearmPivot[1], dz = -0.16 - leftForearmPivot[2];
const ep: V3 = [-1.12, leftForearmPivot[1] + dy * Math.cos(forearmTilt) - dz * Math.sin(forearmTilt), leftForearmPivot[2] + dy * Math.sin(forearmTilt) + dz * Math.cos(forearmTilt)];
const emitterL = cylinder([ep[0], ep[1], ep[2] - 0.08], 0.22, 0.12, "z", 10, 0.09); // wide face forward
const armFrame = merge(
  cylinder([1.11, 2.26, 0], 0.12, 0.26, "x", 8), // right elbow
  cylinder([-1.1, 2.26, 0], 0.11, 0.22, "x", 8), // left elbow
  cylinder([ep[0], ep[1], ep[2] - 0.16], 0.1, 0.06, "z", 8), // emitter lens
  turn(box([-1.12, 1.66, 0], [0.16, 0.16, 0.18], 0.02), [forearmTilt, 0, 0], leftForearmPivot), // left hand
);
const pauldronR = box([1.04, 2.84, 0], [0.4, 0.32, 0.5], 0.06);
const pauldrons = merge(pauldronR, box([-1.02, 2.84, 0], [0.34, 0.28, 0.44], 0.06));

// ---- Drones (torso zone): three small discs with two stubby rotor arms each, floating free, each tilted a little so
// they look like they are holding station in the wind.
function drone(at: V3, tilt: V3): MeshData {
  const [x, y, z] = at;
  const body = merge(
    cylinder([x, y, z], 0.2, 0.12, "y", 10),
    cylinder([x, y + 0.1, z], 0.12, 0.08, "y", 6, 0.07),
    box([x, y, z - 0.19], [0.12, 0.08, 0.08]), // sensor nub, faces forward
    box([x, y, z], [0.7, 0.08, 0.1]), // rotor arms
    cylinder([x + 0.36, y + 0.04, z], 0.13, 0.08, "y", 6),
    cylinder([x - 0.36, y + 0.04, z], 0.13, 0.08, "y", 6),
  );
  return turn(body, tilt, at);
}
const drones = merge(
  drone([1.8, 3.45, 0.5], [0.1, 0.4, -0.15]),
  drone([-1.75, 3.1, -0.35], [-0.1, -0.5, 0.12]),
  drone([0.45, 4.25, 0.95], [0.15, 0.9, 0.05]),
);

const nodes: NodeData[] = [
  { name: "Torso", mesh: torso },
  { name: "Torso_Frame", mesh: torsoFrame },
  { name: "Chest_Plate", mesh: chestPlate },
  { name: "Sensor", mesh: sensor },
  { name: "Sensor_Band", mesh: sensorBand },
  { name: "Sensor_Frame", mesh: sensorFrame },
  { name: "Mast", mesh: mast },
  { name: "Drones", mesh: drones },
  { name: "Leg_L", mesh: mirrorX(rightLeg) },
  { name: "Leg_R", mesh: rightLeg },
  { name: "Leg_Frame", mesh: legFrame },
  { name: "Knee_Guards", mesh: merge(rightKnee, mirrorX(rightKnee)) },
  { name: "Arm_L", mesh: leftArm },
  { name: "Arm_R", mesh: rightArm },
  { name: "Arm_Frame", mesh: armFrame },
  { name: "Pauldrons", mesh: pauldrons },
  { name: "Gun_R", mesh: gunR },
  { name: "Emitter_L", mesh: emitterL },
  { name: "Mount_Gun", translation: [1.2, 2.42, -1.65] },
  { name: "Torso_Fx", translation: [0.2, 2.6, -0.36] },
  { name: "Arm_R_Fx", translation: [1.12, 2.3, -0.12] },
  { name: "Leg_L_Fx", translation: [-legX, 0.86, -0.16] },
];

const dir = join(new URL("../..", import.meta.url).pathname, "assets/models/mechs/arbiter");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Arbiter.glb"), writeGlb(nodes));
const total = nodes.reduce((s, n) => s + (n.mesh ? triangles(n.mesh) : 0), 0);
console.log(`Mech_Arbiter.glb: ${total} triangles`);
