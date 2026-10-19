// Measures each one-file mech kit and writes its hit boxes into data/mechKits.json: one box round each part, in that
// part's hit zone (parts marked noHit, such as floating drones, are left out). The server and the client then check
// shots against the shape you actually see. It also copies the gun muzzles (Mount_Gun, Mount_Gun_2, ...), which
// shots leave from in turn. Run after changing a mech model: npx tsx scripts/make-hitboxes.ts
// The extents come from the bounds every glTF model stores for its positions, scaled and moved by the node. A
// quantised model (KHR_mesh_quantization) stores bounds as integers, made metres by the node's one scale for all
// three axes. Rotated or unevenly scaled part nodes are not handled (the roster scripts never make them); the script
// stops if it meets one.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGltfJson } from "./assets/glbCheck";

interface Gltf {
  nodes?: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: { POSITION?: number } }[] }[];
  accessors?: { min?: number[]; max?: number[]; componentType?: number; normalized?: boolean }[];
}

const root = new URL("..", import.meta.url).pathname;
const kitsPath = join(root, "data/mechKits.json");
const kits = JSON.parse(readFileSync(kitsPath, "utf8"));
const round = (n: number) => Math.round(n * 100) / 100;
// What a normalized integer accessor divides by, by component type: signed byte, unsigned byte, signed and unsigned short.
const NORMALIZED_MAX: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

for (const [id, kit] of Object.entries(kits.kits) as [string, { file?: string; parts: Record<string, { zone: string; noHit?: boolean }>; hitboxes?: unknown; muzzles?: number[][] }][]) {
  if (!kit.file) continue;
  const gltf = readGltfJson(readFileSync(join(root, "assets", kit.file))) as Gltf;
  const boxes: Record<string, { center: number[]; size: number[] }[]> = { legs: [], arms: [], torso: [] };
  for (const [name, part] of Object.entries(kit.parts)) {
    if (part.noHit) continue;
    const node = gltf.nodes?.find((n) => n.name === name);
    if (!node || node.mesh === undefined) throw new Error(`${id}: no mesh for part ${name}`);
    const scale = node.scale ?? [1, 1, 1];
    if (node.rotation || scale[0]! <= 0 || scale.some((s) => s !== scale[0])) throw new Error(`${id}: part ${name} is rotated or unevenly scaled, which this script does not handle`);
    const at = node.translation ?? [0, 0, 0];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of gltf.meshes![node.mesh]!.primitives) {
      const a = gltf.accessors![p.attributes.POSITION!]!;
      const s = scale[0]! * (a.normalized ? 1 / NORMALIZED_MAX[a.componentType!]! : 1);
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, a.min![i]! * s + at[i]!); max[i] = Math.max(max[i]!, a.max![i]! * s + at[i]!); }
    }
    boxes[part.zone]!.push({ center: [0, 1, 2].map((i) => round((min[i]! + max[i]!) / 2)), size: [0, 1, 2].map((i) => round(max[i]! - min[i]!)) });
  }
  for (const zone of ["legs", "arms", "torso"]) if (boxes[zone]!.length === 0) throw new Error(`${id}: nothing to hit in the ${zone} zone`);
  kit.hitboxes = boxes;
  const muzzles = (gltf.nodes ?? []).filter((n) => /^Mount_Gun(_\d+)?$/.test(n.name ?? "")).sort((a, b) => (a.name! < b.name! ? -1 : 1)).map((n) => (n.translation ?? [0, 0, 0]).map(round));
  if (muzzles.length > 0) kit.muzzles = muzzles;
  console.log(`${id}: ${boxes.legs!.length} leg, ${boxes.arms!.length} arm, ${boxes.torso!.length} torso boxes, ${muzzles.length} muzzles`);
}
writeFileSync(kitsPath, `${JSON.stringify(kits, null, 2)}\n`);
