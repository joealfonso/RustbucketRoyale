// Reads a glTF model (.glb or .gltf) far enough to check it against the asset rules in DESIGN.md: its name, its
// triangle count, and that it only uses the master toon material. No dependency: a .glb is a 12 byte header and a
// JSON chunk, and the JSON is all these checks need.

export interface AssetRules {
  modelsDir: string;
  material: string;
  kinds: Record<string, { maxTriangles: number; minTriangles?: number; states: string[] }>;
}

export interface GltfJson {
  meshes?: { name?: string; primitives: { indices?: number; attributes: { POSITION?: number }; material?: number; mode?: number }[] }[];
  accessors?: { count: number }[];
  materials?: { name?: string }[];
}

export interface CheckResult {
  problems: string[];
  warnings: string[];
  triangles: number;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const TRIANGLES = 4;

export function readGltfJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    const length = view.getUint32(12, true);
    if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error("the first chunk is not JSON");
    return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as GltfJson;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as GltfJson; // a plain .gltf
}

export function countTriangles(gltf: GltfJson): number {
  let total = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const p of mesh.primitives) {
      if ((p.mode ?? TRIANGLES) !== TRIANGLES) continue;
      const accessor = p.indices !== undefined ? gltf.accessors?.[p.indices] : p.attributes.POSITION !== undefined ? gltf.accessors?.[p.attributes.POSITION] : undefined;
      total += Math.floor((accessor?.count ?? 0) / 3);
    }
  }
  return total;
}

// `name` is the file name without its extension, such as Mech_Leg_L_Intact or Prop_Barrel_Destroyed.
export function checkModel(name: string, gltf: GltfJson, rules: AssetRules): CheckResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const parts = name.split("_");
  const kind = rules.kinds[parts[0]!];
  if (!kind) problems.push(`name must start with one of ${Object.keys(rules.kinds).join(", ")} and an underscore`);
  if (!parts.slice(1).every((p) => /^[A-Z][A-Za-z0-9]*$/.test(p)) || parts.length < 2) problems.push("each part of the name must start with a capital letter, joined by underscores");
  if (kind && kind.states.length > 0 && !kind.states.includes(parts.at(-1)!)) problems.push(`name must end with its state: ${kind.states.join(", ")}`);

  const triangles = countTriangles(gltf);
  if (kind && triangles > kind.maxTriangles) problems.push(`${triangles} triangles, over the ${kind.maxTriangles} budget`);
  if (kind?.minTriangles !== undefined && triangles < kind.minTriangles) warnings.push(`${triangles} triangles, under the usual ${kind.minTriangles}`);

  for (const m of gltf.materials ?? []) if (m.name !== rules.material) problems.push(`uses material "${m.name ?? "unnamed"}"; only ${rules.material} is allowed`);
  return { problems, warnings, triangles };
}
