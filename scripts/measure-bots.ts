// How a match feels at each tier's bot count, over many seeds, to tune `fill` in data/bots.json by.
// Run: npx tsx scripts/measure-bots.ts [seeds per tier, default 8] [tier...]
// FILL=small:16 tries another count for a tier without editing the data file.
import { runSoak } from "../packages/server/src/soak/runSoak";

const args = process.argv.slice(2);
const seeds = Number(args[0] ?? 8);
const tiers = args.length > 1 ? args.slice(1) : ["arena", "small", "medium", "large"];
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
const fills = new Map((process.env.FILL ?? "").split(",").filter(Boolean).map((pair) => { const [t, n] = pair.split(":"); return [t!, Number(n)] as const; }));

console.log("| Tier | Fill | Seeds | Match s (median) | Knockouts a minute | Alone, share of living time | First contact s (median) |\n| :- | :- | :- | :- | :- | :- | :- |");
for (const tier of tiers) {
  const fill = fills.get(tier);
  const runs = Array.from({ length: seeds }, (_, i) => runSoak(tier, 1000 + i, { fill }));
  const failed = runs.filter((r) => r.problems.length > 0).length;
  const row = [
    tier, fill ?? "data", seeds,
    median(runs.map((r) => r.matchSeconds)).toFixed(0),
    median(runs.map((r) => r.knockoutsPerMinute)).toFixed(1),
    `${(median(runs.map((r) => r.aloneFraction)) * 100).toFixed(0)}%`,
    median(runs.map((r) => r.firstContactSeconds)).toFixed(0),
  ];
  console.log(`| ${row.join(" | ")} |${failed ? ` ${failed} runs broke a budget: ${runs.flatMap((r) => r.problems).slice(0, 2).join("; ")}` : ""}`);
}
