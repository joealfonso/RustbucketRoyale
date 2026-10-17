import * as THREE from "three";
import type { PlayMap } from "./loadMap";

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const noTurn = new THREE.Quaternion();

// Draws the whole map with one instanced mesh per colour, so thousands of boxes cost a handful of draw calls.
// Art hook: swap a colour's material, or replace this with real chunk models at V3.
export function addMapMeshes(scene: THREE.Scene, map: PlayMap): void {
  const byColor = new Map<number, number[]>();
  map.colors.forEach((color, box) => {
    const list = byColor.get(color);
    if (list) list.push(box);
    else byColor.set(color, [box]);
  });

  for (const [color, indices] of byColor) {
    const mesh = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardMaterial({ color: map.palette[color]!, roughness: 1 }), indices.length);
    indices.forEach((boxIndex, instance) => {
      const b = map.boxes[boxIndex]!;
      position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      scale.set(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      mesh.setMatrixAt(instance, matrix.compose(position, noTurn, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
}
