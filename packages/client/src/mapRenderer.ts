import * as THREE from "three";
import { freeze } from "./freeze";
import type { PlayMap } from "./loadMap";
import type { Toon, ToonInstances } from "./toonMaterial";

// The map's boxes, drawn in the toon look with one instanced mesh per colour plus one for its outlines, so thousands
// of boxes cost a handful of draw calls. On the range the floor (colour 0) gets the bands with no rim or outline; on
// a map with hills the floor box lies out of sight under the lowest valley and the hills are drawn instead
// (terrainMesh.ts). A box can be hidden while the junkyard dressing stands in for it nearby (see dressing/dressing.ts).
export class MapMeshes {
  readonly group = new THREE.Group();
  private slot: { boxes: ToonInstances; instance: number }[] = [];
  private all: ToonInstances[] = [];

  constructor(private scene: THREE.Scene, private map: PlayMap, toon: Toon) {
    const byColor = new Map<number, number[]>();
    map.colors.forEach((color, box) => {
      if (map.propOfBox[box]! >= 0) return; // props are drawn by PropView, so they can disappear
      if (color === 0 && map.terrain) return;
      const list = byColor.get(color);
      if (list) list.push(box);
      else byColor.set(color, [box]);
    });
    for (const [color, indices] of byColor) {
      const boxes = toon.instances(map.palette[color]!, indices.length, color === 0);
      indices.forEach((boxIndex, instance) => {
        this.place(boxes, instance, boxIndex);
        this.slot[boxIndex] = { boxes, instance };
      });
      boxes.commit();
      boxes.addTo(this.group);
      this.all.push(boxes);
    }
    // Hiding a box changes its instance, never the mesh, so the meshes themselves never move.
    freeze(this.group);
    scene.add(this.group);
  }

  private place(boxes: ToonInstances, instance: number, boxIndex: number): void {
    const b = this.map.boxes[boxIndex]!;
    boxes.set(instance, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
  }

  // Shows or hides one box. Changes are sent to the graphics card on the next `commit`.
  setVisible(boxIndex: number, visible: boolean): void {
    const s = this.slot[boxIndex];
    if (!s) return;
    if (visible) this.place(s.boxes, s.instance, boxIndex);
    else s.boxes.hideOnly(s.instance);
  }

  commit(): void {
    for (const boxes of this.all) boxes.commit();
  }

  // Takes the map out of the scene and frees its meshes. The materials are the toon look's shared ones and stay.
  dispose(): void {
    this.scene.remove(this.group);
    for (const boxes of this.all) boxes.dispose();
  }
}
