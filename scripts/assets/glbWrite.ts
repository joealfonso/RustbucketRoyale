// Writes a small glTF binary (.glb) by hand: enough for box-built stand-in models, with no dependency.
// Every mesh uses one material, MasterToon, the only one the asset rules allow.

export interface MeshData {
  positions: number[]; // x, y, z per vertex
  normals: number[];
  indices: number[]; // three per triangle
}

export interface NodeData {
  name: string;
  translation?: [number, number, number];
  mesh?: MeshData;
}

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export function writeGlb(nodes: NodeData[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];

  // Adds raw bytes to the one buffer, four-byte aligned, and returns its buffer view index.
  const addView = (bytes: Uint8Array, target: number): number => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    chunks.push(bytes);
    byteLength += bytes.length;
    return bufferViews.length - 1;
  };

  const gltfNodes = nodes.map((n) => {
    const node: Record<string, unknown> = { name: n.name };
    if (n.translation) node.translation = n.translation;
    if (n.mesh) {
      const { positions, normals, indices } = n.mesh;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3]!, positions[i]!); max[i % 3] = Math.max(max[i % 3]!, positions[i]!); }
      const count = positions.length / 3;
      accessors.push({ bufferView: addView(new Uint8Array(new Float32Array(positions).buffer), ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3", min, max });
      const position = accessors.length - 1;
      accessors.push({ bufferView: addView(new Uint8Array(new Float32Array(normals).buffer), ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3" });
      const normal = accessors.length - 1;
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
