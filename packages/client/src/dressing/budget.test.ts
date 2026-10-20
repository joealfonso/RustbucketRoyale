import { describe, expect, it } from "vitest";
import dressingJson from "../../../../data/dressing.json";
import { parseTriangleBudget, trianglesFor } from "./budget";

const at = (size: [number, number, number]) => ({ min: [0, 0, 0] as [number, number, number], max: size, seed: 1, color: "" });

describe("triangle budget", () => {
  it("reads the setting in data/dressing.json and fails loudly on a bad one", () => {
    expect(() => parseTriangleBudget(dressingJson.triangleBudget)).not.toThrow();
    expect(() => parseTriangleBudget(undefined)).toThrow(/triangleBudget/);
    expect(() => parseTriangleBudget({ perCubicMetre: 60, min: 150 })).toThrow(/max/);
    expect(() => parseTriangleBudget({ perCubicMetre: -1, min: 150, max: 4500 })).toThrow(/perCubicMetre/);
    expect(() => parseTriangleBudget({ perCubicMetre: 60, min: 500, max: 400 })).toThrow(/max/);
  });

  it("grows with the box's volume between its floor and its ceiling", () => {
    const budget = { perCubicMetre: 60, min: 150, max: 4500 };
    expect(trianglesFor(at([1, 1, 1]), budget)).toBe(150);
    expect(trianglesFor(at([6, 4, 1]), budget)).toBe(1440);
    expect(trianglesFor(at([34, 7, 1]), budget)).toBe(4500);
  });
});
