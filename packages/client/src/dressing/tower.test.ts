import { describe, expect, it } from "vitest";
import { checkBuilder, sampleBoxes, triangleCount } from "./builderChecks";
import { tower } from "./tower";

describe("tower", () => {
  it("keeps the dressing rules", () => {
    expect(checkBuilder(tower, sampleBoxes([[10, 14, 10]]))).toEqual([]);
  });

  it("stays well under the triangle cap and has dark window slots and roof details", () => {
    for (const b of sampleBoxes([[10, 14, 10], [16, 9, 12]], 4)) {
      const pieces = tower(b);
      expect(triangleCount(pieces)).toBeLessThan(3600);
      expect(pieces.find((p) => p.paint === "soot")?.mesh.indices.length).toBeGreaterThan(0);
      expect(pieces.find((p) => p.paint === "rustOrange" || p.paint === "frameNavy")?.mesh.indices.length).toBeGreaterThan(0);
    }
  });
});

describe("tower roof", () => {
  it("puts the rim top at the box top and nothing above it", () => {
    for (const b of sampleBoxes([[10, 14, 10]], 4)) {
      const ys = tower(b).flatMap((p) => p.mesh.positions.filter((_, i) => i % 3 === 1));
      expect(Math.max(...ys)).toBeCloseTo(b.max[1], 6);
    }
  });
});
