import { describe, expect, it } from "vitest";
import { checkBuilder, sampleBoxes, triangleCount } from "./builderChecks";
import { sheet } from "./sheet";

describe("sheet", () => {
  it("keeps the builder rules for every real wall size", () => {
    const sizes: [number, number, number][] = [
      [16, 4, 1.5], [14, 4, 1.5], [16, 4, 1], [6, 4, 1], [1, 4, 16],
      [34, 7, 1], [10, 7, 1], [1, 7, 26], [1, 7, 9], [1, 7, 12],
      [34, 0.6, 26], [1.5, 7, 1.5], [3, 1.5, 3], [2, 1.2, 2], // a warehouse's roof, columns and crates
    ];
    expect(checkBuilder(sheet, sampleBoxes(sizes))).toEqual([]);
  });

  it("dresses a warehouse roof with its folds' crests at the box top, where mechs stand, and steel under it", () => {
    for (const b of sampleBoxes([[34, 0.6, 26]], 4)) {
      const pieces = sheet(b);
      const ys = pieces.flatMap((p) => p.mesh.positions.filter((_, i) => i % 3 === 1));
      expect(Math.max(...ys)).toBeCloseTo(b.max[1], 6);
      expect(Math.min(...ys)).toBeCloseTo(b.min[1], 6);
      expect(pieces.some((p) => p.paint === "soot")).toBe(true);
    }
  });

  it("dresses a column as concrete and a crate as solid to its box's corners", () => {
    for (const size of [[1.5, 7, 1.5], [3, 1.5, 3], [2, 1.2, 2]] as [number, number, number][]) {
      for (const b of sampleBoxes([size], 4)) {
        const ps = sheet(b).flatMap((p) => p.mesh.positions);
        for (const a of [0, 1, 2]) {
          const v = ps.filter((_, i) => i % 3 === a);
          expect(Math.min(...v)).toBeLessThan(b.min[a]! + 0.02);
          expect(Math.max(...v)).toBeGreaterThan(b.max[a]! - 0.02);
        }
      }
    }
    expect(sheet(sampleBoxes([[1.5, 7, 1.5]], 1)[0]!).some((p) => p.surface === "concrete")).toBe(true);
  });

  it("gives a longer wall more ribs and posts", () => {
    const [long] = sampleBoxes([[34, 7, 1]], 1);
    const [short] = sampleBoxes([[10, 7, 1]], 1);
    expect(triangleCount(sheet(long!))).toBeGreaterThan(triangleCount(sheet(short!)));
  });
});
