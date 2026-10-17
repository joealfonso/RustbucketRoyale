import * as THREE from "three";

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
  // One material per hit zone (legs, arms, torso), owned by this mech so damage tints only it.
  zoneMaterials: THREE.MeshStandardMaterial[];
  armMeshes: THREE.Mesh[];
  baseColors: THREE.Color[];
  zoneMaxHp: number[];
  plates: THREE.Mesh[][]; // armor plate meshes per zone, shown while that zone has plate points
  gunMaterial: THREE.MeshStandardMaterial;
}

const WRECK = new THREE.Color("#262626");
const scratch = new THREE.Color();

// Grey-box mech. Art hook: replace this with a loaded model, keep the zone mapping so damage still shows.
export function createMechModel(accent: string, zoneMaxHp: readonly number[]): MechModel {
  const group = new THREE.Group();
  const body = "#738087";
  const baseColors = [new THREE.Color(body), new THREE.Color(accent), new THREE.Color(body)];
  const zoneMaterials = baseColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  const armMeshes: THREE.Mesh[] = [];

  const part = (zone: number, center: number[], size: number[]): THREE.Mesh => {
    const mesh = new THREE.Mesh(unitBox, zoneMaterials[zone]!);
    mesh.position.set(center[0]!, center[1]!, center[2]!);
    mesh.scale.set(size[0]!, size[1]!, size[2]!);
    group.add(mesh);
    return mesh;
  };
  part(2, [0, 2.4, 0], [1.8, 1.6, 1.2]);
  part(0, [-0.6, 0.8, 0], [0.6, 1.6, 0.7]);
  part(0, [0.6, 0.8, 0], [0.6, 1.6, 0.7]);
  armMeshes.push(part(1, [-1.2, 2.4, 0], [0.5, 1.2, 0.5]));
  armMeshes.push(part(1, [1.2, 2.4, -0.6], [0.5, 0.6, 1.6]));

  // The barrel on the gun arm takes the colour of the weapon in hand. Art hook: one model per weapon at V2.
  const gunMaterial = new THREE.MeshStandardMaterial({ color: "#d9731a", roughness: 0.6 });
  const barrel = new THREE.Mesh(unitBox, gunMaterial);
  barrel.position.set(1.2, 2.4, -1.65);
  barrel.scale.set(0.3, 0.3, 0.6);
  group.add(barrel);

  // Armor plates bolted on over each zone. Art hook: real plate models with bolts and scratches at V2.
  const plateMaterial = new THREE.MeshStandardMaterial({ color: "#a9b8c4", roughness: 0.5, metalness: 0.3 });
  const plate = (center: number[], size: number[]): THREE.Mesh => {
    const mesh = new THREE.Mesh(unitBox, plateMaterial);
    mesh.position.set(center[0]!, center[1]!, center[2]!);
    mesh.scale.set(size[0]!, size[1]!, size[2]!);
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };
  const plates = [
    [plate([-0.6, 0.9, -0.4], [0.65, 1.0, 0.12]), plate([0.6, 0.9, -0.4], [0.65, 1.0, 0.12])],
    [plate([-1.48, 2.4, 0], [0.1, 0.9, 0.45]), plate([1.48, 2.4, -0.4], [0.1, 0.5, 0.9])],
    [plate([0, 2.5, -0.66], [1.5, 1.1, 0.12]), plate([0, 2.5, 0.66], [1.5, 1.1, 0.12])],
  ];
  return { group, zoneMaterials, armMeshes, baseColors, zoneMaxHp: [...zoneMaxHp], plates, gunMaterial };
}

// Damage you can read on the mech: parts darken as they take hits, a broken arm falls off,
// and a destroyed mech slumps. Real damage art replaces this in V2 and M7.
export function setMechDamage(model: MechModel, hp: readonly number[], dead: boolean): void {
  for (let zone = 0; zone < model.zoneMaterials.length; zone++) {
    const fraction = Math.max(0, Math.min(1, hp[zone]! / model.zoneMaxHp[zone]!));
    scratch.copy(WRECK).lerp(model.baseColors[zone]!, fraction);
    model.zoneMaterials[zone]!.color.copy(scratch);
  }
  const armsBroken = hp[1]! <= 0;
  for (const arm of model.armMeshes) arm.visible = !armsBroken;
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

