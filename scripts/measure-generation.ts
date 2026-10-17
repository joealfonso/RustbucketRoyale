// Times map generation per tier and prints a table for docs/PERF.md. Run: npx tsx scripts/measure-generation.ts
import { readFileSync } from "node:fs";
import { generateMap, parseChunkSet, parseMechStats, parsePropConfig, parseTiers } from "../packages/shared/src";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const chunks = parseChunkSet(read("chunks.json"));
const tiers = parseTiers(read("tiers.json"));
const mech = parseMechStats(read("mech.json"));
const propConfig = parsePropConfig(read("props.json"));

console.log("| Tier | Seeds | Median ms | Worst ms | Boxes | Nav cells | Retries |\n| :- | :- | :- | :- | :- | :- | :- |");
for (const tier of Object.keys(tiers.tiers)) {
  const times: number[] = [];
  let boxes = 0, retries = 0, cells = 0;
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (const seed of seeds) {
    const started = Date.now();
    const map = generateMap(seed, tier, chunks, tiers, mech, propConfig);
    times.push(Date.now() - started);
    boxes = Math.max(boxes, map.boxes.length);
    cells = map.nav.cols * map.nav.rows;
    retries += map.attempts - 1;
  }
  times.sort((a, b) => a - b);
  console.log(`| ${tier} | ${seeds.length} | ${times[Math.floor(times.length / 2)]} | ${times[times.length - 1]} | ${boxes} | ${cells} | ${retries} |`);
}
