import * as THREE from "three";
import { freeze } from "../freeze";
import { castShadows } from "../sunShadows";
import { addOutlineNormals } from "../outlineNormals";
import type { PlayMap } from "../loadMap";
import type { MapMeshes } from "../mapRenderer";
import type { Toon } from "../toonMaterial";
import { GroundCover } from "./cover";
import { parseCover } from "./coverConfig";
import { FarBoulders } from "./farBoulders";
import { fromMergeKey, mergeKey, seedOf, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import type { MeshData } from "./shapes";

export interface DressingConfig {
  radiusMeters: number; // boxes in chunks closer than this are dressed; the rest stay plain boxes
  chunkMeters: number; // the size of the map's chunks
  scatterPerChunk: number; // loose junk and grass dropped on open ground per chunk
  buildAtOnce: number; // a move needing more unbuilt chunks than this (a spectator cut) builds them one per frame
  cover?: unknown; // the near ground cover (coverConfig.ts), checked on load; none without it
}

// Things lying about on open ground in one chunk. Visual only: nothing here collides. `groundAt` is the height of
// the hills; without it the ground is level at 0.
export type Scatter = (
  chunk: { minX: number; minZ: number; size: number; seed: number; groundAt?: (x: number, z: number) => number },
  boxes: readonly DressBox[], count: number,
) => DressPiece[];

// The junkyard dressing: near you, map boxes are replaced on screen by models built for their kind (a ribbed container,
// a corrugated wall) and open ground gets scattered junk. Collision never changes: the dressing stays inside each box.
// Each chunk's pieces are built once and kept. The chunks near you are merged into one mesh (plus its outline) per
// paint, rebuilt only when you move into another chunk, so it costs a few draw calls and almost nothing per frame.
// Beyond the dressed chunks every kind is its plain box again, except boulders, which have a far stone of their own
// (farBoulders.ts) because a hillside of grey cubes does not read as rock.
export class Dressing {
  readonly group = new THREE.Group();
  readonly far: FarBoulders | null = null;
  readonly cover: GroundCover | null = null;
  private chunkPieces = new Map<number, Map<string, ChunkGeometry>>(); // chunk key → paint and surface (mergeKey) → its geometry
  private chunkBoxes = new Map<number, number[]>(); // chunk key → dressed box indices in it
  private chunkBlockers = new Map<number, number[]>(); // chunk key → every box standing in it, for the scatter
  private ahead: number[] = []; // chunks just beyond the dressed ones, to build on quiet frames
  private near = new Set<number>();
  private centreKey = Number.NaN;
  private wanted = new Set<number>(); // the chunks to dress around centreKey, shown once all are built
  private missing: number[] = []; // wanted chunks still to build, nearest last
  private perChunk: number;
  private groundAt: ((x: number, z: number) => number) | undefined;

  constructor(
    private scene: THREE.Scene, private toon: Toon, private map: PlayMap, private mapMeshes: MapMeshes,
    private builders: Record<string, KindBuilder>, private scatter: Scatter | null, private config: DressingConfig,
  ) {
    this.perChunk = Math.ceil(map.meters / config.chunkMeters);
    const terrain = map.terrain;
    this.groundAt = terrain ? (x, z) => terrain.heightAt(x, z) : undefined;
    const boulders: number[] = [];
    map.boxes.forEach((b, i) => {
      const kind = map.kinds[i]!;
      if (kind < 0 || !builders[map.kindNames[kind]!]) return;
      if (map.kindNames[kind] === "boulder") boulders.push(i);
      const key = this.keyAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      const list = this.chunkBoxes.get(key);
      if (list) list.push(i);
      else this.chunkBoxes.set(key, [i]);
    });
    // Every box standing above the ground, filed under each chunk it touches (big ones span several).
    const groundUnder = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => map.terrain?.heightAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) ?? 0;
    map.boxes.forEach((b, i) => {
      if (i === 0 || b.maxY < groundUnder(b) + 0.05) return;
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
    if (boulders.length > 0) {
      this.far = new FarBoulders(toon, map, boulders);
      for (const i of boulders) mapMeshes.setVisible(i, false);
      mapMeshes.commit();
      scene.add(this.far.group);
    }
    if (config.cover !== undefined) {
      this.cover = new GroundCover(toon, map, parseCover(config.cover));
      scene.add(freeze(this.cover.group));
    }
    freeze(this.group);
    scene.add(this.group);
  }

  private cellAt(x: number, z: number): [number, number] {
    const half = this.map.meters / 2;
    const clamp = (n: number) => Math.min(this.perChunk - 1, Math.max(0, Math.floor((n + half) / this.config.chunkMeters)));
    return [clamp(x), clamp(z)];
  }

  // Called every frame, so it works the cell out in place rather than through cellAt's pair.
  private keyAt(x: number, z: number): number {
    const half = this.map.meters / 2, size = this.config.chunkMeters, last = this.perChunk - 1;
    const cx = Math.min(last, Math.max(0, Math.floor((x + half) / size)));
    const cz = Math.min(last, Math.max(0, Math.floor((z + half) / size)));
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
  // chunk just beyond the dressed ones is built ahead, so crossing into it later costs only the merge. A big jump (the
  // spectator camera cutting to another mech) would need a few dozen chunks built at once, a dropped frame of 50 to
  // 100 ms, so then they are built one per frame and the plain boxes stand in until all are ready.
  update(x: number, z: number): void {
    this.cover?.update(x, z);
    const key = this.keyAt(x, z);
    if (key === this.centreKey) {
      const next = this.missing.pop() ?? this.ahead.pop();
      if (next !== undefined) this.piecesOf(next);
      if (next !== undefined && this.missing.length === 0 && !this.showing()) this.show();
      return;
    }
    const first = Number.isNaN(this.centreKey);
    this.centreKey = key;
    this.wanted = this.around(key, this.config.radiusMeters);
    this.ahead = [...this.around(key, this.config.radiusMeters + this.config.chunkMeters)].filter((k) => !this.wanted.has(k) && !this.chunkPieces.has(k));
    const cx = key % this.perChunk, cz = Math.floor(key / this.perChunk);
    const away = (k: number) => Math.hypot((k % this.perChunk) - cx, Math.floor(k / this.perChunk) - cz);
    this.missing = [...this.wanted].filter((k) => !this.chunkPieces.has(k)).sort((a, b) => away(b) - away(a));
    // The first build happens while the map loads, so it never waits.
    if (first || this.missing.length <= this.config.buildAtOnce) {
      this.missing = [];
      this.show();
    }
  }

  private showing(): boolean {
    return this.near === this.wanted;
  }

  // Swaps the dressed chunks for `wanted`, building any still missing.
  private show(): void {
    const wanted = this.wanted;
    // Plain boxes (far stones, for boulders) come back where the dressing leaves, and hide where it arrives.
    for (const k of this.near) if (!wanted.has(k)) for (const i of this.chunkBoxes.get(k) ?? []) this.showFar(i, true);
    for (const k of wanted) if (!this.near.has(k)) for (const i of this.chunkBoxes.get(k) ?? []) this.showFar(i, false);
    this.mapMeshes.commit();
    this.far?.commit();
    this.near = wanted;
    this.rebuild();
  }

  // A box leaving or joining the dressed chunks: a boulder swaps with its far stone, anything else with its plain box.
  private showFar(boxIndex: number, shown: boolean): void {
    if (this.far?.has(boxIndex)) this.far.setShown(boxIndex, shown);
    else this.mapMeshes.setVisible(boxIndex, shown);
  }

  // Whether a box is drawn by the dressing right now, rather than as its plain box or far stone.
  isDressed(boxIndex: number): boolean {
    const b = this.map.boxes[boxIndex]!;
    const key = this.keyAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
    return this.near.has(key) && (this.chunkBoxes.get(key)?.includes(boxIndex) ?? false);
  }

  private piecesOf(key: number): Map<string, ChunkGeometry> {
    const built = this.chunkPieces.get(key);
    if (built) return built;
    const byPaint = new Map<string, MeshData[]>();
    const add = (pieces: DressPiece[]) => {
      for (const p of pieces) {
        const key = mergeKey(this.toon.color(p.paint), p.surface);
        const list = byPaint.get(key);
        if (list) list.push(p.mesh);
        else byPaint.set(key, [p.mesh]);
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
      add(this.scatter({ minX, minZ, size, seed: seedOf(this.map.seed, 100000 + key), groundAt: this.groundAt }, blockers, this.config.scatterPerChunk));
    }
    // The chunk's arrays and outline normals are made once here, so a chunk change only copies them (docs/PERF.md).
    const geometry = new Map<string, ChunkGeometry>();
    for (const [paint, meshes] of byPaint) geometry.set(paint, chunkGeometry(meshes));
    this.chunkPieces.set(key, geometry);
    return geometry;
  }

  private rebuild(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    const merged = new Map<string, ChunkGeometry[]>();
    for (const key of this.near) {
      for (const [paint, part] of this.piecesOf(key)) {
        const list = merged.get(paint);
        if (list) list.push(part);
        else merged.set(paint, [part]);
      }
    }
    // Merged geometry is not the unit box, so its paint never chips along edges (edges = false).
    for (const [key, parts] of merged) {
      const [hex, surface] = fromMergeKey(key);
      const geometry = joinChunks(parts);
      this.group.add(new THREE.Mesh(geometry, this.toon.world(hex, surface, false)), new THREE.Mesh(geometry, this.toon.shellOutline(hex)));
    }
    // A rebuild makes new meshes, which three would otherwise update every frame like anything else.
    freeze(this.group);
    castShadows(this.group);
  }

  dispose(): void {
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    this.scene.remove(this.group);
    if (this.cover) {
      this.scene.remove(this.cover.group);
      this.cover.dispose();
    }
    if (this.far) {
      this.scene.remove(this.far.group);
      this.far.dispose();
    }
  }
}

// One chunk's meshes of one paint, as the arrays a three.js geometry is made of, outline normals included.
export interface ChunkGeometry {
  positions: Float32Array;
  normals: Float32Array;
  outline: Float32Array;
  index: Uint32Array;
}

export function chunkGeometry(meshes: MeshData[]): ChunkGeometry {
  let vertices = 0, indices = 0;
  for (const m of meshes) { vertices += m.positions.length; indices += m.indices.length; }
  const positions = new Float32Array(vertices), normals = new Float32Array(vertices), index = new Uint32Array(indices);
  let v = 0, i = 0;
  for (const m of meshes) {
    const base = v / 3;
    positions.set(m.positions, v);
    normals.set(m.normals, v);
    for (const k of m.indices) index[i++] = k + base;
    v += m.positions.length;
  }
  return { positions, normals, outline: outlineNormals(positions, normals), index };
}

// The same outline normals as outlineNormals.ts (each corner gets the average of the face normals meeting there,
// corners within a millimetre being one), found with a hash table of whole millimetres instead of a string per
// corner: the dressing makes them for a chunk on a frame of its own, so this keeps that frame short.
function outlineNormals(positions: Float32Array, normals: Float32Array): Float32Array {
  const count = positions.length / 3;
  let size = 1;
  while (size < count * 2) size *= 2;
  const keys = new Int32Array(size * 3), used = new Uint8Array(size), sums = new Float64Array(size * 3);
  const slotOf = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const x = Math.round(positions[i * 3]! * 1000), y = Math.round(positions[i * 3 + 1]! * 1000), z = Math.round(positions[i * 3 + 2]! * 1000);
    let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    while (used[slot] && (keys[slot * 3] !== x || keys[slot * 3 + 1] !== y || keys[slot * 3 + 2] !== z)) slot = (slot + 1) & (size - 1);
    if (!used[slot]) { used[slot] = 1; keys[slot * 3] = x; keys[slot * 3 + 1] = y; keys[slot * 3 + 2] = z; }
    sums[slot * 3]! += normals[i * 3]!; sums[slot * 3 + 1]! += normals[i * 3 + 1]!; sums[slot * 3 + 2]! += normals[i * 3 + 2]!;
    slotOf[i] = slot;
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < count; i++) {
    const s = slotOf[i]! * 3, length = Math.hypot(sums[s]!, sums[s + 1]!, sums[s + 2]!);
    // Faces that cancel out (a sheet seen from both sides) fall back to the face's own normal.
    if (length < 1e-6) { out[i * 3] = normals[i * 3]!; out[i * 3 + 1] = normals[i * 3 + 1]!; out[i * 3 + 2] = normals[i * 3 + 2]!; }
    else { out[i * 3] = sums[s]! / length; out[i * 3 + 1] = sums[s + 1]! / length; out[i * 3 + 2] = sums[s + 2]! / length; }
  }
  return out;
}

// Several chunks' geometry as one, copied rather than worked out again. A corner shared by two chunks keeps each
// chunk's own outline normal, which only shows where two boxes meet exactly on a chunk line.
export function joinChunks(parts: ChunkGeometry[]): THREE.BufferGeometry {
  let vertices = 0, indices = 0;
  for (const p of parts) { vertices += p.positions.length; indices += p.index.length; }
  const positions = new Float32Array(vertices), normals = new Float32Array(vertices), outline = new Float32Array(vertices);
  const index = vertices / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0, i = 0;
  for (const p of parts) {
    positions.set(p.positions, v); normals.set(p.normals, v); outline.set(p.outline, v);
    const base = v / 3;
    for (let k = 0; k < p.index.length; k++) index[i++] = p.index[k]! + base;
    v += p.positions.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(outline, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
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
  return addOutlineNormals(geometry);
}
