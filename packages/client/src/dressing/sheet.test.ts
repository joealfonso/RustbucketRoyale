import { describe, expect, it } from "vitest";
import { checkBuilder, sampleBoxes, triangleCount } from "./builderChecks";
import { sheet } from "./sheet";

describe("sheet", () => {
  it("keeps the builder rules for every real wall size", () => {
    const sizes: [number, number, number][] = [
      [16, 4, 1.5], [14, 4, 1.5], [16, 4, 1], [6, 4, 1], [1, 4, 16],
      [34, 7, 1], [10, 7, 1], [1, 7, 26], [1, 7, 9],
    ];
    expect(checkBuilder(sheet, sampleBoxes(sizes))).toEqual([]);
  });

  it("gives a longer wall more ribs and posts", () => {
    const [long] = sampleBoxes([[34, 7, 1]], 1);
    const [short] = sampleBoxes([[10, 7, 1]], 1);
    expect(triangleCount(sheet(long!))).toBeGreaterThan(triangleCount(sheet(short!)));
  });
});
