import * as THREE from "three";
import type { UpgradeDef } from "@rustbucket/shared";

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map<string, THREE.MeshStandardMaterial>();

export function material(color: string): THREE.MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    materials.set(color, m);
  }
  return m;
}

export function addBox(parent: THREE.Object3D, center: readonly number[], size: readonly number[], color: string): void {
  const mesh = new THREE.Mesh(unitBox, material(color));
  mesh.position.set(center[0]!, center[1]!, center[2]!);
  mesh.scale.set(size[0]!, size[1]!, size[2]!);
  parent.add(mesh);
}

export interface MechModel {
  group: THREE.Group;
  body: THREE.Group; // everything above the feet, lowered and tipped forward when the mech crawls
  legMeshes: THREE.Mesh[];
  // One material per hit zone (legs, arms, torso), owned by this mech so damage tints only it.
  zoneMaterials: THREE.MeshStandardMaterial[];
  armMeshes: THREE.Mesh[];
  baseColors: THREE.Color[];
  zoneMaxHp: number[];
  plates: THREE.Mesh[][]; // armor plate meshes per zone, shown while that zone has plate points
  gunMaterial: THREE.MeshStandardMaterial;
  // The last damage shown, kept so the spark and smoke effects can read it each frame.
  hp: number[];
  dead: boolean;
  repairing: boolean; // shown with welding sparks
  upgradeParts: THREE.Mesh[]; // one per upgrade, made the first time it is fitted, shown while fitted
  fxTimers: number[]; // per zone: seconds until the next spark, then the next puff of smoke. Last: welding sparks
}

// How a crawling mech sits. Read from data/damageFx.json once at startup.
export interface CrawlLook {
  dropMeters: number;
  tiltDegrees: number;
  legStubScale: number;
}
let crawlLook: CrawlLook = { dropMeters: 1.3, tiltDegrees: 12, legStubScale: 0.3 };
export function setCrawlLook(look: CrawlLook): void {
  crawlLook = look;
}

const WRECK = new THREE.Color("#262626");
const scratch = new THREE.Color();

// Grey-box mech. Art hook: replace this with a loaded model, keep the zone mapping so damage still shows.
export function createMechModel(accent: string, zoneMaxHp: readonly number[]): MechModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const grey = "#738087";
  const baseColors = [new THREE.Color(grey), new THREE.Color(accent), new THREE.Color(grey)];
  const zoneMaterials = baseColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  const armMeshes: THREE.Mesh[] = [];

  const part = (zone: number, center: number[], size: number[]): THREE.Mesh => {
    const mesh = new THREE.Mesh(unitBox, zoneMaterials[zone]!);
    mesh.position.set(center[0]!, center[1]!, center[2]!);
    mesh.scale.set(size[0]!, size[1]!, size[2]!);
    body.add(mesh);
    return mesh;
  };
  part(2, [0, 2.4, 0], [1.8, 1.6, 1.2]);
  // Legs hang from the hips (pivot at the top) so a broken one can shrink to a stub under the body.
  const legMeshes: THREE.Mesh[] = [];
  for (const x of [-0.6, 0.6]) {
    const leg = part(0, [x, 0.8, 0], [0.6, 1.6, 0.7]);
    legMeshes.push(leg);
  }
  armMeshes.push(part(1, [-1.2, 2.4, 0], [0.5, 1.2, 0.5]));
  armMeshes.push(part(1, [1.2, 2.4, -0.6], [0.5, 0.6, 1.6]));

  // The barrel on the gun arm takes the colour of the weapon in hand. Art hook: one model per weapon at V2.
  const gunMaterial = new THREE.MeshStandardMaterial({ color: "#d9731a", roughness: 0.6 });
  const barrel = new THREE.Mesh(unitBox, gunMaterial);
  barrel.position.set(1.2, 2.4, -1.65);
  barrel.scale.set(0.3, 0.3, 0.6);
  body.add(barrel);

  // Armor plates bolted on over each zone. Art hook: real plate models with bolts and scratches at V2.
  const plateMaterial = new THREE.MeshStandardMaterial({ color: "#a9b8c4", roughness: 0.5, metalness: 0.3 });
  const plate = (center: number[], size: number[]): THREE.Mesh => {
    const mesh = new THREE.Mesh(unitBox, plateMaterial);
    mesh.position.set(center[0]!, center[1]!, center[2]!);
    mesh.scale.set(size[0]!, size[1]!, size[2]!);
    mesh.visible = false;
    body.add(mesh);
    return mesh;
  };
  const plates = [
    [plate([-0.6, 0.9, -0.4], [0.65, 1.0, 0.12]), plate([0.6, 0.9, -0.4], [0.65, 1.0, 0.12])],
    [plate([-1.48, 2.4, 0], [0.1, 0.9, 0.45]), plate([1.48, 2.4, -0.4], [0.1, 0.5, 0.9])],
    [plate([0, 2.5, -0.66], [1.5, 1.1, 0.12]), plate([0, 2.5, 0.66], [1.5, 1.1, 0.12])],
  ];
  return {
    group, body, legMeshes, zoneMaterials, armMeshes, baseColors, zoneMaxHp: [...zoneMaxHp], plates, gunMaterial,
    hp: [...zoneMaxHp], dead: false, repairing: false, upgradeParts: [], fxTimers: [0, 0, 0, 0, 0, 0, 0],
  };
}

