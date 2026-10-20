import * as THREE from "three";
import { freeze } from "../freeze";
import { castShadows } from "../sunShadows";
import type { PlayMap } from "../loadMap";
import type { MapMeshes } from "../mapRenderer";
import type { Toon } from "../toonMaterial";
import { toGeometry } from "./dressing";
import { farBay, nearBay, planBay, type BayPlan } from "./edgeBay";
import dressingJson from "../../../../data/dressing.json";
import { distanceToChunk, edgeBoxIndices, edgeChunks, edgeRuns, parseEdgeVariety, runToWorld, type BarrierConfig, type EdgeChunk, type EdgeRun } from "./edgeLayout";
import { fromMergeKey, mergeKey, seedOf } from "./kinds";
import { turn, type MeshData } from "./shapes";

const unitQuad = new THREE.PlaneGeometry(1, 1); // faces +z, which is w (into the map) in a run's frame
const at = new THREE.Vector3();
const sized = new THREE.Vector3();
const facing = new THREE.Quaternion();
const lying = new THREE.Quaternion();
const upAxis = new THREE.Vector3(0, 1, 0);
const flatDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const gone = new THREE.Matrix4().makeScale(0, 0, 0);

interface FarSlot { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }

// The map's edge walls drawn as a junkyard perimeter (see edgeBay.ts) instead of plain dark slabs. The plain boxes are
// hidden for good; collision is unchanged and stays the server's. The whole edge is always drawn as cheap far quads,
// one instanced mesh per paint with no outline (it is thin at that range anyway). Chunks near the camera swap their
// far quads for the full model, merged into one mesh plus outline per paint and rebuilt only when that set changes.
export class EdgeBarrier {
  readonly group = new THREE.Group();
  private runs: EdgeRun[];
  private chunks: EdgeChunk[];
  private plans: BayPlan[][]; // per run, per bay
  private farSlots: FarSlot[][] = []; // per chunk
  private farMeshes: THREE.InstancedMesh[] = [];
  private nearPieces = new Map<number, Map<string, MeshData[]>>(); // chunk → paint hex → meshes, built once
  private near = new Set<number>();
  private wanted = new Set<number>(); // the chunks that should be near, shown once all are built
  private missing: number[] = []; // wanted chunks still to build
  private nearMeshes = new THREE.Group();
  private checkedAt = new THREE.Vector3(Infinity, 0, 0);

  constructor(private scene: THREE.Scene, private toon: Toon, map: PlayMap, mapMeshes: MapMeshes, private config: BarrierConfig) {
    // The wall's shape comes from backdrop.json; what varies from bay to bay lives with the rest of the dressing.
    this.config = { ...config, variety: config.variety ?? parseEdgeVariety(dressingJson.edge) };
    const edges = map.tier === "range" ? [] : edgeBoxIndices(map.boxes, map.meters);
    for (const i of edges) mapMeshes.setVisible(i, false);
    mapMeshes.commit();
    this.runs = edgeRuns(map.boxes, edges, config.bayMeters);
    this.chunks = edgeChunks(this.runs, config.baysPerChunk);
    this.plans = this.runs.map((run, r) => Array.from({ length: run.bays }, (_, b) =>
      planBay(this.config, seedOf(map.seed, 200000 + r * 10000 + b), b * run.bayLength, run.bayLength, run.height, run.thickness)));
    this.buildFar();
    this.group.add(this.nearMeshes);
    // The far quads are instances and the near models are built in place: nothing here moves.
    freeze(this.group);
    scene.add(this.group);
  }

