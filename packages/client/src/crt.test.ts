import { describe, expect, it } from "vitest";
import crtJson from "../../../data/crt.json";
import { clampIntensity, parseCrt, readCrtSetting, shownIntensity, writeCrtSetting } from "./crt";

const config = parseCrt(crtJson);
const holding = (text: string | null) => () => ({ getItem: () => text });
const blocked = () => { throw new Error("SecurityError"); };

describe("parseCrt", () => {
  it("accepts the data file", () => {
    expect(config.defaultIntensity).toBeGreaterThanOrEqual(0);
    expect(config.defaultIntensity).toBeLessThanOrEqual(1);
  });

  it("fails loudly on a share outside 0 to 1", () => {
    expect(() => parseCrt({ ...crtJson, defaultIntensity: 1.5 })).toThrow(/defaultIntensity/);
    expect(() => parseCrt({ ...crtJson, scanlineAlpha: "0.3" })).toThrow(/scanlineAlpha/);
  });

  it("fails loudly on lines too fine to draw", () => {
    expect(() => parseCrt({ ...crtJson, scanlinePeriodPx: 1 })).toThrow(/scanlinePeriodPx/);
  });
});

describe("clampIntensity", () => {
  it("keeps the value between 0 and 1", () => {
    expect(clampIntensity(-0.2, 0.5)).toBe(0);
    expect(clampIntensity(3, 0.5)).toBe(1);
    expect(clampIntensity(0.25, 0.5)).toBe(0.25);
  });

  it("falls back on anything that is not a number", () => {
    expect(clampIntensity(Number.NaN, 0.5)).toBe(0.5);
    expect(clampIntensity("1", 0.5)).toBe(0.5);
    expect(clampIntensity(undefined, 0.5)).toBe(0.5);
  });
});

describe("readCrtSetting", () => {
  const defaults = { on: true, intensity: config.defaultIntensity };

  it("is on at the data file's intensity when nothing is saved", () => {
    expect(readCrtSetting(holding(null), config)).toEqual(defaults);
  });

  it("uses the defaults when storage is blocked", () => {
    expect(readCrtSetting(blocked, config)).toEqual(defaults);
    expect(readCrtSetting(() => ({ getItem: blocked }), config)).toEqual(defaults);
  });

  it("uses the defaults when what is saved is not readable", () => {
    expect(readCrtSetting(holding("{not json"), config)).toEqual(defaults);
    expect(readCrtSetting(holding("7"), config)).toEqual(defaults);
  });

  it("reads back a saved setting, clamped", () => {
    expect(readCrtSetting(holding('{"on":false,"intensity":0.3}'), config)).toEqual({ on: false, intensity: 0.3 });
    expect(readCrtSetting(holding('{"on":true,"intensity":4}'), config)).toEqual({ on: true, intensity: 1 });
  });

  it("fills in each missing or broken field on its own", () => {
    expect(readCrtSetting(holding('{"on":false}'), config)).toEqual({ on: false, intensity: config.defaultIntensity });
    expect(readCrtSetting(holding('{"on":"no","intensity":0.2}'), config)).toEqual({ on: true, intensity: 0.2 });
  });
});

describe("writeCrtSetting", () => {
  it("round-trips through storage", () => {
    let text: string | null = null;
    writeCrtSetting(() => ({ setItem: (_k: string, v: string) => { text = v; } }), { on: false, intensity: 0.8 });
    expect(readCrtSetting(holding(text), config)).toEqual({ on: false, intensity: 0.8 });
  });

  it("does not throw when storage is blocked", () => {
    expect(() => writeCrtSetting(blocked, { on: true, intensity: 1 })).not.toThrow();
  });
});

describe("shownIntensity", () => {
  it("is nothing when switched off, whatever the slider says", () => {
    expect(shownIntensity({ on: false, intensity: 0.9 })).toBe(0);
    expect(shownIntensity({ on: true, intensity: 0.9 })).toBe(0.9);
  });
});
