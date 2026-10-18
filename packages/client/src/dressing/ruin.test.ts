import { describe, expect, it } from "vitest";
import { checkBuilder, sampleBoxes } from "./builderChecks";
import { ruin } from "./ruin";

const sizes: [number, number, number][] = [[14, 5, 1], [1, 5, 12], [12, 6, 1], [1, 6, 12], [10, 3, 1], [1, 3.5, 8]];

describe("ruin", () => {
  it("keeps the dressing rules", () => {
    expect(checkBuilder(ruin, sampleBoxes(sizes))).toEqual([]);
  });

  it("has a ragged top that reaches the box top and never drops below 55% of the height", () => {
    for (const b of sampleBoxes(sizes)) {
      const ua = b.max[0] - b.min[0] >= b.max[2] - b.min[2] ? 0 : 2;
      const { positions, normals, indices } = ruin(b)[0]!.mesh; // the concrete
      // For points along the wall, the highest upward-facing concrete face above each (taking each face's lowest corner).
      const tops: number[] = [];
      for (let s = 1; s < 40; s++) {
        const u = b.min[ua]! + ((b.max[ua]! - b.min[ua]!) * s) / 40;
        let top = -Infinity;
        for (let t = 0; t < indices.length; t += 3) {
          const vs = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
          if (normals[vs[0]! * 3 + 1]! < 0.5) continue; // flat tops and the bevels round them
          const us = vs.map((v) => positions[v * 3 + ua]!);
          if (u < Math.min(...us) || u > Math.max(...us)) continue;
          top = Math.max(top, Math.min(...vs.map((v) => positions[v * 3 + 1]!)));
        }
        tops.push(top - b.min[1]);
      }
      const height = b.max[1] - b.min[1];
      expect(Math.max(...tops)).toBeCloseTo(height, 5);
      expect(Math.min(...tops)).toBeLessThan(height - 0.5);
      expect(Math.min(...tops)).toBeGreaterThan(height * 0.55);
    }
  });
});
