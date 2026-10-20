import { describe, expect, it } from "vitest";
import chunksJson from "../../../data/chunks.json";
import tiersJson from "../../../data/tiers.json";
import propsJson from "../../../data/props.json";
import mechJson from "../../../data/mech.json";
import { generateMap, parseChunkSet, parseTiers } from "./generation";
import { parsePropConfig } from "./props";
import { SIGHTLINES, longSightShare } from "./sightlines";
import { parseMechStats } from "./stats";

// Joseph's playtest of 14a: the yard was "great for a sniper mech" with too little in the way. Gate 15a about halved
// how often spots can see each other (docs/PERF.md); these limits keep it from drifting back.
const stats = parseMechStats(mechJson);
const mech = { halfWidth: stats.halfWidth, height: stats.height, stepHeight: stats.stepHeight };
const build = (seed: number, tier: string) => generateMap(seed, tier, parseChunkSet(chunksJson), parseTiers(tiersJson), mech, parsePropConfig(propsJson));

describe("sightlines", () => {
  for (const [tier, nearLimit, farLimit] of [["small", 0.4, 0.17], ["medium", 0.35, 0.12]] as const) {
    it(`on ${tier} maps, something stands in the way of most fights`, () => {
      let near = 0, far = 0;
      for (const seed of [3, 4]) {
        const map = build(seed, tier);
        near += longSightShare(map, seed, { ...SIGHTLINES, pairs: 500, minMeters: 40, maxMeters: 100 }) / 2;
        far += longSightShare(map, seed, { ...SIGHTLINES, pairs: 500 }) / 2;
      }
      expect(near).toBeLessThan(nearLimit);
      expect(far).toBeLessThan(farLimit);
    });
  }
});