// Damage you can read on the mech: parts darken as they take hits, a broken arm falls off, broken legs leave the
// body down on the ground on two stubs, and a destroyed mech slumps. Sparks and smoke come from damageFx.ts.
// Art hook: real bent and missing parts at V2.
export function setMechDamage(model: MechModel, hp: readonly number[], dead: boolean): void {
  for (let zone = 0; zone < model.hp.length; zone++) model.hp[zone] = hp[zone]!;
  model.dead = dead;
  for (let zone = 0; zone < model.zoneMaterials.length; zone++) {
    const fraction = Math.max(0, Math.min(1, hp[zone]! / model.zoneMaxHp[zone]!));
    scratch.copy(WRECK).lerp(model.baseColors[zone]!, fraction);
    model.zoneMaterials[zone]!.color.copy(scratch);
  }
  const armsBroken = hp[1]! <= 0;
  for (const arm of model.armMeshes) arm.visible = !armsBroken;
  // Crawling: the body drops onto stubs and tips forward, so a legless mech reads at a distance.
  const crawling = hp[0]! <= 0 && !dead;
  model.body.position.y = crawling ? -crawlLook.dropMeters : 0;
  model.body.rotation.x = crawling ? -(crawlLook.tiltDegrees * Math.PI) / 180 : 0;
  for (const leg of model.legMeshes) {
    // A stub hangs from the bottom of the torso (1.6 m up in the body's frame).
    const length = crawling ? 1.6 * crawlLook.legStubScale : 1.6;
    leg.scale.y = length;
    leg.position.y = 1.6 - length / 2;
  }
  model.group.scale.y = dead ? 0.35 : 1;
}

// Shows the weapon in hand and the armor still on. A plate disappears the moment its points run out.
export function setMechGear(model: MechModel, gunColor: string, armor: readonly number[]): void {
  model.gunMaterial.color.set(gunColor);
  model.plates.forEach((meshes, zone) => {
    const on = (armor[zone] ?? 0) > 0;
    for (const m of meshes) m.visible = on;
  });
}

// Where each upgrade bolts on, in the body frame: centre and size. Grey-box parts. Art hook: `model` in
// data/upgrades.json for a real part.
const UPGRADE_MOUNTS: Record<string, { center: number[]; size: number[] }> = {
  bigTanks: { center: [0, 2.6, 0.9], size: [1.3, 1.0, 0.6] }, // fat tanks on the back
  quickHands: { center: [-1.15, 1.5, 0.1], size: [0.5, 0.45, 0.8] }, // toolbox on the hip
  bigEars: { center: [0.45, 3.75, 0.2], size: [0.12, 1.1, 0.12] }, // antenna on the shoulder
  overclock: { center: [1.2, 2.95, -0.6], size: [0.6, 0.35, 0.9] }, // coil on top of the gun arm
};
const OTHER_MOUNT = { center: [0, 3.4, 0.4], size: [0.6, 0.4, 0.6] };

// Shows the parts for the upgrades fitted, so anyone can see what a mech is carrying.
export function setMechUpgrades(model: MechModel, upgrades: readonly number[], defs: readonly UpgradeDef[]): void {
  for (let u = 0; u < defs.length; u++) {
    const fitted = upgrades.includes(u);
    let part = model.upgradeParts[u];
    if (!part && fitted) {
      const def = defs[u]!;
      const mount = UPGRADE_MOUNTS[def.id] ?? OTHER_MOUNT;
      part = new THREE.Mesh(unitBox, material(def.color));
      part.position.set(mount.center[0]!, mount.center[1]!, mount.center[2]!);
      part.scale.set(mount.size[0]!, mount.size[1]!, mount.size[2]!);
      model.body.add(part);
      model.upgradeParts[u] = part;
    }
    if (part) part.visible = fitted;
  }
}
