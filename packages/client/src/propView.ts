import * as THREE from "three";
import type { PropConfig } from "@rustbucket/shared";
import type { PlayMap } from "./loadMap";
import type { Toon, ToonInstances } from "./toonMaterial";

// The breakable props in the toon look: one instanced mesh per prop type (plus its outlines), so a destroyed one is
// hidden by shrinking its instance to nothing. Art hook: swap a type's geometry and material for its real model at V3.
export class PropView {
  readonly group = new THREE.Group();
  private slot: { boxes: ToonInstances; instance: number }[] = [];
  private all: ToonInstances[] = [];

  constructor(map: PlayMap, config: PropConfig, toon: Toon) {
    const byType = config.types.map(() => [] as number[]);
    for (const p of map.props) byType[p.type]!.push(p.id);
    byType.forEach((ids, type) => {
      if (ids.length === 0) return;
      const t = config.types[type]!;
      const boxes = toon.instances(t.color, ids.length);
      ids.forEach((id, instance) => {
        const p = map.props[id]!;
        boxes.set(instance, p.x, p.y, p.z, ...t.size);
        this.slot[id] = { boxes, instance };
      });
      boxes.commit();
      boxes.addTo(this.group);
      this.all.push(boxes);
    });
  }

  destroy(id: number): void {
    const s = this.slot[id];
    if (s) s.boxes.hide(s.instance);
  }

  // Frees the meshes. The materials are the toon look's shared ones and stay.
  dispose(): void {
    for (const boxes of this.all) boxes.dispose();
  }
}
