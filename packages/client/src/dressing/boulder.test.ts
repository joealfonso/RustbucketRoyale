import { describe, expect, it } from "vitest";
import tiersJson from "../../../../data/tiers.json";
import { boulder } from "./boulder";
import { checkBuilder, sampleBoxes } from "./builderChecks";

// Boulders are cubes from minSizeMeters to maxSizeMeters (data/tiers.json rocks), a share of them sunk into the hill.
const rocks = (tiersJson.terrain as unknown as { rocks: { minSizeMeters: number; maxSizeMeters: number } }).rocks;
const sizes: [number, number, number][] = [rocks.minSizeMeters, 3, 3.7, rocks.maxSizeMeters].map((s) => [s, s, s]);

describe("boulder", () => {
  it("keeps the rules for every boulder size", () => {
    expect(checkBuilder(boulder, sampleBoxes(sizes, 6))).toEqual([]);
  });

  it("fills its box: reaches near every side and the top", () => {
    for (const box of sampleBoxes(sizes, 6)) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const { mesh } of boulder(box)) {
        for (let i = 0; i < mesh.positions.length; i++) { min[i % 3] = Math.min(min[i % 3]!, mesh.positions[i]!); max[i % 3] = Math.max(max[i % 3]!, mesh.positions[i]!); }
      }
      for (let a = 0; a < 3; a++) {
        const size = box.max[a]! - box.min[a]!;
        expect(min[a]! - box.min[a]!).toBeLessThan(size * 0.12);
        expect(box.max[a]! - max[a]!).toBeLessThan(size * 0.12);
      }
    }
  });

  it("varies from box to box", () => {
    const at = (seed: number) => JSON.stringify(boulder({ min: [0, 0, 0], max: [3, 3, 3], seed, color: "#746C5C" }));
    expect(new Set([1, 2, 3, 4, 5].map(at)).size).toBe(5);
  });
});
