import { describe, expect, it } from "vitest";
import { triangleCount } from "./builderChecks";
import type { DressBox } from "./kinds";
import { scatter } from "./scatter";

const chunk = { minX: 0, minZ: 0, size: 50, seed: 12345 };
const blockers: DressBox[] = [
  { min: [10, 0, 10], max: [22, 2.6, 12.5], seed: 0, color: "" }, // a container
  { min: [30, 0, 5], max: [31, 4, 45], seed: 0, color: "" }, // a long wall
];

describe("scatter", () => {
  it("gives the same pieces for the same inputs", () => {
    expect(JSON.stringify(scatter(chunk, blockers, 40))).toBe(JSON.stringify(scatter(chunk, blockers, 40)));
  });

  it("stays in the chunk, low, and clear of every box", () => {
    for (const seed of [1, 2, 3, 99, 12345, 4000000000]) {
      const pieces = scatter({ ...chunk, seed }, blockers, 60);
      expect(pieces.length).toBeGreaterThan(0);
      for (const { mesh } of pieces) {
        const p = mesh.positions;
        for (let i = 0; i < p.length; i += 3) {
          const [x, y, z] = [p[i]!, p[i + 1]!, p[i + 2]!];
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(50);
          expect(z).toBeGreaterThanOrEqual(0);
          expect(z).toBeLessThanOrEqual(50);
          expect(y).toBeLessThanOrEqual(0.9);
          for (const b of blockers) {
            const inside = x > b.min[0] - 0.4 && x < b.max[0] + 0.4 && z > b.min[2] - 0.4 && z < b.max[2] + 0.4;
            expect(inside).toBe(false);
          }
        }
      }
    }
  });

  it("stays cheap", () => {
    expect(triangleCount(scatter(chunk, blockers, 40))).toBeLessThan(3000);
  });
});
