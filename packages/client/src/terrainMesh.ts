import * as THREE from "three";
import type { Terrain } from "@rustbucket/shared";
import { freeze } from "./freeze";
import { groundLook, setGroundBeach } from "./groundMaterial";
import { waterLook } from "./waterLook";

// The drawn hills: the map's Terrain (packages/shared/src/terrain.ts) as a mesh, cut into square tiles so tiles off
// screen are culled. On big maps the tiles form a quadtree: far away four neighbouring tiles are drawn as one tile
// with every second corner, then every fourth, so the far hills cost few triangles and few draw calls.
// Near you the mesh is exact: the same corners and the same triangle split as Terrain.heightAt, so feet, props and
// junk placed with heightAt sit on what is drawn.
// Tiles are big (256 m in data/ground.json) because each one is a draw call, and draw calls cost this game more than
// triangles do: with 128 m tiles a view across the medium map took 43 calls for the hills, with 256 m tiles 14.

export interface TerrainMeshLook {
  tileMeters: number; // the side of a full-detail tile; a whole number of terrain cells
  lod: {
    fromMapMeters: number; // maps at least this big draw far tiles coarser; smaller maps are full detail everywhere
    fullDetailMeters: number; // a tile with every corner within this of the camera; doubling per coarser step
    maxStride: number; // the coarsest step: one in this many corners, a power of two
    recheckMeters: number; // the choice of tiles is redone once the camera has moved this far
  };
}

export function parseTerrainMeshLook(raw: unknown): TerrainMeshLook {
  const m = raw as TerrainMeshLook;
  if (!(m?.tileMeters > 0) || !m.lod) throw new Error("ground.json mesh: needs tileMeters and lod");
  const { fromMapMeters, fullDetailMeters, maxStride, recheckMeters } = m.lod;
  if (!(fromMapMeters > 0 && fullDetailMeters > 0 && recheckMeters > 0)) throw new Error("ground.json mesh.lod: fromMapMeters, fullDetailMeters and recheckMeters must be above 0");
  if (!(maxStride >= 1 && Number.isInteger(Math.log2(maxStride)))) throw new Error("ground.json mesh.lod: maxStride must be a power of two");
  return m;
}

// One square of the quadtree, in terrain cells: columns i0 to i1 and rows j0 to j1 of corners. `stride` is how many
// cells one of its quads spans; drawable nodes have a mesh, the ones above maxStride only group their children.
export interface TerrainNode {
  i0: number; j0: number; i1: number; j1: number;
  stride: number;
  children: TerrainNode[];
  mesh: THREE.Mesh | null;
}

// The quadtree over a map `cells` cells a side. Leaves are `tileCells` cells a side at full detail; each level up
// doubles the side and the stride. Squares past the map's far edge are cut off at it, so every node lies on the map.
export function planTerrainNodes(cells: number, tileCells: number): TerrainNode {
  let span = tileCells;
  while (span < cells) span *= 2;
  const make = (i0: number, j0: number, span: number): TerrainNode => {
    const stride = span / tileCells;
    const node: TerrainNode = { i0, j0, i1: Math.min(i0 + span, cells), j1: Math.min(j0 + span, cells), stride, children: [], mesh: null };
    if (stride > 1) {
      const half = span / 2;
      for (const [di, dj] of [[0, 0], [half, 0], [0, half], [half, half]] as const) {
        if (i0 + di < cells && j0 + dj < cells) node.children.push(make(i0 + di, j0 + dj, half));
      }
    }
    return node;
  };
  return make(0, 0, span);
}

// The corner columns (or rows) a node uses: every `stride`th from `from`, always ending on `to`.
function stops(from: number, to: number, stride: number): number[] {
  const out: number[] = [];
  for (let c = from; c < to; c += stride) out.push(c);
  out.push(to);
  return out;
}

