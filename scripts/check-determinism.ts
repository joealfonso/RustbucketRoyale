// Fails if map generation code calls anything unseeded or time based. Run by the gauntlet.
import { readdirSync, readFileSync } from "node:fs";
import { findViolations } from "../packages/shared/src/determinism/check";

const dir = new URL("../packages/shared/src/generation/", import.meta.url);
let bad = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
  for (const v of findViolations(readFileSync(new URL(name, dir), "utf8"))) {
    console.error(`generation/${name}:${v.line}: ${v.reason}\n    ${v.text}`);
    bad++;
  }
}
if (bad > 0) process.exit(1);
console.log("generation code is deterministic");
