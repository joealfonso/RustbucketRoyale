import * as THREE from "three";
import groundJson from "../../../../data/ground.json";
import { freeze } from "../freeze";
import type { PlayMap } from "../loadMap";
import type { Toon, ToonInstances } from "../toonMaterial";
import { rng } from "./kinds";
import { boulder as stone } from "./rock";
import { turn, type MeshData } from "./shapes";

// Boulders beyond the dressing radius. Past it every other kind falls back to its plain map box, but a field of grey
// cubes on the hills reads as boxes, not rocks, so boulders get a far version instead: one small faceted stone
// (about 60 triangles), stretched to each boulder's box and given a turn by its box index so the field is not all alike.
// All of them are one instanced mesh plus one for the outline, two draw calls for every far boulder on the map,
// the same as their plain boxes cost. The plain boxes stay hidden for good; the near dressing (boulder.ts) and
// these take turns per chunk.

const { color: ROCK } = groundJson.hills.rock;

// Which stone the far ones all share. Any seed works; this one has a clear lean and no flat side facing up.
const STONE_SEED = 7;

// The far stone: fills a 1 m cube centred on the origin, so an instance's scale is its box's size.
export function farStone(): MeshData {
  return turn(stone(rng(STONE_SEED), -0.5, 0.5, -0.5, 0.5, 1), [0, 0, 0], [0, 0, 0], [0, -0.5, 0]);
}

function toGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
  geometry.setIndex(mesh.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const turned = new THREE.Matrix4();
const placed = new THREE.Matrix4();

export class FarBoulders {
  readonly group = new THREE.Group();
  readonly rocks: ToonInstances;
  private geometry: THREE.BufferGeometry;
  private instanceOf: Int32Array; // box index → instance, or -1 for a box that is not a boulder
  private shownNow: Uint8Array; // per instance

  constructor(toon: Toon, private map: PlayMap, private boxIndices: readonly number[]) {
    this.instanceOf = new Int32Array(map.boxes.length).fill(-1);
    boxIndices.forEach((box, instance) => { this.instanceOf[box] = instance; });
    this.shownNow = new Uint8Array(boxIndices.length);
    // The toon's own instanced boxes, with the stone swapped in for the cube: the same material, outline colour and
    // outline width as the plain boxes they stand in for.
    this.rocks = toon.instances(ROCK, boxIndices.length);
    this.geometry = toGeometry(farStone());
    this.rocks.mesh.geometry = this.geometry;
    if (this.rocks.hull) this.rocks.hull.geometry = this.geometry;
    for (let i = 0; i < boxIndices.length; i++) this.place(i);
    this.shownNow.fill(1);
    this.commit();
    this.rocks.addTo(this.group);
    freeze(this.group);
  }

  private place(instance: number): void {
    const boxIndex = this.boxIndices[instance]!;
    const b = this.map.boxes[boxIndex]!;
    const sx = b.maxX - b.minX, sz = b.maxZ - b.minZ;
    this.rocks.set(instance, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2, sx, b.maxY - b.minY, sz);
    // The turn goes after the scale, which only gives the same result when the turn keeps the footprint: any quarter
    // turn of a square box, only a half turn of an oblong one (as in boulder.ts). Boulders are cubes today.
    const square = Math.abs(sx - sz) < 0.01;
    const turns = boxIndex % (square ? 4 : 2);
    if (turns === 0) return;
    turned.makeRotationY(turns * (square ? Math.PI / 2 : Math.PI));
    this.turn(this.rocks.mesh, instance);
    if (this.rocks.hull) this.turn(this.rocks.hull, instance);
  }

  private turn(mesh: THREE.InstancedMesh, instance: number): void {
    mesh.getMatrixAt(instance, placed);
    mesh.setMatrixAt(instance, placed.multiply(turned));
  }

  has(boxIndex: number): boolean {
    return this.instanceOf[boxIndex]! >= 0;
  }

  // Shows or hides the far stone of one boulder (any other box is ignored). Sent on the next `commit`.
  setShown(boxIndex: number, shown: boolean): void {
    const instance = this.instanceOf[boxIndex]!;
    if (instance < 0 || (this.shownNow[instance] === 1) === shown) return;
    this.shownNow[instance] = shown ? 1 : 0;
    if (shown) this.place(instance);
    else this.rocks.hideOnly(instance);
  }

  shown(boxIndex: number): boolean {
    const instance = this.instanceOf[boxIndex]!;
    return instance >= 0 && this.shownNow[instance] === 1;
  }

  commit(): void {
    this.rocks.commit();
    // Three works out an instanced mesh's bounds once, for culling; stones shown since would fall outside them.
    this.rocks.mesh.boundingSphere = null;
    if (this.rocks.hull) this.rocks.hull.boundingSphere = null;
  }

  dispose(): void {
    this.rocks.dispose();
    this.geometry.dispose();
  }
}
