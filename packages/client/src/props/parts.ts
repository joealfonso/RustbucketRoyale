import type { DressPiece } from "../dressing/kinds";
import { merge, turn, type MeshData, type V3 } from "../dressing/shapes";

// Shared bits for the prop models: the builder type, a collector that merges meshes into one piece per paint, and a
// nudge that keeps a seeded, tilted part inside the prop's box.

// A prop model in its own frame: centred on x and z, standing on y = 0, unrotated (the game turns it).
export type PropBuilder = (size: [number, number, number], seed: number) => { intact: DressPiece[]; destroyed: DressPiece[] };

export const lerp = (r: () => number, a: number, b: number) => a + (b - a) * r();

// Collects meshes by paint, in the order paints first appear, so the output is stable for a seed.
export function painter() {
  const byPaint = new Map<string, MeshData[]>();
  return {
    add(paint: string, ...meshes: MeshData[]) {
      const list = byPaint.get(paint) ?? [];
      list.push(...meshes);
      byPaint.set(paint, list);
    },
    pieces(): DressPiece[] {
      return [...byPaint].map(([paint, meshes]) => ({ paint, mesh: merge(...meshes) }));
    },
  };
}

// Moves a mesh by the least amount that puts it inside lo..hi (centring it on any axis it is too big for).
export function fit(m: MeshData, lo: V3, hi: V3): MeshData {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) { min[i % 3] = Math.min(min[i % 3]!, m.positions[i]!); max[i % 3] = Math.max(max[i % 3]!, m.positions[i]!); }
  const move = [0, 1, 2].map((a) => {
    if (max[a]! - min[a]! > hi[a]! - lo[a]!) return (lo[a]! + hi[a]!) / 2 - (min[a]! + max[a]!) / 2;
    return min[a]! < lo[a]! ? lo[a]! - min[a]! : max[a]! > hi[a]! ? hi[a]! - max[a]! : 0;
  }) as V3;
  return turn(m, [0, 0, 0], [0, 0, 0], move);
}

// Squashes a mesh in y about its lowest point, for crushed drums. Flat normals of a scaled solid are the old normals
// scaled by the inverse, so faces stay correct; a positive scale keeps the winding.
export function squashY(m: MeshData, factor: number): MeshData {
  let floor = Infinity;
  for (let i = 1; i < m.positions.length; i += 3) floor = Math.min(floor, m.positions[i]!);
  const positions = m.positions.map((v, i) => (i % 3 === 1 ? floor + (v - floor) * factor : v));
  const normals: number[] = [];
  for (let i = 0; i < m.normals.length; i += 3) {
    const n = [m.normals[i]!, m.normals[i + 1]! / factor, m.normals[i + 2]!];
    const l = Math.hypot(...n) || 1;
    normals.push(n[0]! / l, n[1]! / l, n[2]! / l);
  }
  return { positions, normals, indices: [...m.indices] };
}

// Moves a mesh up or down so its lowest point sits at `y`, for loose bits resting on the ground or on a base.
export function settle(m: MeshData, y: number): MeshData {
  let floor = Infinity;
  for (let i = 1; i < m.positions.length; i += 3) floor = Math.min(floor, m.positions[i]!);
  return turn(m, [0, 0, 0], [0, 0, 0], [0, y - floor, 0]);
}
