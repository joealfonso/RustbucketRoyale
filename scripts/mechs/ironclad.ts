// Builds the Ironclad-IV, the brawler: a top-heavy wall of squared-off plating with a rotary autocannon on the right
// arm, a slab siege shield and pile driver on the left, and missile pods on the shoulders. Every part is built in
// place on the assembled mech (metres, Y up, facing -Z, right side +X, feet at y 0), one merged mesh per part.
// Zones and paints for each part live in data/mechKits.json, not here.
// Run: npx tsx scripts/mechs/ironclad.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { box, cylinder, merge, mirrorX, wedge, type V3 } from "../assets/shapes";

// Both sides of a pair from the right-hand (+X) version.
const pair = (right: MeshData) => merge(right, mirrorX(right));

// A bevelled box from its min and max corners, which reads more easily than centre and size for stacked plating.
function slab(min: V3, max: V3, bevel = 0): MeshData {
  return box([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], [max[0] - min[0], max[1] - min[1], max[2] - min[2]], bevel);
}

// Torso: a core hull with layered plates on the chest, flanks and back, like dreadnought belt armour.
const torso = merge(
  slab([-0.82, 1.75, -0.5], [0.82, 3.05, 0.5], 0.08), // core hull
  slab([-0.88, 2.4, -0.62], [0.88, 2.98, -0.3], 0.06), // upper chest plate
  wedge([0, 3.08, -0.36], [1.6, 0.24, 0.5], 0.6), // glacis sloping back from the chest to the neck
  slab([-0.7, 1.78, -0.6], [0.7, 2.36, -0.3], 0.06), // belly plate, set back from the chest plate so the layers read
  pair(slab([0.8, 1.9, -0.45], [0.92, 2.9, 0.42], 0.04)), // flank plates
  slab([-0.75, 2.85, -0.1], [0.75, 3.18, 0.5], 0.06), // shoulder deck that the pods and head sit on
);

// Head: small and sunk low between the pods, so the shoulders stay the silhouette.
const sensor = merge(
  slab([-0.28, 2.98, -0.48], [0.28, 3.36, 0.02], 0.05),
  wedge([0, 3.4, -0.2], [0.5, 0.1, 0.4], 0.4), // brow
);

// Missile pods: one boxy launcher per shoulder. Their dark cell grid is in the frame, so it stays trim.
const pods = pair(merge(
  slab([0.72, 3.02, -0.46], [1.55, 3.6, 0.42], 0.07),
  slab([0.78, 3.1, 0.42], [1.48, 3.5, 0.52], 0.04), // rear reload hatch
));

const podCells: MeshData[] = [];
for (const x of [0.88, 1.135, 1.39]) {
  for (const y of [3.18, 3.42]) podCells.push(slab([x - 0.09, y - 0.09, -0.49], [x + 0.09, y + 0.09, -0.44]));
}

// Frame: waist, hips, neck collar, shoulder joints, visor and pod cells, all the dark mechanical bits of the torso.
const frame = merge(
  slab([-0.45, 1.4, -0.3], [0.45, 1.82, 0.3], 0.04), // waist
  cylinder([0, 1.5, 0], 0.15, 0.7, "x", 8), // hip bar
  slab([-0.36, 2.9, -0.5], [0.36, 3.02, 0.1], 0.03), // neck collar
  slab([-0.22, 3.12, -0.52], [0.22, 3.24, -0.46]), // visor slit
  pair(cylinder([0.97, 2.8, 0], 0.2, 0.24, "x", 8)), // shoulder joints
  pair(merge(...podCells)),
);

// Jets: two thruster housings on the back, nozzles pointing down.
const jets = pair(merge(
  slab([0.18, 2.0, 0.48], [0.62, 2.9, 0.84], 0.05),
  cylinder([0.4, 1.9, 0.68], 0.15, 0.2, "y", 8, 0.12), // nozzle, flared at the bottom
));

// Right arm: pauldron, short upper arm and a long forearm housing that holds the autocannon, with an ammo drum.
const armR = merge(
  slab([0.92, 2.6, -0.4], [1.55, 3.0, 0.35], 0.06), // pauldron
  slab([1.02, 2.5, -0.2], [1.38, 2.75, 0.2], 0.04), // upper arm
  slab([0.98, 2.14, -0.95], [1.42, 2.66, 0.2], 0.06), // forearm housing
  slab([1.42, 2.2, -0.75], [1.62, 2.55, -0.25], 0.04), // ammo drum
);

