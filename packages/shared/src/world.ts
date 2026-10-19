import { Terrain } from "./terrain";

// The world a mech moves in: axis aligned boxes (cover, walls, buildings, props) standing on the terrain's hills.
export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface BoxData {
  name: string;
  center: [number, number, number];
  size: [number, number, number];
  color: string;
}

export function boxFromData(data: BoxData): Box {
  const [cx, cy, cz] = data.center;
  const [sx, sy, sz] = data.size;
  return {
    minX: cx - sx / 2, minY: cy - sy / 2, minZ: cz - sz / 2,
    maxX: cx + sx / 2, maxY: cy + sy / 2, maxZ: cz + sz / 2,
  };
}

export interface RayHit {
  distance: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  index: number; // which box in the list was hit
}

export function createRayHit(): RayHit {
  return { distance: 0, normalX: 0, normalY: 0, normalZ: 0, index: -1 };
}

// Slab test of one ray against one box. Returns the entry distance, or -1 for a miss. Direction must be unit length.
// The normal of the face that was entered goes into `normal` as [x, y, z].
function rayBox(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  maxDistance: number, b: Box, normal: number[],
): number {
  let tMin = 0;
  let tMax = maxDistance;
  let nx = 0, ny = 0, nz = 0;

  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = axis === 0 ? b.minX : axis === 1 ? b.minY : b.minZ;
    const hi = axis === 0 ? b.maxX : axis === 1 ? b.maxY : b.maxZ;

    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let sign = -1; // entering through the low face means the normal points back toward -axis
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; sign = 1; }
    if (t1 > tMin) {
      tMin = t1;
      nx = axis === 0 ? sign : 0;
      ny = axis === 1 ? sign : 0;
      nz = axis === 2 ? sign : 0;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }
  normal[0] = nx; normal[1] = ny; normal[2] = nz;
  return tMin;
}

const normalScratch = [0, 0, 0];

// RayHit.index for a ray that hit the ground rather than a box.
export const TERRAIN_HIT = -1;

// Ray against a plain list of boxes, keeping the nearest hit. Fine for a handful of boxes (a mech's hit zones);
// use World for the map. Writes into `out` so nothing is allocated.
export function raycastBoxes(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number, boxes: readonly Box[], out: RayHit,
): boolean {
  let best = maxDistance;
  let found = false;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, best, boxes[i]!, normalScratch);
    if (t >= 0 && t <= best) {
      best = t;
      found = true;
      out.distance = t;
      out.index = i;
      out.normalX = normalScratch[0]!; out.normalY = normalScratch[1]!; out.normalZ = normalScratch[2]!;
    }
  }
  return found;
}

// The map's collision boxes, sorted into a flat grid of cells so a query only looks at boxes near it.
// Without this every shot, grenade, camera ray and mech step would test every box on a 2000 m map.
export class World {
  readonly boxes: readonly Box[];
  private readonly cellSize: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellStart: Int32Array; // boxes of cell c are items[cellStart[c] .. cellStart[c + 1])
  private readonly items: Int32Array;
  private readonly seen: Int32Array;
  private readonly off: Uint8Array; // boxes switched off, like a prop that has been destroyed
  private stamp = 0;
  // The ground under everything. Flat at 0 when a world is made without one (tests, the style page).
  readonly terrain: Terrain | null;

