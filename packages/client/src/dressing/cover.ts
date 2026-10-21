import * as THREE from "three";
import { addOutlineNormals } from "../outlineNormals";
import type { Toon } from "../toonMaterial";
import { withoutCreases } from "../creasePass";
import { COVER_KINDS, type CoverConfig } from "./coverConfig";
import { CoverSites, ITEM_FLOATS, planCell, type CoverMap } from "./coverPlan";
import { coverModel, OUTLINED } from "./coverShapes";

const CACHED_CELLS = 600; // planned cells kept; a cell walked away from is planned again if you come back

// Dense grass, weeds, ferns, rubble and scrap on the ground round the mech you are looking at (coverPlan.ts decides
// where). One instanced mesh per kind, plus an outline for the solid kinds: seven draw calls whatever the count.
// Nothing collides. The instances are rewritten only when the view has moved `recheckMeters`; on the way out to
// `radiusMeters` each clump shrinks into the ground over the last `fadeMeters`, so the edge never shows as a line.
export class GroundCover {
  readonly group = new THREE.Group();
  private sites: CoverSites;
  private meshes: THREE.InstancedMesh[] = [];
  private outlines: (THREE.InstancedMesh | null)[] = [];
  private colors: THREE.InstancedBufferAttribute[] = [];
  private counts: Int32Array;
  private planned = new Map<number, Float32Array>(); // cell key → its items, oldest first
  private offsets: [number, number][] = []; // cells round the centre cell, nearest first
  private at = new THREE.Vector2(Infinity, Infinity);
  private material: THREE.MeshToonMaterial;

  constructor(private toon: Toon, private map: CoverMap, private config: CoverConfig) {
    this.sites = new CoverSites(map, config);
    this.counts = new Int32Array(COVER_KINDS.length);
    this.material = toon.ownMaterial("#ffffff");
    this.material.vertexColors = true;
    this.material.side = THREE.DoubleSide; // plants are cards
    withoutCreases(this.material); // every blade would be a crease line (creasePass.ts)
    // A white shell taking each corner's paint and each item's tint, so every part is inked from its own colour.
    // A copy of its own: the shared white shell is also the trees', whose corner colours must not reach their ink.
    const shared = toon.instanced(toon.shellOutline("#ffffff"));
    const outline = shared.clone();
    outline.onBeforeCompile = shared.onBeforeCompile;
    outline.customProgramCacheKey = shared.customProgramCacheKey;
    outline.vertexColors = true;
    const cap = config.maxPerKind;
    for (const kind of COVER_KINDS) {
      const geometry = this.geometryOf(kind);
      const mesh = new THREE.InstancedMesh(geometry, this.material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const color = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      color.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = color;
      mesh.count = 0;
      mesh.receiveShadow = true;
      // One sphere round the whole patch, moved with it (see update), instead of three working one out per rewrite.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), config.radiusMeters + 2);
      this.meshes.push(mesh);
      this.colors.push(color);
      this.group.add(mesh);
      if (OUTLINED.has(kind)) {
        const shell = new THREE.InstancedMesh(geometry, outline, cap);
        shell.instanceMatrix = mesh.instanceMatrix; // the same instances, drawn again from the inside
        shell.instanceColor = color;
        shell.count = 0;
        shell.boundingSphere = mesh.boundingSphere;
        this.outlines.push(shell);
        this.group.add(shell);
      } else this.outlines.push(null);
    }
    const reach = Math.ceil(config.radiusMeters / config.cellMeters) + 1;
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) this.offsets.push([dx, dz]);
    this.offsets.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    this.group.matrixAutoUpdate = false;
  }

