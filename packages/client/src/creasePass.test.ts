import { describe, expect, it } from "vitest";
import lookJson from "../../../data/look.json";
import { vfxConfig } from "./fx/quality";
import { CreasePass, creasePartner, parseCrease } from "./creasePass";

const levels = Object.keys(vfxConfig.levels);
const look = parseCrease(lookJson.crease, levels);

describe("crease lines", () => {
  it("are on at the high effects quality only", () => {
    const pass = new CreasePass(look, "high");
    expect(pass.enabled).toBe(true);
    pass.setQuality("normal");
    expect(pass.enabled).toBe(false);
    pass.setQuality("low");
    expect(pass.enabled).toBe(false);
    pass.dispose();
  });

  it("refuses a level vfx.json does not have, and a line darkened to black or past it", () => {
    expect(() => parseCrease({ ...look, onAtQuality: ["ultra"] }, levels)).toThrow(/onAtQuality/);
    expect(() => parseCrease({ ...look, darken: 1.5 }, levels)).toThrow(/darken/);
  });

  it("are thinner than the silhouettes: one pixel and a share of the next, never more than two", () => {
    expect(creasePartner(1, 1080)).toBe(0);
    expect(creasePartner(1.6, 1080)).toBeCloseTo(0.6);
    expect(creasePartner(1.6, 900)).toBeCloseTo(1/3);
    expect(creasePartner(1.6, 2160)).toBe(1);
    expect(look.pixels * 1.4).toBeLessThanOrEqual(lookJson.outline.world.pixels);
  });

  it("refuse a taper that runs past the sharpest fold, or no width", () => {
    expect(() => parseCrease({ ...look, taper: 0.5 }, levels)).toThrow(/taper/);
    expect(() => parseCrease({ ...look, pixels: 0 }, levels)).toThrow(/pixels/);
  });
});
