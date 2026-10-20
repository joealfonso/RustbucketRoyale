import * as THREE from "three";

// The outline is the mesh drawn again from the inside, pushed out along a direction per corner. Flat-shaded models
// give each face its own normals, so pushed along them the faces part at every edge and their corners stick out as
// dark shards. This adds `outlineNormal`: at each corner position, the average of every face normal that meets
// there, so the shell swells evenly and stays closed. Worked out once when a geometry is built, never per frame.
// `fromFaces` takes each corner's face normal from its triangles instead of the normal attribute, for models whose
// shading normals are bent over their chamfers (the roster mechs, scripts/assets/hardSurface.ts): on flat-shaded
// faces the two are the same, so their shells come out as they always did.
export function addOutlineNormals(geometry: THREE.BufferGeometry, fromFaces = false): THREE.BufferGeometry {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!position || !normal) return geometry;
  const faceNormals = fromFaces ? faceNormalsOf(geometry) : null;
  const nx = (i: number) => (faceNormals ? faceNormals[i * 3]! : normal.getX(i));
  const ny = (i: number) => (faceNormals ? faceNormals[i * 3 + 1]! : normal.getY(i));
  const nz = (i: number) => (faceNormals ? faceNormals[i * 3 + 2]! : normal.getZ(i));
  const sums = new Map<string, number[]>();
  const keys: string[] = new Array(position.count);
  for (let i = 0; i < position.count; i++) {
    // Corners closer than a millimetre are the same corner.
    const key = `${Math.round(position.getX(i) * 1000)},${Math.round(position.getY(i) * 1000)},${Math.round(position.getZ(i) * 1000)}`;
    keys[i] = key;
    const sum = sums.get(key) ?? [0, 0, 0];
    sum[0]! += nx(i); sum[1]! += ny(i); sum[2]! += nz(i);
    sums.set(key, sum);
  }
  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const s = sums.get(keys[i]!)!;
    const length = Math.hypot(s[0]!, s[1]!, s[2]!);
    // Faces that cancel out (a sheet seen from both sides) fall back to the face's own normal.
    if (length < 1e-6) out.set([nx(i), ny(i), nz(i)], i * 3);
    else out.set([s[0]! / length, s[1]! / length, s[2]! / length], i * 3);
  }
  geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(out, 3));
  return geometry;
}

// Each vertex's flat face normal: the unit sum of the triangles using it, which on a flat face is that face's normal.
// A vertex in no triangle with any area keeps its normal attribute.
function faceNormalsOf(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.attributes.position!;
  const normal = geometry.attributes.normal!;
  const index = geometry.index;
  const corners = index ? index.count : position.count;
  const sums = new Float32Array(position.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t + 2 < corners; t += 3) {
    const [i, j, k] = index ? [index.getX(t), index.getX(t + 1), index.getX(t + 2)] : [t, t + 1, t + 2];
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, j).sub(a);
    c.fromBufferAttribute(position, k).sub(a);
    const n = b.cross(c);
    const length = n.length();
    if (length === 0) continue;
    n.divideScalar(length);
    for (const v of [i, j, k]) { sums[v * 3]! += n.x; sums[v * 3 + 1]! += n.y; sums[v * 3 + 2]! += n.z; }
  }
  for (let v = 0; v < position.count; v++) {
    const length = Math.hypot(sums[v * 3]!, sums[v * 3 + 1]!, sums[v * 3 + 2]!);
    if (length < 1e-9) sums.set([normal.getX(v), normal.getY(v), normal.getZ(v)], v * 3);
    else for (let i = 0; i < 3; i++) sums[v * 3 + i]! /= length;
  }
  return sums;
}
