import { describe, expect, it } from "vitest";
import { BlastSizes } from "./blastSize";

describe("BlastSizes", () => {
  it("takes a blast for a grenade unless a barrel broke there or a strike was called on it just before", () => {
    const sizes = new BlastSizes(8, 9);
    expect(sizes.radiusAt(10, 10, 0)).toBe(8);
    sizes.barrel(10, 10, 0, 1);
    sizes.strike(50, 50, 6, 0, 3, 6);
    expect(sizes.radiusAt(10.5, 10, 0.2)).toBe(9);
    expect(sizes.radiusAt(54, 50, 2)).toBe(6);
    expect(sizes.radiusAt(30, 30, 0.2)).toBe(8);
  });

  it("forgets them once their time is up", () => {
    const sizes = new BlastSizes(8, 9);
    sizes.barrel(0, 0, 0, 1);
    expect(sizes.radiusAt(0, 0, 1.5)).toBe(8);
  });
});