// The upward normal at corner (i, j), from the heights of the corners round it. Every tile at every detail level
// reads the same normals, so the bands of light run on across tile edges without a seam.
function cornerNormal(terrain: Terrain, i: number, j: number, out: number[]): void {
  const n = terrain.corners - 1;
  const il = Math.max(0, i - 1), ir = Math.min(n, i + 1), jl = Math.max(0, j - 1), jr = Math.min(n, j + 1);
  const sx = (terrain.corner(ir, j) - terrain.corner(il, j)) / ((ir - il) * terrain.cell);
  const sz = (terrain.corner(i, jr) - terrain.corner(i, jl)) / ((jr - jl) * terrain.cell);
  const length = Math.hypot(sx, 1, sz);
  out[0] = -sx / length; out[1] = 1 / length; out[2] = -sz / length;
}

const normal = [0, 1, 0];

// The geometry of one node. Each quad is split along the diagonal from its (+x, -z) corner to its (-x, +z) corner,
// as Terrain.heightAt does. With `skirts`, every side that is not the map's edge gets a strip hanging straight down,
// which closes the slits that open where a tile meets a coarser neighbour. A skirt hangs as deep as the whole map's
// rise, so no slit between two tiles can ever be deeper than it.
export function terrainGeometry(terrain: Terrain, node: Pick<TerrainNode, "i0" | "j0" | "i1" | "j1" | "stride">, skirts: boolean): THREE.BufferGeometry {
  const half = terrain.meters / 2;
  const cols = stops(node.i0, node.i1, node.stride), rows = stops(node.j0, node.j1, node.stride);
  const nc = cols.length, nr = rows.length;
  const last = terrain.corners - 1;
  const sides = skirts ? [node.j0 > 0, node.i1 < last, node.j1 < last, node.i0 > 0] : [false, false, false, false]; // -z, +x, +z, -x
  const skirtVertices = sides.reduce((sum, on, s) => sum + (on ? (s % 2 === 0 ? nc : nr) : 0), 0);
  const vertexCount = nc * nr + skirtVertices;
  const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
  const quads = (nc - 1) * (nr - 1) + sides.reduce((sum, on, s) => sum + (on ? (s % 2 === 0 ? nc : nr) - 1 : 0), 0);
  const index = vertexCount > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let v = 0, k = 0;
  const put = (i: number, j: number, drop: number) => {
    cornerNormal(terrain, i, j, normal);
    positions[v * 3] = i * terrain.cell - half; positions[v * 3 + 1] = terrain.corner(i, j) - drop; positions[v * 3 + 2] = j * terrain.cell - half;
    normals[v * 3] = normal[0]!; normals[v * 3 + 1] = normal[1]!; normals[v * 3 + 2] = normal[2]!;
    return v++;
  };
  for (const j of rows) for (const i of cols) put(i, j, 0);
  for (let r = 0; r < nr - 1; r++) {
    for (let c = 0; c < nc - 1; c++) {
      const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1; // a (-x,-z), b (+x,-z), d (-x,+z), e (+x,+z)
      // Wound so the faces point up: (a, d, b) and (e, b, d), split along b-d.
      index[k++] = a; index[k++] = d; index[k++] = b;
      index[k++] = e; index[k++] = b; index[k++] = d;
    }
  }
  const depth = terrain.maxHeight - terrain.minHeight + 1;
  sides.forEach((on, side) => {
    if (!on) return;
    // The top edge of this side as vertex numbers in the grid above, in rising x or z.
    const along = side % 2 === 0 ? nc : nr;
    const top = (n: number) => (side === 0 ? n : side === 1 ? n * nc + nc - 1 : side === 2 ? (nr - 1) * nc + n : n * nc);
    const first = v;
    for (let n = 0; n < along; n++) {
      const t = top(n);
      const i = cols[t % nc]!, j = rows[Math.floor(t / nc)]!;
      put(i, j, depth);
    }
    // Facing out of the tile: -z and +x run one way round, +z and -x the other.
    const outward = side === 0 || side === 1;
    for (let n = 0; n < along - 1; n++) {
      const t0 = top(n), t1 = top(n + 1), b0 = first + n, b1 = first + n + 1;
      if (outward) { index[k++] = t0; index[k++] = t1; index[k++] = b0; index[k++] = t1; index[k++] = b1; index[k++] = b0; }
      else { index[k++] = t0; index[k++] = b0; index[k++] = t1; index[k++] = t1; index[k++] = b0; index[k++] = b1; }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// The open sea round an island runs past the map's edge to the horizon: a ring of long quads from each corner on the
// map's edge straight out from the middle to a square `outMeters` beyond it. Both the seabed (here) and the water
// (waterMesh.ts) are drawn on it, sharing the map's own edge corners, so they meet the map's mesh with no seam.
// `corners` lists the edge corners in order round the map (as indices into the terrain's corners) and `far` the
// matching point on the outer square; quad q joins corner q, corner q + 1 and their far points.
export interface SeaRing {
  corners: number[];
  far: [number, number][];
}

export function seaRing(terrain: Terrain, outMeters: number): SeaRing {
  const n = terrain.corners - 1, half = terrain.meters / 2, scale = (half + outMeters) / half;
  const corners: number[] = [];
  const at = (i: number, j: number) => corners.push(j * terrain.corners + i);
  for (let i = 0; i < n; i++) at(i, 0);
  for (let j = 0; j < n; j++) at(n, j);
  for (let i = n; i > 0; i--) at(i, n);
  for (let j = n; j > 0; j--) at(0, j);
  const far = corners.map((k): [number, number] => [((k % terrain.corners) * terrain.cell - half) * scale, (Math.floor(k / terrain.corners) * terrain.cell - half) * scale]);
  return { corners, far };
}

// Two triangles per quad of the ring, facing up. `near(q)` and `far(q)` are vertex numbers of ring point q.
export function seaRingIndex(count: number, near: (q: number) => number, far: (q: number) => number, out: number[]): void {
  for (let q = 0; q < count; q++) {
    const r = (q + 1) % count;
    // Going round the map this way, (near q, near r, far q) faces up.
    out.push(near(q), near(r), far(q), far(q), near(r), far(r));
  }
}

// The seabed beyond an island's map: level with the map's edge, out to the horizon.
export function seabedGeometry(terrain: Terrain, outMeters: number): THREE.BufferGeometry {
  const ring = seaRing(terrain, outMeters), count = ring.corners.length, half = terrain.meters / 2;
  const positions = new Float32Array(count * 2 * 3), normals = new Float32Array(count * 2 * 3);
  ring.corners.forEach((k, q) => {
    const y = terrain.heights[k]! / 100;
    positions.set([(k % terrain.corners) * terrain.cell - half, y, Math.floor(k / terrain.corners) * terrain.cell - half], q * 3);
    positions.set([ring.far[q]![0], y, ring.far[q]![1]], (count + q) * 3);
  });
  for (let v = 0; v < count * 2; v++) normals[v * 3 + 1] = 1;
  const index: number[] = [];
  seaRingIndex(count, (q) => q, (q) => count + q, index);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

// Which nodes to draw from a camera at (x, y, z): a node is drawn whole when it is far enough away for its stride,
// otherwise its children are looked at instead. The drawn nodes cover the map once, with no gaps and no overlaps.
// `draw` is called for each drawn node; nothing is allocated.
export function selectTerrainNodes(
  node: TerrainNode, terrain: Terrain, x: number, y: number, z: number, fullDetailMeters: number, maxStride: number, draw: (node: TerrainNode) => void,
): void {
  if (node.stride === 1 || (node.stride <= maxStride && distanceTo(node, terrain, x, y, z) > fullDetailMeters * (node.stride / 2))) {
    draw(node);
    return;
  }
  for (const child of node.children) selectTerrainNodes(child, terrain, x, y, z, fullDetailMeters, maxStride, draw);
}

// From the camera to the nearest point of a node's square, counting only height above the highest hill.
function distanceTo(node: TerrainNode, terrain: Terrain, x: number, y: number, z: number): number {
  const half = terrain.meters / 2, cell = terrain.cell;
  const dx = Math.max(node.i0 * cell - half - x, 0, x - (node.i1 * cell - half));
  const dz = Math.max(node.j0 * cell - half - z, 0, z - (node.j1 * cell - half));
  const dy = Math.max(0, y - terrain.maxHeight);
  return Math.hypot(dx, dy, dz);
}

// The hills of one map, ready to draw. Every drawable node's mesh is built up front (about 20 ms on the large map);
// `update` only switches meshes on and off, and only once the camera has moved a few metres.
export class TerrainMeshes {
  readonly group = new THREE.Group();
  private root: TerrainNode;
  private meshes: THREE.Mesh[] = [];
  private lod: boolean;
  private checkedAt = new THREE.Vector3(Infinity, 0, 0);
  private show = (node: TerrainNode) => { node.mesh!.visible = true; };
  private seabed: THREE.Mesh | null = null;
  private inks: THREE.Mesh[] = [];

  // `ink`: the crest ink shell (crestInk.ts), drawn with each tile and switched with it; the flat seabed has none.
  constructor(private scene: THREE.Scene, private terrain: Terrain, material: THREE.Material, private look: TerrainMeshLook, ink: THREE.Material | null = null) {
    const tileCells = Math.max(1, Math.round(look.tileMeters / terrain.cell));
    const cells = terrain.corners - 1;
    this.lod = terrain.meters >= look.lod.fromMapMeters && look.lod.maxStride > 1;
    this.root = planTerrainNodes(cells, tileCells);
    const maxStride = this.maxStride;
    const build = (node: TerrainNode) => {
      if (node.stride <= maxStride) {
        node.mesh = new THREE.Mesh(terrainGeometry(terrain, node, this.lod), material);
        node.mesh.visible = false;
        if (ink) {
          const shell = new THREE.Mesh(node.mesh.geometry, ink);
          node.mesh.add(shell);
          this.inks.push(shell);
        }
        this.meshes.push(node.mesh);
        this.group.add(node.mesh);
      }
      for (const child of node.children) build(child);
    };
    build(this.root);
    // An island's seabed runs on under the open sea; it is one mesh, always drawn, outside the tiles' switching.
    if (terrain.island) {
      this.seabed = new THREE.Mesh(seabedGeometry(terrain, waterLook.sea.outMeters), material);
      this.group.add(this.seabed);
    }
    // The ground under this map's hills has a sandy beach only round an island.
    setGroundBeach(material, terrain.island ? groundLook.wet.beach.meters : 0);
    freeze(this.group);
    scene.add(this.group);
  }

  // Call each frame with the camera's position.
  update(camera: THREE.Vector3): void {
    if (camera.distanceToSquared(this.checkedAt) < this.look.lod.recheckMeters ** 2) return;
    this.checkedAt.copy(camera);
    for (const mesh of this.meshes) mesh.visible = false;
    selectTerrainNodes(this.root, this.terrain, camera.x, camera.y, camera.z, this.look.lod.fullDetailMeters, this.maxStride, this.show);
  }

  // Small maps are drawn at full detail everywhere: stride 1 only.
  private get maxStride(): number {
    return this.lod ? this.look.lod.maxStride : 1;
  }

  // The crest ink on or off, for F1's look features.
  setInk(on: boolean): void {
    for (const shell of this.inks) shell.visible = on;
  }

  // How many tiles are switched on, for tests and the performance notes.
  get drawnCount(): number {
    let n = 0;
    for (const mesh of this.meshes) if (mesh.visible) n++;
    return n;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.seabed?.geometry.dispose();
  }
}
