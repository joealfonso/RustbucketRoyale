// Cataclysm, the artillery mech (docs/MECH_ROSTER.md, section 3): a squat armoured hull in desert camouflage on four
// heavy hydraulic legs, a twin-barrel rail mortar on a traverse ring in the middle, a low sensor turret with a cluster
// of glowing lenses set into the glacis, and point-defence laser turrets on the front corners. At range it should read
// as "four legs and the two long barrels". Each part's paint and flags are in cataclysm.kit.json next to this file.
// Run: npx tsx scripts/mechs/cataclysm.ts  →  assets/models/mechs/cataclysm/Mech_Cataclysm.glb
// Metres, Y up, facing -Z, right side +X, feet at y = 0. Every part is built in place on the assembled mech.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeGlb, type MeshData, type NodeData } from "../assets/glbWrite";
import { box, cylinder, empty, merge, mirrorX, prism, triangles, turn, type V3 } from "../../packages/client/src/dressing/shapes";

const out = join(new URL("../..", import.meta.url).pathname, "assets/models/mechs/cataclysm/Mech_Cataclysm.glb");
const deg = Math.PI / 180;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Lays a mesh built along z, centred on the origin, onto the line from a to b. Its x stays horizontal, so a leg beam's
// width runs front to back and its height faces outward. The basis is a proper rotation, so faces stay outward.
function along(mesh: MeshData, a: V3, b: V3): MeshData {
  const d = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const side = unit(cross([0, 1, 0], d)), up = cross(d, side);
  const mid = lerp(a, b, 0.5);
  const map = (p: V3): V3 => add(add(scale(side, p[0]), scale(up, p[1])), scale(d, p[2]));
  const res = empty();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    res.positions.push(...add(mid, map([mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!])));
    res.normals.push(...map([mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!]));
  }
  res.indices = [...mesh.indices];
  return res;
}
const dist = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const beam = (a: V3, b: V3, w: number, h: number, bevel: number) => along(box([0, 0, 0], [w, h, dist(a, b)], bevel), a, b);
const rod = (a: V3, b: V3, r: number, sides = 6) => along(cylinder([0, 0, 0], r, dist(a, b), "z", sides), a, b);
// A hydraulic ram: a fat cylinder for the first part of its length, a thinner rod for the rest.
const ram = (a: V3, b: V3, r: number) => merge(rod(a, lerp(a, b, 0.55), r), rod(lerp(a, b, 0.5), b, r * 0.6));
// A flat plate lying on a slope that faces up and forward, tilted by `angle` (radians, negative tips its top forward).
const slopePlate = (centre: V3, size: V3, angle: number) => turn(box([0, 0, 0], size, 0.02), [angle, 0, 0], [0, 0, 0], centre);
// A flat deck plate turned about y, for patches that should not line up with the hull.
const deckPatch = (centre: V3, size: V3, yaw: number) => turn(box([0, 0, 0], size, 0.02), [0, yaw, 0], [0, 0, 0], centre);
const mirrorZ = (m: MeshData) => turn(mirrorX(m), [0, Math.PI, 0]); // mirror in x, then turn half round: a z mirror
const bothSides = (m: MeshData) => merge(m, mirrorX(m));

// ---- Hull (torso zone). The belly sits at 1.44 so that, when the legs break and the mech drops 1.3 m, it rests
// just off the ground. Side profile: a sloped glacis in front, a short slope at the back.
const deckY = 2.4;
const glacisAngle = -Math.atan2(0.25, 0.6); // the glacis drops 0.25 m over 0.6 m toward the front
const onGlacis = (x: number, z: number, lift: number): V3 => {
  const y = deckY - (-0.7 - z) * (0.25 / 0.6);
  return [x, y + lift * Math.cos(glacisAngle), z + lift * Math.sin(glacisAngle)];
};

// The camouflage is alternating plates in two paints: tan plates on the tan hull (Torso), rust brown ones beside them.
const torso = merge(
  prism([[1.5, -0.95], [1.5, 1.0], [1.85, 1.3], [2.3, 1.3], [deckY, 1.05], [deckY, -0.7], [2.15, -1.3], [1.8, -1.3]], "x", -1.15, 1.15),
  box([0.95, 2.44, 0.68], [0.38, 0.08, 0.62], 0.03), // deck plate, rear right
  box([-0.95, 2.44, 0.03], [0.38, 0.08, 0.66], 0.03), // deck plate, front left
  ...[-1, 1].map((s) => box([s * 1.19, 2.33, 0.18], [0.08, 0.14, 1.66], 0.03)), // side rails along the top edge
  box([0, 1.98, -1.34], [0.8, 0.3, 0.08], 0.03), // front face centre plate
  ...[-0.45, 0.45].map((x) => box([x, 2.05, 1.36], [0.36, 0.3, 0.14], 0.04)), // rear exhaust blocks
);

