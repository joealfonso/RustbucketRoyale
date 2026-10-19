import * as THREE from "three";
import type { DressPiece } from "../dressing/kinds";
import { box, type V3 } from "../dressing/shapes";

// The far stand-in for a prop model: one plain box round the whole standing model, in the paint that is seen most
// from outside it. Past the far-box distance a prop is a few pixels tall, so its outline and main colour are all that
// still read; the model's hundred and more triangles there were most of a view across a large map (docs/PERF.md).
export function standIn(intact: DressPiece[]): DressPiece {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const { mesh } of intact) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, p[i]!);
      max[i % 3] = Math.max(max[i % 3]!, p[i]!);
    }
  }
  const centre: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { paint: seenMost(intact, min, max), mesh: box(centre, [max[0] - min[0], max[1] - min[1], max[2] - min[2]]) };
}

const RAYS = 8; // per side of each face of the box, so 64 a face
const ray = new THREE.Ray();
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();

// Which paint covers most of the model as seen from its four sides and from above (never from below), found by
// shooting a grid of rays in at each face of its box. Counting surface area instead picked the crate's dark core,
// which hides behind its planks.
function seenMost(pieces: DressPiece[], min: V3, max: V3): string {
  const seen = new Map<string, number>();
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  // Each face: the axis it looks along, which end of that axis it sits on, and the two axes across it.
  const faces: [number, 0 | 1, number, number][] = [[0, 0, 1, 2], [0, 1, 1, 2], [2, 0, 0, 1], [2, 1, 0, 1], [1, 1, 0, 2]];
  for (const [axis, end, u, v] of faces) {
    const weight = (size[u]! * size[v]!) / (RAYS * RAYS);
    for (let i = 0; i < RAYS; i++) for (let j = 0; j < RAYS; j++) {
      const from = [0, 0, 0];
      from[axis] = end ? max[axis]! + 1 : min[axis]! - 1;
      from[u] = min[u]! + ((i + 0.5) / RAYS) * size[u]!;
      from[v] = min[v]! + ((j + 0.5) / RAYS) * size[v]!;
      const towards = [0, 0, 0];
      towards[axis] = end ? -1 : 1;
      ray.origin.fromArray(from);
      ray.direction.fromArray(towards);
      const paint = firstHit(pieces);
      if (paint) seen.set(paint, (seen.get(paint) ?? 0) + weight);
    }
  }
  let best = pieces[0]!.paint;
  for (const [paint, area] of seen) if (area > (seen.get(best) ?? 0)) best = paint;
  return best;
}

function firstHit(pieces: DressPiece[]): string | null {
  let nearest = Infinity, paint: string | null = null;
  for (const piece of pieces) {
    const { positions: p, indices: n } = piece.mesh;
    for (let t = 0; t < n.length; t += 3) {
      a.fromArray(p, n[t]! * 3);
      b.fromArray(p, n[t + 1]! * 3);
      c.fromArray(p, n[t + 2]! * 3);
      if (!ray.intersectTriangle(a, b, c, true, hit)) continue;
      const d = hit.distanceToSquared(ray.origin);
      if (d < nearest) { nearest = d; paint = piece.paint; }
    }
  }
  return paint;
}