  private buildFar(): void {
    const all = this.chunks.map((chunk) => this.plans[chunk.run]!.slice(chunk.firstBay, chunk.firstBay + chunk.bayCount).flatMap((p) => farBay(this.config, p)));
    const counts = new Map<string, number>();
    for (const boxes of all) for (const b of boxes) { const hex = this.toon.color(b.paint); counts.set(hex, (counts.get(hex) ?? 0) + 1); }
    const meshes = new Map<string, THREE.InstancedMesh>();
    for (const [hex, count] of counts) {
      const mesh = new THREE.InstancedMesh(unitQuad, this.toon.instanced(this.toon.world(hex)), count);
      mesh.count = 0;
      meshes.set(hex, mesh);
      this.farMeshes.push(mesh);
      this.group.add(mesh);
    }
    all.forEach((boxes, c) => {
      const run = this.runs[this.chunks[c]!.run]!;
      facing.setFromAxisAngle(upAxis, run.yaw);
      lying.copy(facing).multiply(flatDown);
      this.farSlots.push(boxes.map((b) => {
        const mesh = meshes.get(this.toon.color(b.paint))!;
        at.set(...runToWorld(run, ...b.centre));
        const matrix = new THREE.Matrix4().compose(at, b.up ? lying : facing, sized.set(b.size[0], b.size[1], 1));
        const index = mesh.count++;
        mesh.setMatrixAt(index, matrix);
        return { mesh, index, matrix };
      }));
    });
    for (const mesh of this.farMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  // Call each frame with the camera's position. Only does work once the camera has moved a few metres. When a cut of
  // the spectator camera needs more chunks built than `buildAtOnce`, they are built one per frame and the far quads
  // stand in until all are ready, rather than one frame of 20 to 40 ms.
  update(camera: THREE.Vector3): void {
    if (this.missing.length > 0) {
      this.piecesOf(this.missing.pop()!);
      if (this.missing.length === 0) this.show(this.wanted);
    }
    if (camera.distanceToSquared(this.checkedAt) < this.config.recheckMeters ** 2) return;
    const first = this.checkedAt.x === Infinity; // while the map loads, so it never waits
    this.checkedAt.copy(camera);
    const wanted = new Set<number>();
    this.chunks.forEach((chunk, c) => { if (distanceToChunk(chunk, camera.x, camera.y, camera.z) < this.config.nearMeters) wanted.add(c); });
    if (wanted.size === this.wanted.size && [...wanted].every((c) => this.wanted.has(c))) return;
    this.wanted = wanted;
    this.missing = [...wanted].filter((c) => !this.nearPieces.has(c));
    if (first || this.missing.length <= this.config.buildAtOnce) {
      this.missing = [];
      this.show(wanted);
    }
  }

  private show(wanted: Set<number>): void {
    for (const c of this.near) if (!wanted.has(c)) for (const s of this.farSlots[c]!) s.mesh.setMatrixAt(s.index, s.matrix);
    for (const c of wanted) if (!this.near.has(c)) for (const s of this.farSlots[c]!) s.mesh.setMatrixAt(s.index, gone);
    for (const mesh of this.farMeshes) mesh.instanceMatrix.needsUpdate = true;
    this.near = wanted;
    this.rebuildNear();
  }

  private piecesOf(c: number): Map<string, MeshData[]> {
    let byPaint = this.nearPieces.get(c);
    if (byPaint) return byPaint;
    byPaint = new Map();
    const chunk = this.chunks[c]!, run = this.runs[chunk.run]!;
    for (const plan of this.plans[chunk.run]!.slice(chunk.firstBay, chunk.firstBay + chunk.bayCount)) {
      for (const piece of nearBay(this.config, plan)) {
        const key = mergeKey(this.toon.color(piece.paint), piece.surface);
        const mesh = turn(piece.mesh, [0, run.yaw, 0], [0, 0, 0], run.origin);
        const list = byPaint.get(key);
        if (list) list.push(mesh);
        else byPaint.set(key, [mesh]);
      }
    }
    this.nearPieces.set(c, byPaint);
    return byPaint;
  }

  private rebuildNear(): void {
    for (const child of [...this.nearMeshes.children]) {
      this.nearMeshes.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    const merged = new Map<string, MeshData[]>();
    for (const c of this.near) {
      for (const [paint, meshes] of this.piecesOf(c)) {
        const list = merged.get(paint);
        if (list) list.push(...meshes);
        else merged.set(paint, [...meshes]);
      }
    }
    // Merged geometry is not the unit box, so its paint never chips along edges (edges = false).
    for (const [key, meshes] of merged) {
      const [hex, surface] = fromMergeKey(key);
      const geometry = toGeometry(meshes);
      this.nearMeshes.add(new THREE.Mesh(geometry, this.toon.world(hex, surface, false)), new THREE.Mesh(geometry, this.toon.shellOutline(hex)));
    }
    freeze(this.nearMeshes);
    castShadows(this.nearMeshes);
  }

  dispose(): void {
    for (const child of this.nearMeshes.children) (child as THREE.Mesh).geometry.dispose();
    for (const mesh of this.farMeshes) mesh.dispose();
    this.scene.remove(this.group);
  }
}
