// Builds the Cataclysm, the artillery mech: a broad low hull on four splayed insect legs, twin rail-mortar barrels
// raised 30 degrees on a turret block, and a small point-defence turret on the front. One node per part, every part
// built in place on the assembled mech (metres, Y up, facing -Z, feet at y 0).
// Run: npx tsx scripts/mechs/cataclysm.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { box, cylinder, merge, mirrorX, prism, turn, wedge, type V3 } from "../assets/shapes";

const out = join(new URL("../..", import.meta.url).pathname, "assets/models/mechs/cataclysm/Mech_Cataclysm.glb");
const deg = Math.PI / 180;

// A square beam from `a` to `b`, `w` wide and `h` tall, for leg segments that run at an angle.
function beam(a: V3, b: V3, w: number, h: number, bevel: number): MeshData {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...d);
  const pitch = -Math.asin(d[1] / length);
  const yaw = Math.atan2(d[0], d[2]);
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return turn(box([0, 0, 0], [w, h, length], bevel), [pitch, yaw, 0], [0, 0, 0], mid);
}

// The hull bottom sits at 1.45 so that, when the legs break and the mech drops 1.3 m, the belly rests near the ground.
const hullBottom = 1.45;
const hullTop = 2.35;

const torso = merge(
  // Side profile swept across the width: a sloped glacis in front, a shorter slope at the back.
  prism([[hullBottom, -0.95], [hullBottom, 1.05], [1.95, 1.3], [hullTop, 1.15], [hullTop, -0.95], [1.9, -1.3]], "x", -1.12, 1.12),
  box([0, 2.42, 0.15], [1.9, 0.14, 1.9], 0.05), // top deck plate
  box([0, hullBottom + 0.02, 0.05], [1.6, 0.16, 1.7], 0.05), // belly plate the mech crawls on
  ...[-1, 1].map((s) => box([s * 1.13, 1.95, 0], [0.16, 0.55, 0.9], 0.05)), // side skirts between the legs
  ...[-0.45, 0.45].map((x) => box([x, 2.1, 1.3], [0.4, 0.35, 0.22], 0.05)), // rear exhaust blocks
);

const sensor = merge(
  box([-0.72, 2.62, 0.85], [0.42, 0.36, 0.42], 0.05),
  cylinder([-0.72, 2.95, 0.85], 0.2, 0.3, "y", 6, 0.12),
);

// The barrels hinge on a trunnion behind the turret's middle and rise 30 degrees toward -Z.
const pivot: V3 = [0, 2.95, 0.5];
const elevation = 30 * deg;
const oneBarrel = (x: number) => merge(
  box([x, pivot[1], pivot[2] - 0.7], [0.36, 0.36, 1.9], 0.05), // housing, from behind the pivot to mid length
  box([x, pivot[1] + 0.12, pivot[2] - 2.1], [0.3, 0.12, 0.95], 0.03), // upper rail
  box([x, pivot[1] - 0.12, pivot[2] - 2.1], [0.3, 0.12, 0.95], 0.03), // lower rail
  box([x, pivot[1], pivot[2] - 2.55], [0.4, 0.4, 0.14], 0.03), // muzzle collar
  box([x, pivot[1], pivot[2] + 0.35], [0.44, 0.44, 0.35], 0.05), // breech
);
const barrels = turn(merge(oneBarrel(-0.32), oneBarrel(0.32)), [elevation, 0, 0], pivot);

// The right-side sponson gun puts a muzzle at Mount_Gun, where the server fires from.
const mountGun: V3 = [1.2, 2.4, -1.65];
const armR = merge(
  cylinder([0, 2.47, 0.3], 0.75, 0.14, "y", 8), // turret ring
  box([0, 2.78, 0.3], [1.35, 0.5, 1.35], 0.08), // turret block
  wedge([0, 2.78, -0.5], [1.15, 0.5, 0.3], 0.7), // sloped turret face
  cylinder([0, pivot[1], pivot[2]], 0.18, 1.0, "x", 8), // trunnion between the barrels
  box([1.2, 2.4, -1.05], [0.26, 0.3, 0.5], 0.05), // sponson housing on the hull's right front
  cylinder([1.2, 2.4, -1.45], 0.07, 0.4, "z", 6), // sponson muzzle, ending at Mount_Gun
);

const armL = merge(
  cylinder([-0.55, 2.47, -0.85], 0.3, 0.14, "y", 8),
  box([-0.55, 2.68, -0.85], [0.5, 0.3, 0.5], 0.06),
  ...[-0.63, -0.47].map((x) => cylinder([x, 2.7, -1.3], 0.06, 0.5, "z", 6)),
);

// One leg on the right front (+X, -Z); the others are mirrored across x and z. Hip on the hull side, the upper
// segment angles out and up to the knee, the lower segment drops to a broad flat foot.
function rightFrontLeg(): MeshData {
  const hip: V3 = [1.1, 1.85, -0.85], knee: V3 = [1.78, 2.35, -1.25], ankle: V3 = [1.38, 0.35, -1.25];
  return merge(
    cylinder([1.18, hip[1], hip[2]], 0.3, 0.3, "x", 8), // hip socket
    beam(hip, knee, 0.45, 0.4, 0.06),
    cylinder(knee, 0.3, 0.5, "z", 8), // knee
    beam(knee, ankle, 0.38, 0.38, 0.06),
    box([ankle[0], 0.3, ankle[2]], [0.34, 0.25, 0.34], 0.04), // ankle block
    box([1.32, 0.1, -1.25], [0.55, 0.2, 0.55], 0.05), // foot pad
    wedge([1.32, 0.12, -1.57], [0.45, 0.16, 0.12], 0.8), // toe, the recoil anchor lip
  );
}
const mirrorZ = (m: MeshData) => turn(mirrorX(m), [0, Math.PI, 0]); // mirror in x, then turn half round: a z mirror
const legFR = rightFrontLeg();
const legFL = mirrorX(legFR);
const legBR = mirrorZ(legFR);
const legBL = mirrorX(legBR);

const nodes: NodeData[] = [
  { name: "Torso", mesh: torso },
  { name: "Sensor", mesh: sensor },
  { name: "Arm_R", mesh: armR },
  { name: "Barrels", mesh: barrels },
  { name: "Arm_L", mesh: armL },
  { name: "Leg_FL", mesh: legFL },
  { name: "Leg_FR", mesh: legFR },
  { name: "Leg_BL", mesh: legBL },
  { name: "Leg_BR", mesh: legBR },
  { name: "Mount_Gun", translation: mountGun },
  { name: "Torso_Fx", translation: [0, 2.5, 0.9] },
  { name: "Arm_R_Fx", translation: [0.5, 3.05, 0.3] },
  { name: "Leg_FL_Fx", translation: [-1.78, 2.35, -1.25] },
];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, writeGlb(nodes));
console.log(`Wrote ${out}`);
