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
const seen = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const ball = new THREE.Sphere();

// The instanced meshes of one state (standing or broken) of one prop type, sharing one instance buffer.
interface Packed {
  meshes: THREE.InstancedMesh[];
  buffer: THREE.InstancedBufferAttribute;
  shown: Int32Array; // which prop sits in each slot of the buffer, so an unchanged view uploads nothing
  changed: boolean;
}

// One prop type's model drawn many times: one instanced mesh (and outline) per paint, for the standing props and
// again for their debris. Each frame only the props inside the camera's view are packed into the instance buffers:
// on a large map that is about a quarter of the five thousand or so, and drawing all of them every frame was half the
// GPU's work (docs/PERF.md). The pieces of one model share one buffer, so a frame uploads it once.
class PropInstances {
  readonly meshes: THREE.InstancedMesh[] = [];
  private standing: Packed;
  private broken: Packed;
  private matrices: Float32Array; // every prop's placement, 16 numbers each
  private isBroken: Uint8Array;
  private reach = 0; // how far any piece, standing or broken, goes from its prop's origin

  constructor(toon: Toon, intact: DressPiece[], destroyed: DressPiece[], private count: number) {
    this.matrices = new Float32Array(count * 16);
    this.isBroken = new Uint8Array(count);
    const make = (pieces: DressPiece[]): Packed => {
      const buffer = new THREE.InstancedBufferAttribute(new Float32Array(count * 16), 16);
      const meshes: THREE.InstancedMesh[] = [];
      for (const p of pieces) {
        const geometry = toGeometry([p.mesh]);
        const sphere = geometry.boundingSphere!;
        this.reach = Math.max(this.reach, sphere.center.length() + sphere.radius);
        for (const material of [toon.instanced(toon.world(p.paint)), toon.instanced(toon.shellOutline(p.paint))]) {
          const mesh = new THREE.InstancedMesh(geometry, material, count);
          mesh.instanceMatrix = buffer;
          mesh.frustumCulled = false; // culled per prop below; three's one sphere round all of them never culls
          mesh.count = 0;
          meshes.push(mesh);
          this.meshes.push(mesh);
        }
      }
      return { meshes, buffer, shown: new Int32Array(count).fill(-1), changed: false };
    };
    this.standing = make(intact);
    this.broken = make(destroyed);
    // Room for the outlines, pushed out along their normals by the outline width (a few centimetres).
    this.reach += 0.5;
  }

  place(i: number, matrix: THREE.Matrix4): void {
    matrix.toArray(this.matrices, i * 16);
  }

  // Swaps one prop for its debris, in the same spot, from the next `show` on.
  breakAt(i: number): void {
    this.isBroken[i] = 1;
  }

  // Packs the props inside `view` into the buffers, standing or broken.
  show(view: THREE.Frustum): void {
    let standing = 0, broken = 0;
    for (let i = 0; i < this.count; i++) {
      const m = i * 16;
      ball.center.set(this.matrices[m + 12]!, this.matrices[m + 13]!, this.matrices[m + 14]!);
      ball.radius = this.reach;
      if (!view.intersectsSphere(ball)) continue;
      if (this.isBroken[i]) broken = this.put(this.broken, broken, i);
      else standing = this.put(this.standing, standing, i);
    }
    this.upload(this.standing, standing);
    this.upload(this.broken, broken);
  }

  // Puts prop `i` in `slot`, copying its matrix only if another prop sat there last time.
  private put(packed: Packed, slot: number, i: number): number {
    if (packed.shown[slot] !== i) {
      packed.shown[slot] = i;
      const to = packed.buffer.array as Float32Array;
      for (let k = 0; k < 16; k++) to[slot * 16 + k] = this.matrices[i * 16 + k]!;
      packed.changed = true;
    }
    return slot + 1;
  }

  // Sends only the slots in use, and only when one of them changed.
  private upload(packed: Packed, used: number): void {
    for (const mesh of packed.meshes) mesh.count = used;
    if (!packed.changed) return;
    packed.changed = false;
    packed.buffer.clearUpdateRanges();
    packed.buffer.addUpdateRange(0, used * 16);
    packed.buffer.needsUpdate = true;
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

  // Call each frame before drawing, once the camera has moved.
  cull(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    seen.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const m of this.models) m.show(seen);
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
