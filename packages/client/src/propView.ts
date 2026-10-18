import * as THREE from "three";
import type { PropConfig } from "@rustbucket/shared";
import { toGeometry } from "./dressing/dressing";
import { seedOf, type DressPiece } from "./dressing/kinds";
import type { PlayMap } from "./loadMap";
import type { Toon, ToonInstances } from "./toonMaterial";

// A prop type's model, built once: what stands there, and the debris left when it breaks (see props/).
export type PropModelBuilder = (size: [number, number, number], seed: number) => { intact: DressPiece[]; destroyed: DressPiece[] };

const placed = new THREE.Matrix4();
const at = new THREE.Vector3();
const turned = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const one = new THREE.Vector3(1, 1, 1);
const gone = new THREE.Matrix4().makeScale(0, 0, 0);
const keep = new THREE.Matrix4();

// One prop type's model drawn many times: one instanced mesh (and outline) per paint, for the standing props and
// again for their debris, which stays hidden until that prop breaks.
class PropInstances {
  readonly meshes: THREE.InstancedMesh[] = [];
  private standing: THREE.InstancedMesh[] = [];
  private broken: THREE.InstancedMesh[] = [];

  constructor(toon: Toon, intact: DressPiece[], destroyed: DressPiece[], count: number) {
    const make = (pieces: DressPiece[], into: THREE.InstancedMesh[]) => {
      for (const p of pieces) {
        const geometry = toGeometry([p.mesh]);
        const mesh = new THREE.InstancedMesh(geometry, toon.world(p.paint), count);
        const hull = new THREE.InstancedMesh(geometry, toon.shellOutline(p.paint), count);
        into.push(mesh, hull);
        this.meshes.push(mesh, hull);
      }
    };
    make(intact, this.standing);
    make(destroyed, this.broken);
  }

  place(i: number, matrix: THREE.Matrix4): void {
    for (const m of this.standing) m.setMatrixAt(i, matrix);
    for (const m of this.broken) m.setMatrixAt(i, gone);
  }

  // Swaps one prop for its debris, in the same spot.
  breakAt(i: number): void {
    this.standing[0]?.getMatrixAt(i, keep);
    for (const m of this.standing) m.setMatrixAt(i, gone);
    for (const m of this.broken) m.setMatrixAt(i, keep);
    this.commit();
  }

  commit(): void {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    const geometries = new Set(this.meshes.map((m) => m.geometry));
    for (const m of this.meshes) m.dispose();
    for (const g of geometries) g.dispose();
  }
}

// The breakable props. A type with a model in props/ is drawn as that model, turned a quarter or half turn by its id
// so a field of crates is not all alike (never more, so it always stays inside its collision box), and breaks into
// debris that stays where it stood. A type without a model is a plain toon box that disappears.
// Art hook: a real model per type replaces its builder in props/.
export class PropView {
  readonly group = new THREE.Group();
  private slot: ({ kind: "model"; view: PropInstances; instance: number } | { kind: "box"; boxes: ToonInstances; instance: number })[] = [];
  private models: PropInstances[] = [];
  private boxes: ToonInstances[] = [];

  constructor(map: PlayMap, config: PropConfig, toon: Toon, builders: Record<string, PropModelBuilder> = {}) {
    const byType = config.types.map(() => [] as number[]);
    for (const p of map.props) byType[p.type]!.push(p.id);
    byType.forEach((ids, type) => {
      if (ids.length === 0) return;
      const t = config.types[type]!;
      const builder = builders[t.id];
      if (builder) {
        const model = builder(t.size, type);
        const view = new PropInstances(toon, model.intact, model.destroyed, ids.length);
        const square = t.size[0] === t.size[2];
        ids.forEach((id, instance) => {
          const p = map.props[id]!;
          const turns = seedOf(map.seed, id) % (square ? 4 : 2);
          turned.setFromAxisAngle(up, turns * (square ? Math.PI / 2 : Math.PI));
          view.place(instance, placed.compose(at.set(p.x, p.y - t.size[1] / 2, p.z), turned, one));
          this.slot[id] = { kind: "model", view, instance };
        });
        view.commit();
        for (const m of view.meshes) this.group.add(m);
        this.models.push(view);
        return;
      }
      const boxes = toon.instances(t.color, ids.length);
      ids.forEach((id, instance) => {
        const p = map.props[id]!;
        boxes.set(instance, p.x, p.y, p.z, ...t.size);
        this.slot[id] = { kind: "box", boxes, instance };
      });
      boxes.commit();
      boxes.addTo(this.group);
      this.boxes.push(boxes);
    });
  }

  destroy(id: number): void {
    const s = this.slot[id];
    if (!s) return;
    if (s.kind === "model") s.view.breakAt(s.instance);
    else s.boxes.hide(s.instance);
  }

  // Frees the meshes. The materials are the toon look's shared ones and stay.
  dispose(): void {
    for (const m of this.models) m.dispose();
    for (const b of this.boxes) b.dispose();
  }
}
