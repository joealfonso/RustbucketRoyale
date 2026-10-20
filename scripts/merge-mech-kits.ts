// Copies each scripted kit's paint scheme, parts list and moving parts (pistons and sway, gate V9b) from its script's
// side file (scripts/mechs/<name>.kit.json, written alongside the model) into data/mechKits.json, keeping the file path, hit boxes, muzzles and serials.
// That is every roster mech and the Junk Titan (gate 13c), whose side file also names its thrown car (`car`).
// Run after rebuilding a mech, then scripts/make-hitboxes.ts. Run: npx tsx scripts/merge-mech-kits.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const kitsPath = join(root, "data/mechKits.json");
const kits = JSON.parse(readFileSync(kitsPath, "utf8"));
for (const id of [...(kits.roster as string[]), "titan"]) {
  const side = join(root, `scripts/mechs/${id}.kit.json`);
  if (!existsSync(side)) { console.log(`${id}: no ${id}.kit.json, left as it is`); continue; }
  const { scheme, parts, motion, car } = JSON.parse(readFileSync(side, "utf8"));
  const kit = kits.kits[id];
  kits.kits[id] = { file: kit.file, scheme, parts, ...(motion ? { motion } : {}), ...(car ? { car } : {}), ...(kit.hitboxes ? { hitboxes: kit.hitboxes } : {}), ...(kit.muzzles ? { muzzles: kit.muzzles } : {}), ...(kit.serials ? { serials: kit.serials } : {}) };
  console.log(`${id}: ${Object.keys(parts).length} parts, ${Object.keys(scheme).length} colours`);
}
writeFileSync(kitsPath, `${JSON.stringify(kits, null, 2)}\n`);
