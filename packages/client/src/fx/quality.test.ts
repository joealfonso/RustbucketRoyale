import { describe, expect, it } from "vitest";
import vfxJson from "../../../../data/vfx.json";
import { mostOf, parseVfx, readQuality, writeQuality } from "./quality";

const config = parseVfx(vfxJson);
const blocked = () => { throw new Error("storage is blocked"); };

describe("parseVfx", () => {
  it("reads the data file, with a low level that is never above normal", () => {
    expect(config.levels[config.quality]).toBeDefined();
    for (const [key, value] of Object.entries(config.levels.low!)) expect(value).toBeLessThanOrEqual(config.levels.normal![key]!);
  });

  it("fails loudly on a quality that is not a level, a level missing a cap, or a broken palette", () => {
    expect(() => parseVfx({ ...vfxJson, quality: "ultra" })).toThrow(/ultra/);
    expect(() => parseVfx({ ...vfxJson, levels: { ...vfxJson.levels, low: { fire: 1 } } })).toThrow(/same things/);
    expect(() => parseVfx({ ...vfxJson, levels: { ...vfxJson.levels, low: { ...vfxJson.levels.low, fire: -1 } } })).toThrow(/low.fire/);
    expect(() => parseVfx({ ...vfxJson, sprites: { ...vfxJson.sprites, palettes: { fire: ["#fff"] } } })).toThrow(/fire/);
  });
});

describe("readQuality", () => {
  it("falls back to the file's level when storage throws, is empty, or holds something stale", () => {
    expect(readQuality(blocked, config)).toBe(config.quality);
    expect(readQuality(() => ({ getItem: blocked }), config)).toBe(config.quality);
    expect(readQuality(() => ({ getItem: () => null }), config)).toBe(config.quality);
    expect(readQuality(() => ({ getItem: () => "ultra" }), config)).toBe(config.quality);
  });

  it("remembers a level written before", () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    writeQuality(storage, "low");
    expect(readQuality(storage, config)).toBe("low");
  });

  it("does not throw when writing to blocked storage", () => {
    expect(() => writeQuality(blocked, "low")).not.toThrow();
  });
});

describe("mostOf", () => {
  it("is the largest cap any level gives, so pools are made big enough for every level", () => {
    expect(mostOf(config, "scorches")).toBe(Math.max(config.levels.low!.scorches!, config.levels.normal!.scorches!));
    expect(mostOf(config, "nothing")).toBe(0);
  });
});
