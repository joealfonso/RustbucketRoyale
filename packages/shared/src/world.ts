// Axis aligned boxes are the whole world for now: ground, cover, walls, targets.
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

// Slab test against every box, keeping the nearest hit. Direction must be unit length.
// Writes into `out` so shots and camera checks allocate nothing each frame.
export function raycastBoxes(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number, boxes: readonly Box[], out: RayHit,
): boolean {
  let best = maxDistance;
  let found = false;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    let tMin = 0;
    let tMax = best;
    let nx = 0, ny = 0, nz = 0;
    let hit = true;

    for (let axis = 0; axis < 3; axis++) {
      const o = axis === 0 ? ox : axis === 1 ? oy : oz;
      const d = axis === 0 ? dx : axis === 1 ? dy : dz;
      const lo = axis === 0 ? b.minX : axis === 1 ? b.minY : b.minZ;
      const hi = axis === 0 ? b.maxX : axis === 1 ? b.maxY : b.maxZ;

      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { hit = false; break; }
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
      if (tMin > tMax) { hit = false; break; }
    }

    if (hit && tMin <= best) {
      best = tMin;
      found = true;
      out.distance = tMin;
      out.index = i;
      out.normalX = nx; out.normalY = ny; out.normalZ = nz;
    }
  }
  return found;
}