  private geometryOf(kind: (typeof COVER_KINDS)[number]): THREE.BufferGeometry {
    const pieces = coverModel(kind);
    let vertices = 0, indices = 0;
    for (const p of pieces) { vertices += p.mesh.positions.length; indices += p.mesh.indices.length; }
    const positions = new Float32Array(vertices), normals = new Float32Array(vertices), colors = new Float32Array(vertices);
    const index = new Uint16Array(indices);
    const color = new THREE.Color();
    let v = 0, i = 0;
    for (const p of pieces) {
      color.set(this.toon.color(p.paint));
      const base = v / 3;
      positions.set(p.mesh.positions, v);
      normals.set(p.mesh.normals, v);
      for (let k = 0; k < p.mesh.positions.length; k += 3) colors.set([color.r, color.g, color.b], v + k);
      for (const k of p.mesh.indices) index[i++] = k + base;
      v += p.mesh.positions.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return OUTLINED.has(kind) ? addOutlineNormals(geometry) : geometry;
  }

  private cell(cx: number, cz: number): Float32Array {
    const key = cz * this.sites.cellsPerSide + cx;
    let items = this.planned.get(key);
    if (items) return items;
    items = planCell(this.sites, this.map, this.config, cx, cz);
    this.planned.set(key, items);
    if (this.planned.size > CACHED_CELLS) this.planned.delete(this.planned.keys().next().value!);
    return items;
  }

  // Call each frame with where the view is. Rewrites the instances only after a move of `recheckMeters`.
  update(x: number, z: number): void {
    const c = this.config;
    if ((x - this.at.x) ** 2 + (z - this.at.y) ** 2 < c.recheckMeters ** 2) return;
    this.at.set(x, z);
    this.counts.fill(0);
    const [cx, cz] = this.sites.cellOf(x, z);
    const cells = this.sites.cellsPerSide;
    const reach = c.radiusMeters + c.cellMeters * 0.75;
    const fadeFrom = c.radiusMeters - c.fadeMeters;
    for (const [dx, dz] of this.offsets) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= cells || nz >= cells || Math.hypot(dx, dz) * c.cellMeters > reach) continue;
      const items = this.cell(nx, nz);
      for (let i = 0; i < items.length; i += ITEM_FLOATS) {
        const ix = items[i + 1]!, iz = items[i + 3]!;
        const d = Math.sqrt((ix - x) ** 2 + (iz - z) ** 2);
        if (d >= c.radiusMeters) continue;
        const fade = d <= fadeFrom ? 1 : (c.radiusMeters - d) / c.fadeMeters;
        if (fade < 0.05) continue;
        const kind = items[i]!;
        const n = this.counts[kind]!;
        if (n >= c.maxPerKind) continue;
        this.counts[kind] = n + 1;
        // Turned about y and sized, written straight into the instance buffer (column-major), nothing allocated.
        const yaw = items[i + 4]!, s = items[i + 5]! * fade, h = items[i + 6]! * fade;
        const cos = Math.cos(yaw), sin = Math.sin(yaw);
        const m = this.meshes[kind]!.instanceMatrix.array as Float32Array, o = n * 16;
        m[o] = cos * s; m[o + 1] = 0; m[o + 2] = -sin * s; m[o + 3] = 0;
        m[o + 4] = 0; m[o + 5] = h; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = sin * s; m[o + 9] = 0; m[o + 10] = cos * s; m[o + 11] = 0;
        m[o + 12] = ix; m[o + 13] = items[i + 2]!; m[o + 14] = iz; m[o + 15] = 1;
        const col = this.colors[kind]!.array as Float32Array;
        col[n * 3] = items[i + 7]!; col[n * 3 + 1] = items[i + 8]!; col[n * 3 + 2] = items[i + 9]!;
      }
    }
    const y = this.sites.heightAt(x, z);
    this.meshes.forEach((mesh, k) => {
      const n = this.counts[k]!;
      mesh.count = n;
      mesh.boundingSphere!.center.set(x, y, z);
      // Only the part in use goes to the GPU.
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      this.colors[k]!.clearUpdateRanges();
      this.colors[k]!.addUpdateRange(0, n * 3);
      this.colors[k]!.needsUpdate = true;
      const shell = this.outlines[k];
      if (shell) shell.count = n;
    });
  }

  // How many clumps of each kind are drawn now, for tests and the perf notes.
  get drawn(): readonly number[] {
    return [...this.counts];
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
  }
}
