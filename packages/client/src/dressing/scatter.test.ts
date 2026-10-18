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
    // Checked in plain loops and asserted once: an expect per vertex is slow enough to time out a busy test run.
    const problems: string[] = [];
    for (const seed of [1, 2, 3, 99, 12345, 4000000000]) {
      const pieces = scatter({ ...chunk, seed }, blockers, 60);
      if (pieces.length === 0) problems.push(`seed ${seed}: nothing scattered`);
      for (const { mesh } of pieces) {
        const p = mesh.positions;
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
          if (x < 0 || x > 50 || z < 0 || z > 50) problems.push(`seed ${seed}: outside the chunk at ${x}, ${z}`);
          if (y > 0.9) problems.push(`seed ${seed}: too tall at ${y}`);
          for (const b of blockers) {
            if (x > b.min[0] - 0.4 && x < b.max[0] + 0.4 && z > b.min[2] - 0.4 && z < b.max[2] + 0.4) problems.push(`seed ${seed}: inside a box at ${x}, ${z}`);
          }
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("stays cheap", () => {
    expect(triangleCount(scatter(chunk, blockers, 40))).toBeLessThan(3000);
  });
});