const hullCamo = merge(
  box([0.95, 2.44, 0.03], [0.38, 0.08, 0.66], 0.03), // deck plate, front right
  box([-0.95, 2.44, 0.68], [0.38, 0.08, 0.62], 0.03), // deck plate, rear left
  bothSides(box([1.19, 1.95, 0], [0.08, 0.56, 1.0], 0.03)), // side skirt between the legs
  bothSides(slopePlate(onGlacis(0.6, -1.0, 0.04), [0.36, 0.08, 0.5], glacisAngle)), // glacis plates beside the sensor
  bothSides(box([0.8, 1.98, -1.34], [0.6, 0.3, 0.08], 0.03)), // front face side plates
  box([0, 2.12, 1.34], [0.4, 0.36, 0.08], 0.03), // rear plate between the exhausts
);

// Heat scoring round the weapon mounts: in front of the traverse ring where the muzzle blast lands, round the
// point-defence bases, and on the glacis in front of the lasers.
const hullScorch = merge(
  deckPatch([0, 2.46, -0.47], [0.9, 0.08, 0.32], 0),
  bothSides(deckPatch([0.6, 2.46, -0.12], [0.36, 0.08, 0.5], -30 * deg)),
  bothSides(deckPatch([0.9, 2.46, -0.6], [0.46, 0.08, 0.44], 20 * deg)),
  bothSides(slopePlate(onGlacis(0.97, -1.0, 0.04), [0.3, 0.08, 0.44], glacisAngle)),
);

// The hull's own joints: the belly undercarriage, a hip mount at each corner and the lugs the leg rams push on. When
// a leg breaks its parts vanish, and what is left here is the broken look: a mount, a sheared stub of the hip shaft
// and a snapped plate, all hidden inside the leg's hip joint while the leg is on.
const hipY = 1.85, hipZ = -0.95;
const rightFrontHipMount = merge(
  box([1.17, hipY, hipZ], [0.12, 0.5, 0.5], 0.04),
  cylinder([1.28, hipY, hipZ], 0.13, 0.26, "x", 6), // the shaft stub, ending inside the hip joint
  turn(box([0, 0, 0], [0.08, 0.3, 0.18], 0.02), [0.5, 0, 0.3], [0, 0, 0], [1.36, hipY, hipZ]), // a snapped plate
  box([1.17, 1.6, -0.88], [0.12, 0.16, 0.22], 0.03), // lug for the knee ram
);
const frame = merge(
  box([0, 1.5, 0.05], [1.7, 0.12, 1.8], 0.04), // undercarriage, the belly the mech crawls on
  rightFrontHipMount, mirrorX(rightFrontHipMount), mirrorZ(rightFrontHipMount), mirrorX(mirrorZ(rightFrontHipMount)),
);

// ---- Sensor turret (torso zone): a low armoured box set into the glacis, under a sloped hood that overhangs the lenses.
const sensor = merge(
  box([0, 2.42, -0.9], [0.7, 0.3, 0.55], 0.05),
  prism([[2.5, -1.27], [2.5, -0.62], [2.7, -0.6], [2.72, -0.92]], "x", -0.4, 0.4), // the sloped hood
  bothSides(box([0.36, 2.42, -1.05], [0.08, 0.2, 0.3], 0.02)), // cheek plates either side of the lens slot
);
// A cluster of small lenses in the slot under the hood, facing forward.
const sensorLenses = merge(
  cylinder([0, 2.41, -1.2], 0.065, 0.08, "z", 6),
  ...[-1, 1].map((s) => cylinder([s * 0.14, 2.43, -1.2], 0.05, 0.08, "z", 6)),
  ...[-1, 1].map((s) => cylinder([s * 0.25, 2.39, -1.2], 0.045, 0.08, "z", 6)),
);

