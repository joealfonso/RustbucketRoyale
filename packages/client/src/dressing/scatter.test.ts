import { describe, expect, it } from "vitest";
import { triangleCount } from "./builderChecks";
import type { DressBox } from "./kinds";
import dressingJson from "../../../../data/dressing.json";
import { parseScatterLook, scatter } from "./scatter";

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

  it("lies on the hills: every piece is set down on the ground under it, and stays low over it", () => {
    const groundAt = (x: number, z: number) => 0.4 * x - 0.25 * z + 3;
    const flat = scatter(chunk, blockers, 40);
    const draped = scatter({ ...chunk, groundAt }, blockers, 40);
    expect(draped.length).toBe(flat.length); // the same choices: only the heights move
    const problems: string[] = [];
    draped.forEach((piece, n) => {
      const p = piece.mesh.positions, q = flat[n]!.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i] !== q[i] || p[i + 2] !== q[i + 2]) problems.push(`piece ${n} moved sideways`);
        const above = p[i + 1]! - groundAt(p[i]!, p[i + 2]!);
        if (Math.abs(above - q[i + 1]!) > 1e-9) problems.push(`piece ${n}: ${above} over the hill, ${q[i + 1]} over flat ground`);
      }
    });
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("gathers junk in piles along the walls rather than spreading it evenly", () => {
    // Each piece's middle, measured to the nearest blocker's footprint.
    let near = 0, all = 0;
    for (const seed of [1, 2, 3, 99, 12345]) {
      for (const { mesh } of scatter({ ...chunk, seed }, blockers, 18)) {
        let x = 0, z = 0;
        const p = mesh.positions;
        for (let i = 0; i < p.length; i += 3) { x += p[i]!; z += p[i + 2]!; }
        x /= p.length / 3; z /= p.length / 3;
        const d = Math.min(...blockers.map((b) => Math.hypot(Math.max(b.min[0] - x, 0, x - b.max[0]), Math.max(b.min[2] - z, 0, z - b.max[2]))));
        all++;
        if (d < 4.5) near++;
      }
    }
    expect(all).toBeGreaterThan(0);
    expect(near / all).toBeGreaterThan(0.6);
  });

  it("rejects a pile mix with no weight", () => {
    const bad = structuredClone(dressingJson.scatter);
    for (const key of Object.keys(bad.mix)) bad.mix[key as keyof typeof bad.mix] = 0;
    expect(() => parseScatterLook(bad)).toThrow(/mix/);
  });

  it("stays cheap", () => {
    expect(triangleCount(scatter(chunk, blockers, 40))).toBeLessThan(3000);
  });
});
