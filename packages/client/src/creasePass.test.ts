import { describe, expect, it } from "vitest";
import lookJson from "../../../data/look.json";
import { vfxConfig } from "./fx/quality";
import { CreasePass, parseCrease } from "./creasePass";

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
});
