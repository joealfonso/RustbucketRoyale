import * as THREE from "three";
import type { PropConfig } from "@rustbucket/shared";
import type { PlayMap } from "./loadMap";

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const noTurn = new THREE.Quaternion();
const gone = new THREE.Matrix4().makeScale(0, 0, 0);

// The breakable props: one instanced mesh per prop type, so a destroyed one is hidden by shrinking its instance to
// nothing. Art hook: swap a type's geometry and material for its real model at V3.
export class PropView {
  readonly group = new THREE.Group();
  private slot: { mesh: THREE.InstancedMesh; instance: number }[] = [];

  constructor(map: PlayMap, config: PropConfig) {
    const byType = config.types.map(() => [] as number[]);
    for (const p of map.props) byType[p.type]!.push(p.id);
    byType.forEach((ids, type) => {
      if (ids.length === 0) return;
      const t = config.types[type]!;
      const mesh = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.9 }), ids.length);
      ids.forEach((id, instance) => {
        const p = map.props[id]!;
        position.set(p.x, p.y, p.z);
        scale.set(...t.size);
        mesh.setMatrixAt(instance, matrix.compose(position, noTurn, scale));
        this.slot[id] = { mesh, instance };
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    });
  }

  destroy(id: number): void {
    const s = this.slot[id];
    if (!s) return;
    s.mesh.setMatrixAt(s.instance, gone);
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const child of this.group.children) {
      const mesh = child as THREE.InstancedMesh;
      mesh.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
