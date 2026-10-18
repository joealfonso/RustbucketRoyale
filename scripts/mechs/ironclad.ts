// Builds the Ironclad-IV, the heavy brawler (docs/MECH_ROSTER.md, section 1): a square-shouldered block of dark grey
// plating with yellow and black hazard stripes on the shoulders and shins, a small head sunk deep in the torso with
// one red eye, a rotary autocannon in the right forearm, a wedge-edged siege shield with a pile driver on the left,
// two missile pods set into the upper torso blocks, and stocky reverse-jointed legs with exposed pistons.
// Every part is built in place on the assembled mech (metres, Y up, facing -Z, right side +X, feet at y 0), one merged
// mesh per part and one paint per part. Zones, paints and flags are in scripts/mechs/ironclad.kit.json.
// Run: npx tsx scripts/mechs/ironclad.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { box, cylinder, merge, mirrorX, prism, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

type UV = [number, number];

// Both sides of a pair from the right-hand (+X) version.
const pair = (right: MeshData) => merge(right, mirrorX(right));

// A bevelled box from its min and max corners, which reads more easily than centre and size for stacked plating.
function slab(min: V3, max: V3, bevel = 0): MeshData {
  return box([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], [max[0] - min[0], max[1] - min[1], max[2] - min[2]], bevel);
}

