import * as THREE from "three";
import type { PlayMap } from "./loadMap";
import type { Toon } from "./toonMaterial";

// Draws the whole map in the toon look with one instanced mesh per colour plus one for its outlines, so thousands of
// boxes cost a handful of draw calls. The floor (colour 0) gets the bands with no rim or outline.
// Art hook: swap a colour's material, or replace this with real chunk models at V3.
export function addMapMeshes(scene: THREE.Scene, map: PlayMap, toon: Toon): THREE.Group {
  const group = new THREE.Group();
  const byColor = new Map<number, number[]>();
  map.colors.forEach((color, box) => {
    if (map.propOfBox[box]! >= 0) return; // props are drawn by PropView, so they can disappear
    const list = byColor.get(color);
    if (list) list.push(box);
    else byColor.set(color, [box]);
  });

  for (const [color, indices] of byColor) {
    const boxes = toon.instances(map.palette[color]!, indices.length, color === 0);
    indices.forEach((boxIndex, instance) => {
      const b = map.boxes[boxIndex]!;
      boxes.set(instance, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
    });
    boxes.commit();
    boxes.addTo(group);
  }
  scene.add(group);
  return group;
}

// Takes a map out of the scene and frees its meshes, so building a new one each match does not leak. The materials
// are the toon look's shared ones and stay.
export function removeMapMeshes(scene: THREE.Scene, group: THREE.Group): void {
  scene.remove(group);
  for (const child of group.children) (child as THREE.InstancedMesh).dispose();
}