// ---- Rail mortar (arms zone). The traverse ring sits in the middle of the deck; the turret block on it carries
// cheek plates that hold the trunnion, and the twin barrels hinge there and rise toward -Z.
const ringZ = 0.35;
const turretRing = cylinder([0, 2.51, ringZ], 0.72, 0.22, "y", 12);
const turretBand = cylinder([0, 2.53, ringZ], 0.76, 0.1, "y", 12); // the pilot's marking, a band round the ring
const turret = prism([[2.62, -0.3], [2.62, 1.05], [2.85, 1.05], [2.95, 0.9], [2.95, 0.05], [2.8, -0.3]], "x", -0.62, 0.62);
const turretCamo = bothSides(prism([[2.85, 0.15], [2.85, 0.95], [3.12, 0.85], [3.18, 0.5], [3.1, 0.25]], "x", 0.5, 0.62));
const turretFrontAngle = -Math.atan2(0.15, 0.35);
const turretScorch = merge(
  slopePlate([0, 2.875 + 0.04 * Math.cos(turretFrontAngle), -0.125 + 0.04 * Math.sin(turretFrontAngle)], [0.9, 0.08, 0.3], turretFrontAngle),
  box([0, 2.71, -0.33], [1.0, 0.14, 0.08], 0.02),
);

// The barrels are built level along -Z from the trunnion, then raised. 28 degrees and 2.7 m keeps the muzzles
// inside the 4.5 m height and 1.9 m front limits.
const pivot: V3 = [0, 2.95, 0.6];
const elevation = 28 * deg;
const barrelLength = 2.7;
const raise = (m: MeshData) => turn(m, [elevation, 0, 0], pivot);
const at = (x: number, dy: number, dz: number): V3 => [x, pivot[1] + dy, pivot[2] + dz];
const barrelX = 0.28;
const oneBarrel = (x: number) => merge(
  box(at(x, 0, 0.15), [0.36, 0.36, 0.7], 0.05), // breech
  box(at(x, 0, -0.55), [0.3, 0.3, 0.7], 0.04), // jacket
  ...[-1.05, -1.6, -2.15].map((dz) => cylinder(at(x, 0, dz), 0.17, 0.16, "z", 8)), // recoil-dampening collars
  box(at(x, 0, -barrelLength + 0.08), [0.32, 0.32, 0.16], 0.03), // muzzle brake
);
const barrels = raise(merge(oneBarrel(-barrelX), oneBarrel(barrelX), box(at(0, 0, -1.6), [0.4, 0.14, 0.14], 0.03)));
const oneSleeve = (x: number) => merge(
  cylinder(at(x, 0, -(0.9 + barrelLength - 0.1) / 2), 0.11, barrelLength - 1.0, "z", 8), // inner tube
  cylinder(at(x, -0.19, -1.25), 0.055, 0.7, "z", 6), // recoil rod under the barrel
);
const barrelSleeves = merge(
  raise(merge(oneSleeve(-barrelX), oneSleeve(barrelX))),
  cylinder(pivot, 0.14, 1.36, "x", 8), // trunnion
);

// ---- Point-defence turrets on the front corners (arms zone), each with a small glowing emitter. The right one also
// carries the sponson for the side gun, the gun the server actually fires from (Mount_Gun).
const pdZ = -0.6, pdX = 0.9, pdY = 2.65;
const pdTurret = (x: number) => merge(
  cylinder([x, 2.47, pdZ], 0.17, 0.14, "y", 8), // pedestal
  box([x, pdY, pdZ], [0.34, 0.24, 0.36], 0.05),
  prism([[pdY - 0.1, -0.78], [pdY + 0.12, -0.78], [pdY + 0.1, -0.88], [pdY - 0.06, -0.92]], "x", x - 0.15, x + 0.15), // sloped front
  cylinder([x, pdY, -1.0], 0.05, 0.2, "z", 6), // emitter barrel
);
const mountGun: V3 = [1.2, 2.4, -1.65];
const armR = merge(pdTurret(pdX), box([1.2, 2.4, -0.95], [0.26, 0.3, 0.5], 0.05));
const armL = pdTurret(-pdX);
const pdEmitters = merge(...[-1, 1].map((s) => cylinder([s * pdX, pdY, -1.14], 0.065, 0.08, "z", 6)));
const sideGun = merge(
  box([1.2, 2.4, -1.28], [0.18, 0.18, 0.18], 0.03),
  cylinder([1.2, 2.4, -1.5], 0.07, 0.3, "z", 6), // muzzle ends at Mount_Gun
);

