// Measures each one-file mech kit and writes its hit boxes into data/mechKits.json: one box round each part, in that
// part's hit zone (parts marked noHit, such as floating drones, are left out). The server and the client then check
// shots against the shape you actually see. Run after changing a mech model: npx tsx scripts/make-hitboxes.ts
// The extents come from the bounds every glTF model stores for its positions, plus the node's position. Rotated or
// scaled part nodes are not handled (the roster scripts never use them); the script stops if it meets one.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGltfJson } from "./assets/glbCheck";

interface Gltf {
  nodes?: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: { POSITION?: number } }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
}

const root = new URL("..", import.meta.url).pathname;
const kitsPath = join(root, "data/mechKits.json");
const kits = JSON.parse(readFileSync(kitsPath, "utf8"));
const round = (n: number) => Math.round(n * 100) / 100;

for (const [id, kit] of Object.entries(kits.kits) as [string, { file?: string; parts: Record<string, { zone: string; noHit?: boolean }>; hitboxes?: unknown }][]) {
  if (!kit.file) continue;
  const gltf = readGltfJson(readFileSync(join(root, "assets", kit.file))) as Gltf;
  const boxes: Record<string, { center: number[]; size: number[] }[]> = { legs: [], arms: [], torso: [] };
  for (const [name, part] of Object.entries(kit.parts)) {
    if (part.noHit) continue;
    const node = gltf.nodes?.find((n) => n.name === name);
    if (!node || node.mesh === undefined) throw new Error(`${id}: no mesh for part ${name}`);
    if (node.rotation || node.scale) throw new Error(`${id}: part ${name} is rotated or scaled, which this script does not handle`);
    const at = node.translation ?? [0, 0, 0];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of gltf.meshes![node.mesh]!.primitives) {
      const a = gltf.accessors![p.attributes.POSITION!]!;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, a.min![i]! + at[i]!); max[i] = Math.max(max[i]!, a.max![i]! + at[i]!); }
    }
    boxes[part.zone]!.push({ center: [0, 1, 2].map((i) => round((min[i]! + max[i]!) / 2)), size: [0, 1, 2].map((i) => round(max[i]! - min[i]!)) });
  }
  for (const zone of ["legs", "arms", "torso"]) if (boxes[zone]!.length === 0) throw new Error(`${id}: nothing to hit in the ${zone} zone`);
  kit.hitboxes = boxes;
  console.log(`${id}: ${boxes.legs!.length} leg, ${boxes.arms!.length} arm, ${boxes.torso!.length} torso boxes`);
}
writeFileSync(kitsPath, `${JSON.stringify(kits, null, 2)}\n`);
