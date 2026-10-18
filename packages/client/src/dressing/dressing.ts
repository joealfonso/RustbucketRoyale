import * as THREE from "three";
import type { PlayMap } from "../loadMap";
import type { MapMeshes } from "../mapRenderer";
import type { Toon } from "../toonMaterial";
import { seedOf, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import type { MeshData } from "./shapes";

export interface DressingConfig {
  radiusMeters: number; // boxes in chunks closer than this are dressed; the rest stay plain boxes
  chunkMeters: number; // the size of the map's chunks
  scatterPerChunk: number; // loose junk and grass dropped on open ground per chunk
}

// Things lying about on open ground in one chunk. Visual only: nothing here collides.
export type Scatter = (chunk: { minX: number; minZ: number; size: number; seed: number }, boxes: readonly DressBox[], count: number) => DressPiece[];

// The junkyard dressing: near you, map boxes are replaced on screen by models built for their kind (a ribbed container,
// a corrugated wall) and open ground gets scattered junk. Collision never changes: the dressing stays inside each box.
// Each chunk's pieces are built once and kept. The chunks near you are merged into one mesh (plus its outline) per
// paint, rebuilt only when you move into another chunk, so it costs a few draw calls and almost nothing per frame.
export class Dressing {
  readonly group = new THREE.Group();
  private chunkPieces = new Map<number, Map<string, MeshData[]>>(); // chunk key → paint → meshes
  private chunkBoxes = new Map<number, number[]>(); // chunk key → dressed box indices in it
  private chunkBlockers = new Map<number, number[]>(); // chunk key → every box standing in it, for the scatter
  private ahead: number[] = []; // chunks just beyond the dressed ones, to build on quiet frames
  private near = new Set<number>();
  private centreKey = Number.NaN;
  private perChunk: number;

  constructor(
    private scene: THREE.Scene, private toon: Toon, private map: PlayMap, private mapMeshes: MapMeshes,
    private builders: Record<string, KindBuilder>, private scatter: Scatter | null, private config: DressingConfig,
  ) {
    this.perChunk = Math.ceil(map.meters / config.chunkMeters);
    map.boxes.forEach((b, i) => {
      const kind = map.kinds[i]!;
      if (kind < 0 || !builders[map.kindNames[kind]!]) return;
      const key = this.keyAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      const list = this.chunkBoxes.get(key);
      if (list) list.push(i);
      else this.chunkBoxes.set(key, [i]);
    });
    // Every box standing above the ground, filed under each chunk it touches (big ones span several).
    map.boxes.forEach((b, i) => {
      if (i === 0 || b.maxY < 0.05) return;
      const [x0, z0] = this.cellAt(b.minX, b.minZ), [x1, z1] = this.cellAt(b.maxX, b.maxZ);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const key = z * this.perChunk + x;
          const list = this.chunkBlockers.get(key);
          if (list) list.push(i);
          else this.chunkBlockers.set(key, [i]);
        }
      }
    });
    scene.add(this.group);
  }

  private cellAt(x: number, z: number): [number, number] {
    const half = this.map.meters / 2;
    const clamp = (n: number) => Math.min(this.perChunk - 1, Math.max(0, Math.floor((n + half) / this.config.chunkMeters)));
    return [clamp(x), clamp(z)];
  }

  private keyAt(x: number, z: number): number {
    const [cx, cz] = this.cellAt(x, z);
    return cz * this.perChunk + cx;
  }

  // The chunks within `radius` metres of a chunk.
  private around(key: number, radius: number): Set<number> {
    const reach = Math.ceil(radius / this.config.chunkMeters);
    const cx = key % this.perChunk, cz = Math.floor(key / this.perChunk);
    const out = new Set<number>();
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x2 = cx + dx, z2 = cz + dz;
        if (x2 < 0 || z2 < 0 || x2 >= this.perChunk || z2 >= this.perChunk) continue;
        if (Math.hypot(dx, dz) * this.config.chunkMeters > radius + this.config.chunkMeters / 2) continue;
        out.add(z2 * this.perChunk + x2);
      }
    }
    return out;
  }

  // Call each frame with where the camera's mech is. Real work happens on entering a new chunk; on other frames one
  // chunk just beyond the dressed ones is built ahead, so crossing into it later costs only the merge.
  update(x: number, z: number): void {
    const key = this.keyAt(x, z);
    if (key === this.centreKey) {
      const next = this.ahead.pop();
      if (next !== undefined) this.piecesOf(next);
      return;
    }
    this.centreKey = key;
    const wanted = this.around(key, this.config.radiusMeters);
    this.ahead = [...this.around(key, this.config.radiusMeters + this.config.chunkMeters)].filter((k) => !wanted.has(k) && !this.chunkPieces.has(k));
    // Plain boxes come back where the dressing leaves, and hide where it arrives.
    for (const k of this.near) if (!wanted.has(k)) for (const i of this.chunkBoxes.get(k) ?? []) this.mapMeshes.setVisible(i, true);
    for (const k of wanted) if (!this.near.has(k)) for (const i of this.chunkBoxes.get(k) ?? []) this.mapMeshes.setVisible(i, false);
    this.mapMeshes.commit();
    this.near = wanted;
    this.rebuild();
  }

  private piecesOf(key: number): Map<string, MeshData[]> {
    let byPaint = this.chunkPieces.get(key);
    if (byPaint) return byPaint;
    byPaint = new Map();
    const add = (pieces: DressPiece[]) => {
      for (const p of pieces) {
        const hex = this.toon.color(p.paint);
        const list = byPaint!.get(hex);
        if (list) list.push(p.mesh);
        else byPaint!.set(hex, [p.mesh]);
      }
    };
    const boxes: DressBox[] = [];
    for (const i of this.chunkBoxes.get(key) ?? []) {
      const b = this.map.boxes[i]!;
      const box: DressBox = { min: [b.minX, b.minY, b.minZ], max: [b.maxX, b.maxY, b.maxZ], seed: seedOf(this.map.seed, i), color: this.map.palette[this.map.colors[i]!]! };
      boxes.push(box);
      add(this.builders[this.map.kindNames[this.map.kinds[i]!]!]!(box));
    }
    if (this.scatter && this.config.scatterPerChunk > 0) {
      // Open ground: every box standing in this chunk (not only dressed ones) is something to keep clear of.
      const half = this.map.meters / 2;
      const size = this.config.chunkMeters;
      const minX = (key % this.perChunk) * size - half, minZ = Math.floor(key / this.perChunk) * size - half;
      const blockers: DressBox[] = (this.chunkBlockers.get(key) ?? []).map((i) => {
        const b = this.map.boxes[i]!;
        return { min: [b.minX, b.minY, b.minZ], max: [b.maxX, b.maxY, b.maxZ], seed: 0, color: "" };
      });
      add(this.scatter({ minX, minZ, size, seed: seedOf(this.map.seed, 100000 + key) }, blockers, this.config.scatterPerChunk));
    }
    this.chunkPieces.set(key, byPaint);
    return byPaint;
  }

  private rebuild(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    const merged = new Map<string, MeshData[]>();
    for (const key of this.near) {
      for (const [hex, meshes] of this.piecesOf(key)) {
        const list = merged.get(hex);
        if (list) list.push(...meshes);
        else merged.set(hex, [...meshes]);
      }
    }
    for (const [hex, meshes] of merged) {
      const geometry = toGeometry(meshes);
      this.group.add(new THREE.Mesh(geometry, this.toon.world(hex)), new THREE.Mesh(geometry, this.toon.shellOutline(hex)));
    }
  }

  dispose(): void {
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    this.scene.remove(this.group);
  }
}

// Many meshes as one three.js geometry (positions, normals, one index).
export function toGeometry(meshes: MeshData[]): THREE.BufferGeometry {
  let vertices = 0, indices = 0;
  for (const m of meshes) { vertices += m.positions.length; indices += m.indices.length; }
  const positions = new Float32Array(vertices), normals = new Float32Array(vertices);
  const index = vertices / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0, i = 0;
  for (const m of meshes) {
    const base = v / 3;
    positions.set(m.positions, v);
    normals.set(m.normals, v);
    for (const k of m.indices) index[i++] = k + base;
    v += m.positions.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
