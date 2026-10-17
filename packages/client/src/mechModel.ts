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

// Grey-box mech. Art hook: replace this with a loaded model, keep the position and yaw logic that drives it.
export function createMechModel(accent: string): THREE.Group {
  const group = new THREE.Group();
  addBox(group, [0, 2.4, 0], [1.8, 1.6, 1.2], "#738087");
  addBox(group, [-0.6, 0.8, 0], [0.6, 1.6, 0.7], "#738087");
  addBox(group, [0.6, 0.8, 0], [0.6, 1.6, 0.7], "#738087");
  addBox(group, [-1.2, 2.4, 0], [0.5, 1.2, 0.5], accent);
  addBox(group, [1.2, 2.4, -0.6], [0.5, 0.6, 1.6], accent);
  return group;
}
