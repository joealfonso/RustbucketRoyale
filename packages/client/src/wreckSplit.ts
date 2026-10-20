import * as THREE from "three";

// A kit mech's arms are merged into one mesh per kind of material (mechMerge.ts), both arms and the gun together.
// To blow them off as separate pieces the merged geometry is cut by side: shapes left of the middle, near the middle
// (a turret, a chest-mounted gun), and right of it. Shapes are kept whole, as in legRig.ts: triangles that share a
// corner position are one shape, and the shape goes by the x of its middle. Done once per geometry and kept, since
// mechs of one kit share their geometry.

export const LEFT = 0;
export const MIDDLE = 1;
export const RIGHT = 2;

export function sideOf(x: number, middleMeters: number): number {
  return x < -middleMeters ? LEFT : x > middleMeters ? RIGHT : MIDDLE;
}

const cache = new WeakMap<THREE.BufferGeometry, { middleMeters: number; sides: (THREE.BufferGeometry | null)[] }>();

// The geometry's left, middle and right shapes, null for a side with none.
export function splitBySide(geometry: THREE.BufferGeometry, middleMeters: number): (THREE.BufferGeometry | null)[] {
  const found = cache.get(geometry);
  if (found && found.middleMeters === middleMeters) return found.sides;
  const sides = split(geometry, middleMeters);
  cache.set(geometry, { middleMeters, sides });
  return sides;
}

// Corner positions to the millimetre, packed into one exact integer key (a mech is far smaller than the ±65 m
// this allows), which is much quicker than a string key on a 10k triangle mesh.
const OFFSET = 65536, SPAN = 131072;
const keyOf = (x: number, y: number, z: number) =>
  Math.round(x * 1000) + OFFSET + (Math.round(y * 1000) + OFFSET) * SPAN + (Math.round(z * 1000) + OFFSET) * SPAN * SPAN;

function split(geometry: THREE.BufferGeometry, middleMeters: number): (THREE.BufferGeometry | null)[] {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.attributes.position!;
  const count = position.count;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const byPosition = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    if (i % 3 !== 0) join(i, i - (i % 3));
    const key = keyOf(position.getX(i), position.getY(i), position.getZ(i));
    const seen = byPosition.get(key);
    if (seen === undefined) byPosition.set(key, i);
    else join(i, seen);
  }
  // Each shape's middle x, then its side.
  const sumX = new Float64Array(count), corners = new Int32Array(count);
  for (let i = 0; i < count; i++) { const r = find(i); sumX[r] = sumX[r]! + position.getX(i); corners[r] = corners[r]! + 1; }
  const side = new Int8Array(count);
  for (let i = 0; i < count; i++) { const r = find(i); side[i] = sideOf(sumX[r]! / corners[r]!, middleMeters); }

  const out: (THREE.BufferGeometry | null)[] = [];
  for (let s = LEFT; s <= RIGHT; s++) {
    let n = 0;
    for (let i = 0; i < count; i += 3) if (side[i] === s) n += 3;
    if (n === 0) { out.push(null); continue; }
    const g = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(flat.attributes)) {
      const size = attribute.itemSize;
      const values = new Float32Array(n * size);
      let at = 0;
      for (let i = 0; i < count; i += 3) {
        if (side[i] !== s) continue;
        for (let c = i; c < i + 3; c++) {
          values[at++] = attribute.getX(c);
          if (size > 1) values[at++] = attribute.getY(c);
          if (size > 2) values[at++] = attribute.getZ(c);
          if (size > 3) values[at++] = attribute.getW(c);
        }
      }
      g.setAttribute(name, new THREE.BufferAttribute(values, size)); // getX gives plain numbers, so stored as floats
    }
    out.push(g);
  }
  return out;
}
