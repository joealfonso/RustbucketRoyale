import { describe, expect, it } from "vitest";
import { checkBuilder, sampleBoxes } from "./builderChecks";
import { scrap } from "./scrap";

const sizes: [number, number, number][] = [[5, 2, 4], [3, 3.2, 3], [6, 1.4, 3], [4, 2.6, 5], [4, 1.8, 4], [7, 2.2, 3], [2, 1.2, 2]];

describe("scrap", () => {
  it("keeps the rules for every real scrap size", () => {
    expect(checkBuilder(scrap, sampleBoxes(sizes, 8))).toEqual([]);
  });

  // The pile is cover: something must reach the top of the box, or shots would stop on thin air above it.
  it("reaches the full height of the box", () => {
    for (const box of sampleBoxes(sizes, 8)) {
      let top = -Infinity;
      for (const p of scrap(box)) for (let i = 1; i < p.mesh.positions.length; i += 3) top = Math.max(top, p.mesh.positions[i]!);
      expect(top).toBeGreaterThan(box.max[1] - 0.05);
    }
  });
});
