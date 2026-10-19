import * as THREE from "three";
import { freeze } from "./freeze";
import type { PropConfig } from "@rustbucket/shared";
import propsJson from "../../../data/props.json";
import { toGeometry } from "./dressing/dressing";
import { seedOf, type DressPiece } from "./dressing/kinds";
import type { PlayMap } from "./loadMap";
import { standIn } from "./props/standIn";
import type { Toon, ToonInstances } from "./toonMaterial";

// Past `beyondMeters` from the camera a standing prop is drawn as its plain stand-in box (props/standIn.ts), and it
// turns back into its model only once nearer than `beyondMeters - hysteresisMeters`, so a prop at the boundary does
// not flicker between the two as the camera bobs. From data/props.json; a very large distance turns the boxes off.
export interface FarBoxes {
  beyondMeters: number;
  hysteresisMeters: number;
}

export function parseFarBoxes(raw: unknown): FarBoxes {
  const f = raw as FarBoxes | undefined;
  if (typeof f?.beyondMeters !== "number" || typeof f.hysteresisMeters !== "number" || f.hysteresisMeters < 0 || f.hysteresisMeters > f.beyondMeters) {
    throw new Error("props.json: farBoxes needs beyondMeters and hysteresisMeters between 0 and beyondMeters");
  }
  return f;
}

const farBoxes = parseFarBoxes((propsJson as { farBoxes?: unknown }).farBoxes);

// Whether a standing prop is drawn as its far box, given whether it was last frame and its squared distance from the
// camera. Squared distances keep a square root per prop out of the frame loop.
export function drawnFar(wasFar: boolean, distanceSq: number, nearSq: number, farSq: number): boolean {
  return wasFar ? distanceSq > nearSq : distanceSq > farSq;
}

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
const eye = new THREE.Vector3();

// The instanced meshes of one way of drawing (standing, broken or far) one prop type, sharing one instance buffer.
interface Packed {
  meshes: THREE.InstancedMesh[];
  buffer: THREE.InstancedBufferAttribute;
  shown: Int32Array; // which prop sits in each slot of the buffer, so an unchanged view uploads nothing
  changed: boolean;
}

// One prop type's model drawn many times: one instanced mesh (and outline) per paint, for the standing props and
// again for their debris, plus one box (and outline) standing in for the far ones. Each frame only the props inside
// the camera's view are packed into the instance buffers: on a large map that is about a quarter of the five thousand
// or so, and drawing all of them every frame was half the GPU's work (docs/PERF.md). The pieces of one model share
// one buffer, so a frame uploads it once.
class PropInstances {
  readonly meshes: THREE.InstancedMesh[] = [];
  private standing: Packed;
  private broken: Packed;
  private far: Packed;
  private matrices: Float32Array; // every prop's placement, 16 numbers each
  private isBroken: Uint8Array;
  private isFar: Uint8Array;
  private reach = 0; // how far any piece, standing or broken, goes from its prop's origin

  constructor(toon: Toon, intact: DressPiece[], destroyed: DressPiece[], private count: number) {
    this.matrices = new Float32Array(count * 16);
    this.isBroken = new Uint8Array(count);
    this.isFar = new Uint8Array(count);
    const make = (pieces: DressPiece[], name: string): Packed => {
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
          mesh.name = name;
          meshes.push(mesh);
          this.meshes.push(mesh);
        }
      }
      return { meshes, buffer, shown: new Int32Array(count).fill(-1), changed: false };
    };
    this.standing = make(intact, "standing prop");
    this.broken = make(destroyed, "broken prop");
    this.far = make([standIn(intact)], "far prop");
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

  // Packs the props inside `view` into the buffers: broken, standing near `from`, or standing far from it. The far
  // test runs for props out of view too, so one turning into view already has the right look.
  show(view: THREE.Frustum, from: THREE.Vector3, nearSq: number, farSq: number): void {
    let standing = 0, broken = 0, far = 0;
    for (let i = 0; i < this.count; i++) {
      const m = i * 16;
      const x = this.matrices[m + 12]!, y = this.matrices[m + 13]!, z = this.matrices[m + 14]!;
      const dx = x - from.x, dy = y - from.y, dz = z - from.z;
      const isFar = drawnFar(this.isFar[i] === 1, dx * dx + dy * dy + dz * dz, nearSq, farSq);
      this.isFar[i] = isFar ? 1 : 0;
      ball.center.set(x, y, z);
      ball.radius = this.reach;
      if (!view.intersectsSphere(ball)) continue;
      if (this.isBroken[i]) broken = this.put(this.broken, broken, i);
      else if (isFar) far = this.put(this.far, far, i);
      else standing = this.put(this.standing, standing, i);
    }
    this.upload(this.standing, standing);
    this.upload(this.broken, broken);
    this.upload(this.far, far);
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
// debris that stays where it stood. Far away a standing one is a plain box in its main colour (see FarBoxes); debris
// stays debris at any distance. A type without a model is a plain toon box that disappears.
// Art hook: a real model per type replaces its builder in props/.
export class PropView {
  readonly group = new THREE.Group();
  private slot: ({ kind: "model"; view: PropInstances; instance: number } | { kind: "box"; boxes: ToonInstances; instance: number })[] = [];
  private models: PropInstances[] = [];
  private boxes: ToonInstances[] = [];

  private nearSq: number;
  private farSq: number;

  constructor(map: PlayMap, config: PropConfig, toon: Toon, builders: Record<string, PropModelBuilder> = {}, far: FarBoxes = farBoxes) {
    this.farSq = far.beyondMeters ** 2;
    this.nearSq = (far.beyondMeters - far.hysteresisMeters) ** 2;
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
    // Instances move, the meshes never do: no matrix work per frame for the whole group (freeze.ts).
    freeze(this.group);
  }

  // Call each frame before drawing, once the camera has moved.
  cull(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    seen.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    eye.setFromMatrixPosition(camera.matrixWorld);
    for (const m of this.models) m.show(seen, eye, this.nearSq, this.farSq);
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
