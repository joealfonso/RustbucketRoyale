import { describe, expect, it } from "vitest";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { gradeColor, gradeNumbers, parseGrade, type GradeCurves } from "./grade";

const colors = (paletteJson as { colors: Record<string, string> }).colors;
const color = (name: string) => colors[name] ?? name;
const presetNames = (lookJson as { light: { presets: { name: string }[] } }).light.presets.map((p) => p.name);
const config = parseGrade((lookJson as { grade?: unknown }).grade, presetNames);

const curves: GradeCurves = {
  mids: { saturation: 0.2, center: 0.45, width: 0.35 },
  shadows: { tint: "#3E5A80", amount: 0.5, lift: 0.1, upTo: 0.35 },
  highlights: { tint: "warmLight", amount: 0.3, from: 0.6 },
};
const out: [number, number, number] = [0, 0, 0];

describe("colour grade", () => {
  it("has curves for every light preset, and the overcast push is the strongest", () => {
    for (const name of presetNames) expect(config.presets[name]).toBeDefined();
    const others = presetNames.filter((n) => n !== "overcast").map((n) => config.presets[n]!);
    const overcast = config.presets.overcast!;
    for (const g of others) {
      expect(overcast.mids.saturation).toBeGreaterThan(g.mids.saturation);
      expect(overcast.shadows.amount).toBeGreaterThanOrEqual(g.shadows.amount);
      expect(overcast.shadows.lift).toBeLessThanOrEqual(g.shadows.lift); // a lift flattens, and overcast is flat already
      expect(overcast.highlights.amount).toBeGreaterThanOrEqual(g.highlights.amount);
    }
  });

  it("refuses a missing preset, an unknown one and numbers out of range", () => {
    const one = { presets: { a: curves } };
    expect(() => parseGrade(one, ["a", "b"])).toThrow(/light preset b/);
    expect(() => parseGrade({ presets: { a: curves, c: curves } }, ["a"])).toThrow(/names no light preset/);
    expect(() => parseGrade({ presets: { a: { ...curves, shadows: { ...curves.shadows, amount: 2 } } } }, ["a"])).toThrow(/shadows/);
    expect(() => parseGrade({ presets: { a: { ...curves, highlights: { ...curves.highlights, from: 1 } } } }, ["a"])).toThrow(/highlights/);
    expect(() => parseGrade({ presets: { a: { ...curves, mids: { ...curves.mids, width: 0 } } } }, ["a"])).toThrow(/mids/);
  });

  it("lifts black toward the cool tint", () => {
    const n = gradeNumbers(curves, color);
    const [r, g, b] = gradeColor(n, 0, 0, 0, out);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(0.05);
    expect(b).toBeLessThan(0.2); // a lift, not a wash
  });

  it("turns a dark warm colour cooler without lifting it when there is no lift", () => {
    const n = gradeNumbers({ ...curves, shadows: { ...curves.shadows, lift: 0 } }, color);
    const [r, g, b] = gradeColor(n, 0.2, 0.18, 0.1, out);
    expect(b - r).toBeGreaterThan(-0.07); // was -0.1
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(0.2126 * 0.2 + 0.7152 * 0.18 + 0.0722 * 0.1, 2);
  });

  it("warms white without making it darker overall", () => {
    const n = gradeNumbers(curves, color);
    const [r, g, b] = gradeColor(n, 0.95, 0.95, 0.95, out);
    expect(r).toBeGreaterThan(b);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(0.9);
  });

  it("saturates a mid-tone and leaves a mid grey grey", () => {
    const n = gradeNumbers(curves, color);
    const [r, g, b] = gradeColor(n, 0.55, 0.42, 0.3, out);
    expect(r - b).toBeGreaterThan(0.55 - 0.3);
    expect(g).toBeGreaterThan(0.3);
    const [gr, gg, gb] = gradeColor(n, 0.45, 0.45, 0.45, out);
    expect(gr).toBeCloseTo(0.45, 2);
    expect(gg).toBeCloseTo(0.45, 2);
    expect(gb).toBeCloseTo(0.45, 2);
  });

  it("with every amount at zero changes nothing", () => {
    const none = gradeNumbers({ mids: { ...curves.mids, saturation: 0 }, shadows: { ...curves.shadows, amount: 0, lift: 0 }, highlights: { ...curves.highlights, amount: 0 } }, color);
    for (const v of [[0, 0, 0], [0.2, 0.5, 0.7], [1, 1, 1]] as const) {
      const [r, g, b] = gradeColor(none, v[0], v[1], v[2], out);
      expect(r).toBeCloseTo(v[0], 6);
      expect(g).toBeCloseTo(v[1], 6);
      expect(b).toBeCloseTo(v[2], 6);
    }
  });
});
