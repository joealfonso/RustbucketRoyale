import type { Box, Terrain } from "@rustbucket/shared";

// What stands in the water this frame, for the foam drawn round it (gate V16b, waterMesh.ts): wading mechs, and map
// boxes (walls, wrecks, props) that cross the surface. The shader gets at most `max` shapes, each four numbers in a
// uniform array: an axis-aligned box as (centre x, centre z, half width x, half width z), or a circle as
// (centre x, centre z, -radius, 0). Mechs come first, then the boxes nearest the camera. Everything is preallocated,
// so a frame allocates nothing.

export class WaterWakes {
  readonly shapes: Float32Array; // the uniform's values, `max` shapes of four
  count = 0; // shapes in use this frame
  private still = new Float32Array(0); // boxes crossing the surface on this map, four numbers each
  private stillCount = 0;
  private taken = new Uint8Array(0);

  constructor(readonly max: number, private nearMeters: number) {
    this.shapes = new Float32Array(max * 4);
  }

  // The map's boxes that stand in the water: they reach above and below its surface, over ground that is under it
  // at their middle or a corner. Called once per map.
  setStill(boxes: readonly Box[], terrain: Terrain | null): void {
    this.stillCount = 0;
    const level = terrain?.waterLevel ?? NaN;
    if (!terrain || !Number.isFinite(level)) return;
    const found: number[] = [];
    for (const b of boxes) {
      if (!(b.minY < level && b.maxY > level)) continue;
      const wet = terrain.waterDepthAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) > 0
        || terrain.waterDepthAt(b.minX, b.minZ) > 0 || terrain.waterDepthAt(b.maxX, b.minZ) > 0
        || terrain.waterDepthAt(b.minX, b.maxZ) > 0 || terrain.waterDepthAt(b.maxX, b.maxZ) > 0;
      if (wet) found.push((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2);
    }
    this.still = Float32Array.from(found);
    this.stillCount = found.length / 4;
    this.taken = new Uint8Array(this.stillCount);
  }

  // Starts a frame's list.
  begin(): void {
    this.count = 0;
  }

  // Something round wading at (x, z), such as a mech's legs. Ignored once the list is full.
  addCircle(x: number, z: number, radius: number): void {
    if (this.count >= this.max) return;
    const k = this.count++ * 4;
    this.shapes[k] = x; this.shapes[k + 1] = z; this.shapes[k + 2] = -radius; this.shapes[k + 3] = 0;
  }

  // Fills the free places with the still boxes nearest to the camera, within `nearMeters` (past that the foam is
  // too small to see, and the shader skips it anyway). Shapes after `count` are left as they were and never read.
  finish(cameraX: number, cameraZ: number): void {
    this.taken.fill(0);
    const near2 = this.nearMeters * this.nearMeters;
    while (this.count < this.max) {
      let best = -1, bestD = near2;
      for (let i = 0; i < this.stillCount; i++) {
        if (this.taken[i]) continue;
        const k = i * 4;
        // Distance to the box's edge, not its middle, so a long wall beside you is near.
        const dx = Math.max(Math.abs(cameraX - this.still[k]!) - this.still[k + 2]!, 0);
        const dz = Math.max(Math.abs(cameraZ - this.still[k + 1]!) - this.still[k + 3]!, 0);
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return;
      this.taken[best] = 1;
      const from = best * 4, to = this.count++ * 4;
      for (let j = 0; j < 4; j++) this.shapes[to + j] = this.still[from + j]!;
    }
  }
}

// The distance from (x, z) to a shape's edge, negative inside: the same sum as the shader, for tests. Box corners are
// rounded by up to `cornerMeters`, so the foam bends round them instead of making a sharp point.
export function wakeDistance(shapes: Float32Array, k: number, x: number, z: number, cornerMeters: number): number {
  const cx = shapes[k * 4]!, cz = shapes[k * 4 + 1]!, hx = shapes[k * 4 + 2]!, hz = shapes[k * 4 + 3]!;
  if (hx < 0) return Math.hypot(x - cx, z - cz) + hx;
  const r = Math.min(hx, hz, cornerMeters);
  const ex = Math.abs(x - cx) - (hx - r), ez = Math.abs(z - cz) - (hz - r);
  return Math.hypot(Math.max(ex, 0), Math.max(ez, 0)) + Math.min(Math.max(ex, ez), 0) - r;
}