// Rotary autocannon: a hub, six barrels round it and a clamp ring near the muzzle. The barrels end at the gun mount.
const muzzleZ = -1.65, breechZ = -1.0;
const barrels: MeshData[] = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  barrels.push(cylinder([1.2 + Math.cos(a) * 0.12, 2.4 + Math.sin(a) * 0.12, (muzzleZ + breechZ) / 2], 0.055, breechZ - muzzleZ, "z", 6));
}
const autocannon = merge(
  cylinder([1.2, 2.4, -1.08], 0.21, 0.3, "z", 8), // hub
  cylinder([1.2, 2.4, -1.45], 0.2, 0.07, "z", 8), // clamp ring
  ...barrels,
);

// Left arm: pauldron, upper arm, and a forearm that the shield and pile driver bolt to.
const armL = merge(
  slab([-1.55, 2.6, -0.4], [-0.92, 3.0, 0.35], 0.06),
  slab([-1.38, 2.15, -0.2], [-1.02, 2.65, 0.2], 0.04),
  slab([-1.42, 1.85, -0.6], [-0.98, 2.28, 0.15], 0.05),
);

// Siege shield: a big slab in front of the left arm with a raised face plate and a reinforcing bar.
const shield = merge(
  slab([-1.85, 1.7, -0.86], [-0.85, 3.2, -0.66], 0.08),
  slab([-1.75, 1.82, -0.93], [-0.95, 3.08, -0.85], 0.04),
  slab([-1.88, 2.35, -0.98], [-0.82, 2.55, -0.9], 0.03),
);

// Pile driver: a ram cylinder behind the shield with its rod cocked out the back, and the punch head through the face.
const pileDriver = merge(
  cylinder([-1.2, 2.05, -0.2], 0.14, 0.9, "z", 8), // ram housing, from the shield back to behind the elbow
  cylinder([-1.2, 2.05, 0.37], 0.08, 0.25, "z", 6), // cocked rod
  cylinder([-1.2, 2.05, -0.97], 0.17, 0.12, "z", 8), // punch head standing out of the shield face
  slab([-1.38, 2.22, -0.68], [-1.02, 2.4, -0.55]), // bracket from forearm to shield
);

// Legs: thick thigh and shin armour with a knee plate. The left is the mirror of the right.
const legR = merge(
  slab([0.32, 0.95, -0.32], [0.82, 1.55, 0.28], 0.06), // thigh
  slab([0.36, 0.8, -0.42], [0.78, 1.12, -0.2], 0.05), // knee plate
  slab([0.34, 0.25, -0.34], [0.8, 0.9, 0.2], 0.06), // shin
);

const footR = merge(
  slab([0.28, 0, -0.6], [0.88, 0.22, 0.42], 0.05), // sole
  wedge([0.58, 0.3, -0.12], [0.5, 0.16, 0.6], 0.5), // instep, sloping up from the toe
  slab([0.44, 0.2, -0.15], [0.72, 0.36, 0.15], 0.03), // ankle block
);

// Pistons: exposed hydraulics on the outside and back of each leg, plus the hip and knee joints.
const pistonsR = merge(
  cylinder([0.87, 1.25, 0.04], 0.09, 0.5, "y", 8), // outer sleeve
  cylinder([0.87, 0.7, 0.04], 0.055, 0.7, "y", 6), // outer rod
  cylinder([0.57, 1.2, 0.33], 0.1, 0.5, "y", 8), // back sleeve
  cylinder([0.57, 0.65, 0.33], 0.06, 0.7, "y", 6), // back rod
  cylinder([0.57, 0.95, -0.02], 0.15, 0.58, "x", 8), // knee joint
  cylinder([0.36, 1.5, 0], 0.18, 0.2, "x", 8), // hip joint
);

const parts: NodeData[] = [
  { name: "Torso", mesh: torso },
  { name: "Sensor", mesh: sensor },
  { name: "Shoulder_Pods", mesh: pods },
  { name: "Frame", mesh: frame },
  { name: "Jets", mesh: jets },
  { name: "Arm_R", mesh: armR },
  { name: "Autocannon", mesh: autocannon },
  { name: "Arm_L", mesh: armL },
  { name: "Shield", mesh: shield },
  { name: "Pile_Driver", mesh: pileDriver },
  { name: "Leg_R", mesh: legR },
  { name: "Leg_L", mesh: mirrorX(legR) },
  { name: "Feet", mesh: pair(footR) },
  { name: "Pistons", mesh: pair(pistonsR) },
  // The server fires from (1.2, 2.4, -1.4), so the muzzle sits just ahead of it.
  { name: "Mount_Gun", translation: [1.2, 2.4, muzzleZ] },
  { name: "Torso_Fx", translation: [0, 3.18, 0.25] },
  { name: "Arm_R_Fx", translation: [1.2, 2.66, -0.45] },
  { name: "Leg_L_Fx", translation: [-0.82, 1.25, 0] },
];

const dir = join(new URL("../..", import.meta.url).pathname, "assets/models/mechs/ironclad");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Ironclad.glb"), writeGlb(parts));
console.log(`Wrote ${join(dir, "Mech_Ironclad.glb")}`);