// A mesh built upright round y = z = 0 (its long axis on +Y), tilted in the side view and moved so it runs from the
// lower point `b` up to the upper point `a`. The legs are made of these, since the knee bends back.
function between(a: V3, b: V3, mesh: MeshData): MeshData {
  const tilt = Math.atan2(a[2] - b[2], a[1] - b[1]);
  return turn(mesh, [tilt, 0, 0], [0, 0, 0], [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}
const length = (a: V3, b: V3) => Math.hypot(a[1] - b[1], a[2] - b[2]);

// The part of a convex outline where `keep` is not negative (one Sutherland-Hodgman pass against a straight line).
function clip(outline: UV[], keep: (p: UV) => number): UV[] {
  const out: UV[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!, q = outline[(i + 1) % outline.length]!;
    const kp = keep(p), kq = keep(q);
    if (kp >= 0) out.push(p);
    if ((kp >= 0) !== (kq >= 0)) { const t = kp / (kp - kq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

const area = (o: UV[]) => Math.abs(o.reduce((s, p, i) => { const q = o[(i + 1) % o.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

// Hazard stripes: the yellow bands of 45 degree stripes across the rectangle u0..u1 by v0..v1, `width` wide with
// black gaps of the same width. Slivers cut off at the corners are dropped, as they would be thinner than a plate.
function stripes(u0: number, u1: number, v0: number, v1: number, width: number): UV[][] {
  const rect: UV[] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const out: UV[][] = [];
  for (let s = u0 - v1 + width * 0.5; s < u1 - v0; s += width * 2) {
    const band = clip(clip(rect, ([u, v]) => u - v - s), ([u, v]) => s + width - (u - v));
    if (band.length >= 3 && area(band) > width * width * 0.6) out.push(band);
  }
  return out;
}

// A stripe panel on one face: a black backing plate and the yellow stripes standing a little proud of it. `axis` is
// the face's normal, `at` the face's position along it and `out` +1 or -1 for which way the face looks.
function hazardPanel(axis: "x" | "y" | "z", at: number, out: number, u: [number, number], v: [number, number], width: number) {
  const back = prism([[u[0], v[0]], [u[1], v[0]], [u[1], v[1]], [u[0], v[1]]], axis, at - out * 0.04, at + out * 0.04);
  const yellow = merge(...stripes(u[0], u[1], v[0], v[1], width).map((o) => prism(o, axis, at - out * 0.02, at + out * 0.07)));
  return { black: back, yellow };
}

// ---- Torso: a core hull with a belly plate, chest plate and flanks, and two big upper armour blocks at the corners.
// The head sits in the gap between the blocks, behind a chin guard and under a brow hood, so only a slit shows.
const torso = merge(
  slab([-0.8, 1.7, -0.5], [0.8, 2.86, 0.5], 0.08), // core hull
  slab([-0.68, 1.72, -0.6], [0.68, 2.26, -0.4], 0.06), // belly plate
  slab([-0.86, 2.22, -0.66], [0.86, 2.72, -0.38], 0.07), // chest plate, wider than the belly so the layers read
  pair(slab([0.79, 1.86, -0.46], [0.93, 2.6, 0.42], 0.04)), // flank plates
  pair(slab([0.33, 2.55, -0.63], [0.95, 3.1, 0.52], 0.08)), // upper armour blocks
  pair(slab([0.36, 3.0, 0.08], [0.94, 3.3, 0.5], 0.06)), // rear cowl behind each pod
  slab([-0.36, 2.68, -0.68], [0.36, 2.94, -0.38], 0.06), // chin guard in front of the head
  slab([-0.36, 3.1, -0.64], [0.36, 3.26, 0.04], 0.05), // brow hood over it
  pair(slab([0.2, 1.95, 0.48], [0.6, 2.72, 0.8], 0.05)), // jump jet housings on the back
);

// Head: small and dark, a full 0.2 m behind the armour fronts. The eye looks out through the slit.
const head = slab([-0.26, 2.8, -0.44], [0.26, 3.14, 0.12], 0.05);
const sensor = cylinder([0, 3.02, -0.48], 0.07, 0.1, "z", 8);

// Missile pods: one box per side, sunk into the top of its armour block and standing out of its front.
const PODS = pair(slab([0.4, 2.92, -0.7], [0.9, 3.38, 0.05], 0.05));
const podCells: MeshData[] = [];
for (const x of [0.51, 0.65, 0.79]) {
  for (const y of [3.06, 3.24]) podCells.push(slab([x - 0.055, y - 0.065, -0.74], [x + 0.055, y + 0.065, -0.66]));
}
// The pilot's marking: one band round the right pod.
const accentBand = slab([0.38, 2.96, -0.42], [0.92, 3.41, -0.3], 0.02);

// Frame: waist, hip bar, the pods' launch cells and the jet nozzles, the dark mechanical bits of the torso.
const frame = merge(
  slab([-0.45, 1.4, -0.3], [0.45, 1.8, 0.3], 0.04), // waist
  cylinder([0, 1.48, 0], 0.15, 0.62, "x", 8), // hip bar
  pair(merge(...podCells)),
  pair(cylinder([0.4, 1.88, 0.64], 0.13, 0.18, "y", 8, 0.17)), // jet nozzles, flared at the bottom
);

// ---- Arms. Each has a big square pauldron (the wide shoulders), an upper arm, a forearm, and joints in the frame.
const pauldronR = slab([0.9, 2.62, -0.48], [1.62, 3.18, 0.42], 0.07);
const upperArmR = slab([1.04, 2.3, -0.2], [1.38, 2.72, 0.2], 0.05);

// Hazard stripes on each pauldron's outer face and top, the face seen from behind and the one seen from the side.
const outerStripes = hazardPanel("x", 1.62, 1, [2.7, 3.1], [-0.4, 0.34], 0.12);
const topStripes = hazardPanel("y", 3.18, 1, [-0.4, 0.34], [0.98, 1.54], 0.12);
const shoulderBlack = pair(merge(outerStripes.black, topStripes.black));
const shoulderYellow = pair(merge(outerStripes.yellow, topStripes.yellow));

// Right arm: the forearm is one long housing that the autocannon comes out of, with an ammo drum on the outside.
const armR = merge(
  pauldronR,
  upperArmR,
  slab([0.96, 2.12, -1.0], [1.44, 2.66, -0.1], 0.06), // forearm housing
  slab([1.44, 2.18, -0.78], [1.66, 2.58, -0.22], 0.05), // ammo drum
);

// Rotary autocannon: a hub at the front of the forearm, six barrels round it, and two clamp rings. The barrels end
// at the gun mount.
const GUN: V3 = [1.2, 2.4, -1.65];
const breechZ = -1.0;
const barrels: MeshData[] = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  barrels.push(cylinder([GUN[0] + Math.cos(a) * 0.13, GUN[1] + Math.sin(a) * 0.13, (GUN[2] + breechZ) / 2], 0.05, breechZ - GUN[2], "z", 6));
}
const autocannon = merge(
  cylinder([GUN[0], GUN[1], -1.07], 0.23, 0.16, "z", 8), // hub
  cylinder([GUN[0], GUN[1], -1.36], 0.2, 0.08, "z", 8), // clamp ring
  cylinder([GUN[0], GUN[1], -1.58], 0.2, 0.08, "z", 8), // muzzle ring
  ...barrels,
);

// Left arm: a shorter forearm with a fist that grips the back of the shield.
const armL = merge(
  mirrorX(pauldronR),
  mirrorX(upperArmR),
  slab([-1.44, 1.9, -0.6], [-0.98, 2.38, 0.15], 0.05), // forearm
  slab([-1.42, 1.94, -0.84], [-1.0, 2.32, -0.58], 0.05), // fist
);

// Siege shield: a thick slab whose front comes to a vertical knife edge, the ramming edge, with three reinforcing
// bands round it. Outlines are (z, x), swept up the y axis.
const SHIELD_EDGE_X = -1.4;
const chevron = (grow: number): UV[] => [
  [-0.8, -1.95 - grow], [-0.8, -0.85 + grow], [-1.0 - grow, -0.85 + grow], [-1.22 - grow * 1.4, SHIELD_EDGE_X], [-1.0 - grow, -1.95 - grow],
];
const shield = merge(
  prism(chevron(0), "y", 1.5, 3.28),
  prism(chevron(0.04), "y", 1.66, 1.84),
  prism(chevron(0.04), "y", 2.3, 2.52),
  prism(chevron(0.04), "y", 2.96, 3.14),
);

// Pile driver: a ram cylinder along the top of the fist, its rod cocked out the back, and the spike standing out of
// the shield's knife edge.
const PILE: [number, number] = [SHIELD_EDGE_X, 2.5];
const pileDriver = merge(
  cylinder([PILE[0], PILE[1], -0.36], 0.16, 0.86, "z", 8), // ram housing
  cylinder([PILE[0], PILE[1], -0.72], 0.2, 0.1, "z", 8), // front collar
  cylinder([PILE[0], PILE[1], 0.02], 0.2, 0.1, "z", 8), // rear collar
  cylinder([PILE[0], PILE[1], 0.28], 0.075, 0.44, "z", 6), // cocked rod
  cylinder([PILE[0], PILE[1], 0.53], 0.12, 0.08, "z", 8), // rod cap
  cylinder([PILE[0] + 0.19, PILE[1] - 0.12, -0.4], 0.05, 0.6, "z", 6), // side hydraulic line
  cylinder([PILE[0], PILE[1], -1.32], 0.13, 0.4, "z", 8, 0.04), // spike
  slab([-1.5, 2.3, -0.7], [-1.3, 2.38, 0.0]), // saddle on the fist
);

// Arm frame: shoulder and elbow joints, and the ammo feed from the drum into the forearm.
const armFrame = merge(
  pair(cylinder([0.97, 2.84, 0], 0.2, 0.22, "x", 8)), // shoulder joints
  cylinder([1.2, 2.4, 0.02], 0.17, 0.5, "x", 8), // right elbow
  cylinder([-1.2, 2.2, 0.1], 0.17, 0.5, "x", 8), // left elbow
  slab([1.46, 2.26, -0.22], [1.6, 2.5, 0.02]), // ammo feed
);

// ---- Legs: the hip, a knee that sits back, and an ankle forward of it, so the knee bends backward a little.
// Right side, then mirrored.
const LX = 0.57;
const HIP: V3 = [LX, 1.46, 0], KNEE: V3 = [LX, 0.9, 0.2], ANKLE: V3 = [LX, 0.34, -0.06];
const SHIN_W = 0.5, SHIN_D = 0.44;
const shinLength = length(KNEE, ANKLE);

// Shin stripes on the front face, built upright with the shin and tilted with it.
const shinPanel = hazardPanel("z", -SHIN_D / 2, -1, [LX - 0.2, LX + 0.2], [-shinLength / 2 + 0.1, shinLength / 2 - 0.08], 0.11);

const legR = merge(
  slab([0.3, 1.28, -0.4], [0.86, 1.64, 0.26], 0.07), // hip armour
  between(HIP, KNEE, box([LX, 0, 0], [0.5, length(HIP, KNEE) + 0.2, 0.46], 0.07)), // thigh
  between(KNEE, ANKLE, box([LX, 0, 0], [SHIN_W, shinLength, SHIN_D], 0.07)), // shin
  between(KNEE, ANKLE, box([LX, shinLength / 2 + 0.02, 0.1], [0.44, 0.24, 0.3], 0.06)), // knee cap at the back
  slab([0.29, 0.16, -0.36], [0.85, 0.5, 0.2], 0.07), // ankle armour, thick to take the recoil
);

// Feet: a broad sole, a toe plate and a heel spur, planted wide for stability.
const footR = merge(
  slab([0.26, 0, -0.7], [0.88, 0.2, 0.36], 0.05), // sole
  slab([0.3, 0.14, -0.76], [0.84, 0.3, -0.38], 0.05), // toe plate
  slab([0.4, 0.04, 0.3], [0.74, 0.26, 0.52], 0.04), // heel spur
);

// Pistons: hip, knee and ankle joints, a piston down the outside spanning the knee, and a calf piston behind the shin.
const pistonsR = merge(
  cylinder([0.36, HIP[1], HIP[2]], 0.19, 0.2, "x", 8), // hip joint
  cylinder([LX, KNEE[1], KNEE[2]], 0.16, 0.62, "x", 8), // knee joint
  cylinder([LX, ANKLE[1], ANKLE[2]], 0.14, 0.58, "x", 8), // ankle joint
  between([0.88, 1.36, 0.02], [0.88, 0.95, 0.0], cylinder([0.88, 0, 0], 0.09, 0.41, "y", 8)), // outer sleeve
  between([0.88, 0.98, 0.0], [0.88, 0.56, -0.02], cylinder([0.88, 0, 0], 0.055, 0.42, "y", 6)), // outer rod
  between([LX, 0.96, 0.4], [LX, 0.64, 0.3], cylinder([LX, 0, 0], 0.09, 0.32, "y", 8)), // calf sleeve
  between([LX, 0.66, 0.31], [LX, 0.3, 0.24], cylinder([LX, 0, 0], 0.055, 0.38, "y", 6)), // calf rod
);

const shinOnLeg = (m: MeshData) => between(KNEE, ANKLE, m);

const parts: NodeData[] = [
  { name: "Torso", mesh: torso },
  { name: "Head", mesh: head },
  { name: "Sensor", mesh: sensor },
  { name: "Missile_Pods", mesh: PODS },
  { name: "Accent_Band", mesh: accentBand },
  { name: "Frame", mesh: frame },
  { name: "Arm_R", mesh: armR },
  { name: "Autocannon", mesh: autocannon },
  { name: "Arm_L", mesh: armL },
  { name: "Shield", mesh: shield },
  { name: "Pile_Driver", mesh: pileDriver },
  { name: "Arm_Frame", mesh: armFrame },
  { name: "Shoulder_Stripes", mesh: shoulderYellow },
  { name: "Shoulder_Stripes_Black", mesh: shoulderBlack },
  { name: "Leg_R", mesh: legR },
  { name: "Leg_L", mesh: mirrorX(legR) },
  { name: "Feet", mesh: pair(footR) },
  { name: "Pistons", mesh: pair(pistonsR) },
  { name: "Shin_Stripes", mesh: pair(shinOnLeg(shinPanel.yellow)) },
  { name: "Shin_Stripes_Black", mesh: pair(shinOnLeg(shinPanel.black)) },
  // The server fires from (1.2, 2.4, -1.4), so the muzzle sits just ahead of it.
  { name: "Mount_Gun", translation: GUN },
  { name: "Torso_Fx", translation: [0, 3.0, 0.25] },
  { name: "Arm_R_Fx", translation: [1.2, 2.66, -0.45] },
  { name: "Leg_L_Fx", translation: [-0.82, 1.1, 0.05] },
];

const dir = join(new URL("../..", import.meta.url).pathname, "assets/models/mechs/ironclad");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "Mech_Ironclad.glb"), writeGlb(parts));
const total = parts.reduce((s, p) => s + (p.mesh ? triangles(p.mesh) : 0), 0);
console.log(`Wrote ${join(dir, "Mech_Ironclad.glb")} (${total} triangles)`);
