import * as THREE from "three";

// The outline is the mesh drawn again from the inside, pushed out along a direction per corner. Flat-shaded models
// give each face its own normals, so pushed along them the faces part at every edge and their corners stick out as
// dark shards. This adds `outlineNormal`: at each corner position, the average of every face normal that meets
// there, so the shell swells evenly and stays closed. Worked out once when a geometry is built, never per frame.
export function addOutlineNormals(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!position || !normal) return geometry;
  const sums = new Map<string, number[]>();
  const keys: string[] = new Array(position.count);
  for (let i = 0; i < position.count; i++) {
    // Corners closer than a millimetre are the same corner.
    const key = `${Math.round(position.getX(i) * 1000)},${Math.round(position.getY(i) * 1000)},${Math.round(position.getZ(i) * 1000)}`;
    keys[i] = key;
    const sum = sums.get(key) ?? [0, 0, 0];
    sum[0]! += normal.getX(i); sum[1]! += normal.getY(i); sum[2]! += normal.getZ(i);
    sums.set(key, sum);
  }
  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const s = sums.get(keys[i]!)!;
    const length = Math.hypot(s[0]!, s[1]!, s[2]!);
    // Faces that cancel out (a sheet seen from both sides) fall back to the face's own normal.
    if (length < 1e-6) out.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
    else out.set([s[0]! / length, s[1]! / length, s[2]! / length], i * 3);
  }
  geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(out, 3));
  return geometry;
}
