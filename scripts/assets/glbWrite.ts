// Writes a small glTF binary (.glb) by hand: enough for box-built stand-in models, with no dependency.
// Every mesh uses one material, MasterToon, the only one the asset rules allow.
// With `quantize` (the roster mechs), meshes are stored small with KHR_mesh_quantization, which three's GLTFLoader
// reads with no decoder: positions as 16-bit integers, normals as 8-bit, about half the bytes of 32-bit floats.

import type { MeshData } from "../../packages/client/src/dressing/shapes";
export type { MeshData };

export interface NodeData {
  name: string;
  translation?: [number, number, number];
  mesh?: MeshData;
}

const FLOAT = 5126;
const BYTE = 5120;
const SHORT = 5122;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export interface GlbOptions {
  quantize?: boolean;
}

// A mesh's positions as normalized 16-bit integers, -1 to 1 across its largest side, with the offset and the scale
// that turn them back into metres; the writer puts those on the mesh's node, which is how glTF dequantises. One
// scale for all three axes, so normals need no correction. 8-bit positions were measured too: on the roster almost
// no part is small enough to stay under a millimetre of error, so they are not used.
export function quantizePositions(positions: number[]): { values: Int16Array; offset: [number, number, number]; scale: number } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3]!, positions[i]!); max[i % 3] = Math.max(max[i % 3]!, positions[i]!); }
  // Centred and scaled exactly (never zero), so the ends of the longest side come back as they were made.
  const offset = [0, 1, 2].map((i) => (min[i]! + max[i]!) / 2) as [number, number, number];
  const scale = Math.max(1e-6, ...[0, 1, 2].map((i) => (max[i]! - min[i]!) / 2));
  // Four shorts per vertex: glTF wants every vertex's attribute four-byte aligned, so the fourth is padding.
  const values = new Int16Array((positions.length / 3) * 4);
  for (let v = 0; v < positions.length / 3; v++) {
    for (let i = 0; i < 3; i++) values[v * 4 + i] = Math.round(((positions[v * 3 + i]! - offset[i]!) / scale) * 32767);
  }
  return { values, offset, scale };
}

// Unit normals as normalized 8-bit integers, four bytes per vertex (the fourth is padding, as above).
function quantizeNormals(normals: number[]): Int8Array {
  const values = new Int8Array((normals.length / 3) * 4);
  for (let v = 0; v < normals.length / 3; v++) for (let i = 0; i < 3; i++) values[v * 4 + i] = Math.round(normals[v * 3 + i]! * 127);
  return values;
}

export function writeGlb(nodes: NodeData[], options: GlbOptions = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];

  // Adds raw bytes to the one buffer, four-byte aligned, and returns its buffer view index.
  const addView = (bytes: Uint8Array, target: number, byteStride?: number): number => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target, ...(byteStride ? { byteStride } : {}) });
    chunks.push(bytes);
    byteLength += bytes.length;
    return bufferViews.length - 1;
  };

  const gltfNodes = nodes.map((n) => {
    const node: Record<string, unknown> = { name: n.name };
    if (n.translation) node.translation = n.translation;
    if (n.mesh) {
      const { positions, normals, indices } = n.mesh;
      const count = positions.length / 3;
      if (options.quantize) {
        const q = quantizePositions(positions);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < q.values.length; i++) if (i % 4 < 3) { min[i % 4] = Math.min(min[i % 4]!, q.values[i]!); max[i % 4] = Math.max(max[i % 4]!, q.values[i]!); }
        // Bounds of a normalized accessor are its stored integers (three's loader scales them itself).
        accessors.push({ bufferView: addView(new Uint8Array(q.values.buffer), ARRAY_BUFFER, 8), componentType: SHORT, normalized: true, count, type: "VEC3", min, max });
        accessors.push({ bufferView: addView(new Uint8Array(quantizeNormals(normals).buffer), ARRAY_BUFFER, 4), componentType: BYTE, normalized: true, count, type: "VEC3" });
        const at = n.translation ?? [0, 0, 0];
        node.translation = [0, 1, 2].map((i) => at[i]! + q.offset[i]!);
        node.scale = [q.scale, q.scale, q.scale];
      } else {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3]!, positions[i]!); max[i % 3] = Math.max(max[i % 3]!, positions[i]!); }
        accessors.push({ bufferView: addView(new Uint8Array(new Float32Array(positions).buffer), ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3", min, max });
        accessors.push({ bufferView: addView(new Uint8Array(new Float32Array(normals).buffer), ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3" });
      }
      const position = accessors.length - 2, normal = accessors.length - 1;
      accessors.push({ bufferView: addView(new Uint8Array(new Uint16Array(indices).buffer), ELEMENT_ARRAY_BUFFER), componentType: UNSIGNED_SHORT, count: indices.length, type: "SCALAR" });
      meshes.push({ name: n.name, primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices: accessors.length - 1, material: 0 }] });
      node.mesh = meshes.length - 1;
    }
    return node;
  });

  const bin = new Uint8Array(byteLength + ((4 - (byteLength % 4)) % 4));
  let offset = 0;
  for (const c of chunks) { bin.set(c, offset); offset += c.length; }

  const json = {
    asset: { version: "2.0", generator: "rustbucket stand-in" },
    ...(options.quantize ? { extensionsUsed: ["KHR_mesh_quantization"], extensionsRequired: ["KHR_mesh_quantization"] } : {}),
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes,
    meshes,
    materials: [{ name: "MasterToon" }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += " ";
  const jsonBytes = new TextEncoder().encode(text);

  const out = new Uint8Array(12 + 8 + jsonBytes.length + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
  v.setUint32(12, jsonBytes.length, true); v.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  v.setUint32(binStart, bin.length, true); v.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out;
}

// A box from `min` to `max`, each face split into `segments` × `segments` squares, flat normals.
export function boxMesh(min: [number, number, number], max: [number, number, number], segments = 1, into: MeshData = { positions: [], normals: [], indices: [] }): MeshData {
  const faces: { n: [number, number, number]; u: number; v: number; w: number; at: number }[] = [
    { n: [1, 0, 0], u: 2, v: 1, w: 0, at: max[0] }, { n: [-1, 0, 0], u: 2, v: 1, w: 0, at: min[0] },
    { n: [0, 1, 0], u: 0, v: 2, w: 1, at: max[1] }, { n: [0, -1, 0], u: 0, v: 2, w: 1, at: min[1] },
    { n: [0, 0, 1], u: 0, v: 1, w: 2, at: max[2] }, { n: [0, 0, -1], u: 0, v: 1, w: 2, at: min[2] },
  ];
  for (const f of faces) {
    const base = into.positions.length / 3;
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++) {
        const p = [0, 0, 0];
        p[f.w] = f.at;
        p[f.u] = min[f.u]! + ((max[f.u]! - min[f.u]!) * i) / segments;
        p[f.v] = min[f.v]! + ((max[f.v]! - min[f.v]!) * j) / segments;
        into.positions.push(...p);
        into.normals.push(...f.n);
      }
    }
    // Wind each square so its front faces along the normal: (a, b, d) turns from the u axis to the v axis, which
    // faces along +w when (u, v, w) is an even permutation of (x, y, z).
    const even = (f.u + 1) % 3 === f.v;
    const flip = even === (f.n[f.w]! > 0);
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = base + j * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
        if (flip) into.indices.push(a, b, d, a, d, c);
        else into.indices.push(a, d, b, a, c, d);
      }
    }
  }
  return into;
}