  constructor(boxes: readonly Box[], cellSize = 16, terrain: Terrain | null = null) {
    this.boxes = boxes;
    this.terrain = terrain;
    this.cellSize = cellSize;

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
    }
    if (boxes.length === 0) { minX = minZ = 0; maxX = maxZ = cellSize; }
    this.originX = minX;
    this.originZ = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));

    // Two passes: count how many boxes land in each cell, then fill one flat array.
    const counts = new Int32Array(this.cols * this.rows + 1);
    const forEachCell = (b: Box, fn: (cell: number) => void) => {
      const x0 = this.cellX(b.minX), x1 = this.cellX(b.maxX), z0 = this.cellZ(b.minZ), z1 = this.cellZ(b.maxZ);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(z * this.cols + x);
    };
    for (const b of boxes) forEachCell(b, (c) => counts[c + 1]!++);
    for (let c = 0; c < this.cols * this.rows; c++) counts[c + 1]! += counts[c]!;
    this.cellStart = counts;
    this.items = new Int32Array(counts[this.cols * this.rows]!);
    const fill = counts.slice(0, this.cols * this.rows);
    boxes.forEach((b, i) => forEachCell(b, (c) => { this.items[fill[c]!++] = i; }));
    this.seen = new Int32Array(boxes.length);
    this.off = new Uint8Array(boxes.length);
  }

  // Takes a box out of the world: nothing collides with it or hits it any more.
  disable(index: number): void {
    this.off[index] = 1;
  }

  isDisabled(index: number): boolean {
    return this.off[index] === 1;
  }

  private cellX(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.originX) / this.cellSize)));
  }

  private cellZ(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.originZ) / this.cellSize)));
  }

  // Fills `out` with the indices of boxes whose footprint touches the given rectangle, each once,
  // and returns how many. The caller still checks height. `out` is reused, so nothing is allocated.
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number {
    this.stamp++;
    let count = 0;
    const x0 = this.cellX(minX), x1 = this.cellX(maxX), z0 = this.cellZ(minZ), z1 = this.cellZ(maxZ);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const cell = z * this.cols + x;
        for (let k = this.cellStart[cell]!; k < this.cellStart[cell + 1]!; k++) {
          const index = this.items[k]!;
          if (this.seen[index] === this.stamp || this.off[index]) continue;
          this.seen[index] = this.stamp;
          out[count++] = index;
        }
      }
    }
    return count;
  }

  // The ground height under (x, z): the terrain, or -Infinity with none (then the ground is whatever box is there).
  groundAt(x: number, z: number): number {
    return this.terrain ? this.terrain.heightAt(x, z) : -Infinity;
  }

  // Nearest box or hillside along a ray. A hillside hit has index TERRAIN_HIT.
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number, out: RayHit): boolean {
    const found = this.raycastBoxes(ox, oy, oz, dx, dy, dz, maxDistance, out);
    if (!this.terrain) return found;
    const t = this.terrain.raycast(ox, oy, oz, dx, dy, dz, found ? out.distance : maxDistance);
    if (t < 0 || (found && t >= out.distance)) return found;
    out.distance = t;
    out.index = TERRAIN_HIT;
    this.terrain.normalAt(ox + dx * t, oz + dz * t, normalScratch);
    out.normalX = normalScratch[0]!; out.normalY = normalScratch[1]!; out.normalZ = normalScratch[2]!;
    return true;
  }

  // Nearest box along a ray. Walks the grid cell by cell and stops as soon as a hit is nearer than the next cell.
  private raycastBoxes(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number, out: RayHit): boolean {
    this.stamp++;
    let best = maxDistance;
    let found = false;

    let x = this.cellX(ox), z = this.cellZ(oz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const nextX = this.originX + (x + (dx > 0 ? 1 : 0)) * this.cellSize;
    const nextZ = this.originZ + (z + (dz > 0 ? 1 : 0)) * this.cellSize;
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : (nextX - ox) / dx;
    let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : (nextZ - oz) / dz;
    const tDeltaX = Math.abs(dx) < 1e-9 ? Infinity : this.cellSize / Math.abs(dx);
    const tDeltaZ = Math.abs(dz) < 1e-9 ? Infinity : this.cellSize / Math.abs(dz);

    for (;;) {
      const cell = z * this.cols + x;
      for (let k = this.cellStart[cell]!; k < this.cellStart[cell + 1]!; k++) {
        const index = this.items[k]!;
        if (this.seen[index] === this.stamp || this.off[index]) continue;
        this.seen[index] = this.stamp;
        const t = rayBox(ox, oy, oz, dx, dy, dz, best, this.boxes[index]!, normalScratch);
        if (t >= 0 && t <= best) {
          best = t;
          found = true;
          out.distance = t;
          out.index = index;
          out.normalX = normalScratch[0]!; out.normalY = normalScratch[1]!; out.normalZ = normalScratch[2]!;
        }
      }

      // Leave this cell through the nearer wall. A hit already closer than that wall cannot be beaten.
      const tExit = Math.min(tMaxX, tMaxZ);
      if (best <= tExit || tExit > maxDistance) break;
      if (tMaxX < tMaxZ) {
        x += stepX; tMaxX += tDeltaX;
        if (x < 0 || x >= this.cols) break;
      } else {
        z += stepZ; tMaxZ += tDeltaZ;
        if (z < 0 || z >= this.rows) break;
      }
    }
    return found;
  }
}