// ---- Legs (legs zone). Built for the right front leg, mirrored for the others. The thigh angles out and up from the
// hip to a high knee, the shin drops to a broad foot. Each leg has three parts: thigh and foot armour, shin armour
// and the hydraulics (joints, rams, the shin's core). The front feet add claws that dig in to take the recoil.
const hip: V3 = [1.32, hipY, hipZ], knee: V3 = [1.75, 2.35, -1.25], ankle: V3 = [1.32, 0.42, -1.3];
const shinDir = unit([ankle[0] - knee[0], ankle[1] - knee[1], 0]);
const shinOut: V3 = [-shinDir[1], shinDir[0], 0]; // outward, across the shin in the leg's plane
const thighArmour = merge(
  beam(hip, knee, 0.46, 0.42, 0.06),
  box([1.3, 0.12, -1.3], [0.6, 0.24, 0.6], 0.06), // foot pad
  box([1.32, 0.36, -1.3], [0.36, 0.26, 0.42], 0.05), // ankle cowl
);
const shinArmour = beam(lerp(knee, ankle, 0.1), lerp(knee, ankle, 0.6), 0.42, 0.4, 0.06);
const hydraulics = merge(
  cylinder([1.32, hipY, hipZ], 0.27, 0.26, "x", 8), // hip joint
  cylinder(knee, 0.26, 0.5, "z", 8), // knee
  beam(knee, ankle, 0.28, 0.28, 0.04), // shin core
  cylinder([ankle[0], 0.55, ankle[2]], 0.16, 0.4, "z", 8), // ankle
  ram([1.2, 1.6, -0.9], add(lerp(knee, ankle, 0.2), scale(shinOut, 0.05)), 0.09), // knee ram, from the hull lug
  ram(add(lerp(knee, ankle, 0.1), scale(shinOut, 0.28)), add(lerp(knee, ankle, 0.8), scale(shinOut, 0.28)), 0.08), // shin ram
);
const claws = merge(...[1.1, 1.3, 1.5].map((x) => prism([[0.22, -1.5], [0.04, -1.5], [0.0, -1.76]], "x", x - 0.05, x + 0.05)));

const legFR = { armour: thighArmour, shin: shinArmour, hydraulics: merge(hydraulics, claws) };
const legFL = { armour: mirrorX(thighArmour), shin: mirrorX(shinArmour), hydraulics: mirrorX(legFR.hydraulics) };
const legBR = { armour: mirrorZ(thighArmour), shin: mirrorZ(shinArmour), hydraulics: mirrorZ(hydraulics) };
const legBL = { armour: mirrorX(legBR.armour), shin: mirrorX(legBR.shin), hydraulics: mirrorX(legBR.hydraulics) };
const legNodes = (name: string, leg: typeof legFR): NodeData[] => [
  { name, mesh: leg.armour },
  { name: `${name}_Shin`, mesh: leg.shin },
  { name: `${name}_Hydraulics`, mesh: leg.hydraulics },
];

const nodes: NodeData[] = [
  { name: "Torso", mesh: torso },
  { name: "Hull_Camo", mesh: hullCamo },
  { name: "Hull_Scorch", mesh: hullScorch },
  { name: "Frame", mesh: frame },
  { name: "Sensor", mesh: sensor },
  { name: "Sensor_Lenses", mesh: sensorLenses },
  { name: "Turret_Ring", mesh: turretRing },
  { name: "Turret_Band", mesh: turretBand },
  { name: "Turret", mesh: turret },
  { name: "Turret_Camo", mesh: turretCamo },
  { name: "Turret_Scorch", mesh: turretScorch },
  { name: "Barrels", mesh: barrels },
  { name: "Barrel_Sleeves", mesh: barrelSleeves },
  { name: "Arm_L", mesh: armL },
  { name: "Arm_R", mesh: armR },
  { name: "PD_Emitters", mesh: pdEmitters },
  { name: "Side_Gun", mesh: sideGun },
  ...legNodes("Leg_FL", legFL),
  ...legNodes("Leg_FR", legFR),
  ...legNodes("Leg_BL", legBL),
  ...legNodes("Leg_BR", legBR),
  { name: "Mount_Gun", translation: mountGun },
  { name: "Torso_Fx", translation: [0, 2.5, 1.15] },
  { name: "Arm_R_Fx", translation: [0.4, 3.0, 0.3] },
  { name: "Leg_FL_Fx", translation: [-knee[0], knee[1], knee[2]] },
];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, writeGlb(nodes));
const total = nodes.reduce((s, n) => s + (n.mesh ? triangles(n.mesh) : 0), 0);
console.log(`Wrote ${out} (${total} triangles)`);
