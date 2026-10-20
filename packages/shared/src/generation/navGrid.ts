import type { Box } from "../world";
import type { Terrain } from "../terrain";

export interface NavParams {
  cellMeters: number;
  stepHeight: number;
  mechHeight: number;
}

// A coarse top-down picture of where a mech can walk. Each cell remembers the height of the highest
// thing a mech could stand on there; two neighbouring cells connect when the step between them is climbable.
// Stairs and terraced hills connect, walls and tall blocks do not, roofs a mech walks under are ignored.
// `ground` is the terrain under each cell. Bare hillside always connects to bare hillside, however steep the step
// between cells looks: the map caps slopes at walking steepness, so hills never block. Only boxes standing up off
// the ground make steps and walls.
// The server keeps this for the bots (M5); validation uses it now.
export interface NavGrid {
  cell: number;
  cols: number;
  rows: number;
  originX: number;
  originZ: number;
  stepHeight: number;
  top: Float32Array;
  ground: Float32Array;
}

// How far a cell's top stands up off the ground: 0 for bare hillside.
export const raised = (grid: NavGrid, i: number) => grid.top[i]! - grid.ground[i]!;

// `skip` marks boxes that are no wall to a route (tree trunks).
export function buildNavGrid(boxes: readonly Box[], meters: number, centerX: number, centerZ: number, params: NavParams, terrain: Terrain | null = null, skip: Uint8Array | null = null): NavGrid {
  const cols = Math.ceil(meters / params.cellMeters);
  const originX = centerX - meters / 2;
  const originZ = centerZ - meters / 2;
  const ground = new Float32Array(cols * cols);
  if (terrain) {
    for (let z = 0; z < cols; z++) for (let x = 0; x < cols; x++) {
      ground[z * cols + x] = terrain.heightAt(originX + (x + 0.5) * params.cellMeters, originZ + (z + 0.5) * params.cellMeters);
    }
  }
  const top = Float32Array.from(ground);

  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k]!;
    if (skip?.[k]) continue;
    // The ground slab under the world is no step.
    if (b.maxY <= 0 && !terrain) continue;
    const x0 = Math.max(0, Math.floor((b.minX - originX) / params.cellMeters));
    const x1 = Math.min(cols - 1, Math.floor((b.maxX - originX) / params.cellMeters - 1e-9));
    const z0 = Math.max(0, Math.floor((b.minZ - originZ) / params.cellMeters));
    const z1 = Math.min(cols - 1, Math.floor((b.maxZ - originZ) / params.cellMeters - 1e-9));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = z * cols + x;
        // Anything whose underside is above head height off the ground is a roof or an overhang, not something to
        // stand on or bump into; anything at or under the ground is buried.
        if (b.minY - ground[i]! >= params.mechHeight || b.maxY <= ground[i]! + 0.01) continue;
        if (b.maxY > top[i]!) top[i] = b.maxY;
      }
    }
  }
  return { cell: params.cellMeters, cols, rows: cols, originX, originZ, stepHeight: params.stepHeight, top, ground };
}

export function navCell(grid: NavGrid, x: number, z: number): number {
  const cx = Math.floor((x - grid.originX) / grid.cell);
  const cz = Math.floor((z - grid.originZ) / grid.cell);
  if (cx < 0 || cz < 0 || cx >= grid.cols || cz >= grid.rows) return -1;
  return cz * grid.cols + cx;
}

// Marks every cell reachable on foot from `start`. Returns how many cells were reached.
export function floodFill(grid: NavGrid, start: number, reached: Uint8Array): number {
  const queue = new Int32Array(grid.cols * grid.rows);
  let head = 0, tail = 0, count = 0;
  reached[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const c = queue[head++]!;
    count++;
    const x = c % grid.cols, z = (c - x) / grid.cols;
    const here = grid.top[c]!;
    const visit = (nx: number, nz: number) => {
      if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) return;
      const n = nz * grid.cols + nx;
      if (reached[n]) return;
      const hillside = raised(grid, n) <= 0 && raised(grid, c) <= 0;
      if (!hillside && Math.abs(grid.top[n]! - here) > grid.stepHeight) return;
      reached[n] = 1;
      queue[tail++] = n;
    };
    visit(x + 1, z); visit(x - 1, z); visit(x, z + 1); visit(x, z - 1);
  }
  return count;
}
