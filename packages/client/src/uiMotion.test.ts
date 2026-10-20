import { describe, expect, it } from "vitest";
import { countAt, parseCssTime } from "./uiMotion";

describe("countAt", () => {
  it("starts on the first number and lands exactly on the last", () => {
    expect(countAt(12, 3, 0, 0.5)).toBe(12);
    expect(countAt(12, 3, 0.5, 0.5)).toBe(3);
    expect(countAt(12, 3, 9, 0.5)).toBe(3);
  });

  it("shows the end at once when there is no time to count (reduced motion)", () => {
    expect(countAt(12, 3, 0, 0)).toBe(3);
  });

  it("only ever shows whole numbers, moving one way, slowing as it lands", () => {
    const seen: number[] = [];
    for (let i = 0; i <= 50; i++) seen.push(countAt(0, 40, (i / 50) * 0.5, 0.5));
    expect(seen.every(Number.isInteger)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    // Eased out: more than half the distance is covered in the first quarter of the time.
    expect(seen[12]!).toBeGreaterThan(20);
  });
});

describe("parseCssTime", () => {
  it("reads milliseconds and seconds", () => {
    expect(parseCssTime("160ms")).toBeCloseTo(0.16);
    expect(parseCssTime(" 0.5s")).toBeCloseTo(0.5);
    expect(parseCssTime("0ms")).toBe(0);
  });

  it("treats anything unreadable as no time", () => {
    expect(parseCssTime("")).toBe(0);
    expect(parseCssTime("fast")).toBe(0);
    expect(parseCssTime("-1s")).toBe(0);
  });
});
