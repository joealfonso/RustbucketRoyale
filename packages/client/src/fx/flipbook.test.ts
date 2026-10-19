import { describe, expect, it } from "vitest";
import { flickerFrame, flipbookFrame, hash01, SlotRing, stepped } from "./flipbook";

describe("flipbookFrame", () => {
  it("spreads the frames evenly over the life", () => {
    expect([0, 0.1, 0.26, 0.5, 0.76, 0.99].map((age) => flipbookFrame(age, 1, 4))).toEqual([0, 0, 1, 2, 3, 3]);
  });

  it("holds the first frame while waiting and the last once over", () => {
    expect(flipbookFrame(-0.2, 1, 4)).toBe(0);
    expect(flipbookFrame(5, 1, 4)).toBe(3);
    expect(flipbookFrame(0.5, 0, 4)).toBe(0);
    expect(flipbookFrame(0.5, 1, 1)).toBe(0);
  });
});

describe("flickerFrame", () => {
  it("loops at its frame rate", () => {
    expect([0, 0.1, 0.2, 0.3, 0.4].map((age) => flickerFrame(age, 10, 3))).toEqual([0, 1, 2, 0, 1]);
  });
});

describe("stepped", () => {
  it("moves in hard jumps, reaching the end at the end", () => {
    expect([0, 0.1, 0.25, 0.3, 0.74, 1].map((t) => stepped(t, 4))).toEqual([0, 0.25, 0.25, 0.5, 0.75, 1]);
    expect(stepped(0.3, 0)).toBeCloseTo(0.3);
    expect(stepped(2, 4)).toBe(1);
  });
});

describe("SlotRing", () => {
  it("reuses the oldest slot once the cap is reached", () => {
    const ring = new SlotRing();
    expect([1, 2, 3, 4, 5].map(() => ring.take(4))).toEqual([0, 1, 2, 3, 0]);
  });

  it("starts over when the cap drops below where it was, and gives nothing at a cap of 0", () => {
    const ring = new SlotRing();
    for (let i = 0; i < 10; i++) ring.take(16);
    expect(ring.take(4)).toBe(0);
    expect(ring.take(0)).toBe(-1);
  });
});

describe("hash01", () => {
  it("is the same for the same number and stays in [0, 1)", () => {
    expect(hash01(42)).toBe(hash01(42));
    for (let i = -50; i < 50; i++) { expect(hash01(i)).toBeGreaterThanOrEqual(0); expect(hash01(i)).toBeLessThan(1); }
  });
});
