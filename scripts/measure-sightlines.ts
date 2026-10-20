// How open each tier's maps are: the share of open-ground spots 40 to 100 m and 100 to 250 m apart that can see each other at eye
// height (packages/shared/src/sightlines.ts). Run: npx tsx scripts/measure-sightlines.ts [seeds, default 6]
import { readFileSync } from "node:fs";
import { SIGHTLINES, generateMap, longSightShare, parseChunkSet, parseMechStats, parsePropConfig, parseTiers } from "../packages/shared/src";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const chunks = parseChunkSet(read("chunks.json"));
const tiers = parseTiers(read("tiers.json"));
const mech = parseMechStats(read("mech.json"));
const props = parsePropConfig(read("props.json"));
const seeds = Number(process.argv[2] ?? 6);

console.log("| Tier | Seeds | Seen at 40 to 100 m | Seen at 100 to 250 m (lowest to highest) | Boxes |\n| :- | :- | :- | :- | :- |");
for (const tier of ["small", "medium", "large"]) {
  const shares: number[] = [], near: number[] = [];
  let boxes = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const map = generateMap(seed, tier, chunks, tiers, mech, props);
    shares.push(longSightShare(map, seed));
    near.push(longSightShare(map, seed, { ...SIGHTLINES, minMeters: 40, maxMeters: 100 }));
    boxes += map.boxes.length;
  }
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const nearMean = near.reduce((a, b) => a + b, 0) / near.length;
  console.log(`| ${tier} | ${seeds} | ${pct(nearMean)} | ${pct(mean)} (${pct(Math.min(...shares))} to ${pct(Math.max(...shares))}) | ${Math.round(boxes / seeds)} |`);
}
