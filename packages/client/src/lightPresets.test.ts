import { describe, expect, it } from "vitest";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { parseLight, presetForSeed, presetNamed, type LightPreset } from "./lightPresets";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const light = parseLight(lookJson.light);
const preset = (): LightPreset => JSON.parse(JSON.stringify(light.presets[0])) as LightPreset;

describe("light presets", () => {
  it("look.json parses and every colour it names is in the palette", () => {
    expect(light.presets.length).toBeGreaterThan(1);
    expect(() => new Toon(parseLook(lookJson), parsePalette(paletteJson))).not.toThrow();
  });

  it("rejects broken presets", () => {
    expect(() => parseLight({ presets: [] })).toThrow();
    expect(() => parseLight({ presets: [preset(), preset()] })).toThrow(/twice/);
    const below = preset();
    below.key.direction = [0, -1, 0];
    expect(() => parseLight({ presets: [below] })).toThrow(/horizon/);
    const backwards = preset();
    backwards.haze.far = backwards.haze.near;
    expect(() => parseLight({ presets: [backwards] })).toThrow(/near < far/);
  });

  it("rejects a colour the palette does not have", () => {
    const look = parseLook(lookJson);
    const odd = preset();
    odd.sky.zenith = "notAColour";
    expect(() => new Toon({ ...look, light: { presets: [odd] } }, parsePalette(paletteJson))).toThrow(/notAColour/);
  });

  it("the same seed always picks the same preset, and seeds reach every preset", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) {
      const a = presetForSeed(light, seed);
      expect(presetForSeed(light, seed)).toBe(a);
      seen.add(a.name);
    }
    expect(seen.size).toBe(light.presets.length);
    // Big seeds, as online rooms use, work too.
    expect(light.presets).toContain(presetForSeed(light, 0xfffffffe));
  });

  it("a name forces a preset, and an unknown name falls back to the seed", () => {
    const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
    const last = light.presets[light.presets.length - 1]!;
    expect(presetNamed(light, last.name)).toBe(last);
    expect(toon.presetFor(5, last.name).name).toBe(last.name);
    expect(toon.presetFor(5, "no such look").name).toBe(presetForSeed(light, 5).name);
  });
});
