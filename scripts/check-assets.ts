// The asset import checker (V1): every model under assets/models must follow the rules in DESIGN.md's intake
// checklist that a machine can check: naming, triangle budget, and only the master toon material. Run by the gauntlet.
// Run: npx tsx scripts/check-assets.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { checkModel, readGltfJson, type AssetRules } from "./assets/glbCheck";

const root = new URL("..", import.meta.url).pathname;
const rules = JSON.parse(readFileSync(join(root, "data/assetRules.json"), "utf8")) as AssetRules;

function models(dir: string): string[] {
  let found: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return found; }
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found = found.concat(models(path));
    else if ([".glb", ".gltf"].includes(extname(name).toLowerCase())) found.push(path);
  }
  return found;
}

const files = models(join(root, rules.modelsDir));
let failed = false;
for (const file of files) {
  const name = basename(file, extname(file));
  let result;
  try {
    result = checkModel(name, readGltfJson(readFileSync(file)), rules);
  } catch (e) {
    console.log(`FAIL ${file}: cannot be read (${(e as Error).message})`);
    failed = true;
    continue;
  }
  for (const w of result.warnings) console.log(`note ${name}: ${w}`);
  if (result.problems.length > 0) {
    failed = true;
    for (const p of result.problems) console.log(`FAIL ${name}: ${p}`);
  }
}
console.log(files.length === 0 ? `No models in ${rules.modelsDir} yet.` : `${files.length} models checked.`);
process.exit(failed ? 1 : 0);
