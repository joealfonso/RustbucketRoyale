import { describe, expect, it } from "vitest";
import { checkBuilder, sampleBoxes } from "./builderChecks";
import { rock } from "./rock";

const sizes: [number, number, number][] = [[3, 1.5, 3], [4, 2.2, 3], [3, 1.2, 4], [5, 2, 3], [6, 1.4, 2], [2, 1.6, 5], [3, 1.6, 3]];

describe("rock", () => {
  it("keeps the rules for every real rock size", () => {
    expect(checkBuilder(rock, sampleBoxes(sizes))).toEqual([]);
  });

  it("gives different rocks for different seeds in the same box", () => {
    const at = (seed: number) => JSON.stringify(rock({ min: [0, 0, 0], max: [5, 2, 3], seed, color: "#777777" }));
    expect(at(1)).not.toEqual(at(2));
  });
});
