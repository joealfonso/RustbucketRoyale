import { describe, expect, it } from "vitest";
import lookJson from "../../../data/look.json";
import { mossAt, mossGlsl, mossThreshold, parseMoss } from "./mossEdge";

const moss = parseMoss(lookJson.world.moss);

describe("moss edge", () => {
  it("grows nothing below minUp and the full cover on a flat top", () => {
    expect(mossThreshold(moss.minUp - 0.01, moss)).toBe(0);
    expect(mossThreshold(moss.minUp, moss)).toBe(0);
    expect(mossThreshold(1, moss)).toBeCloseTo(moss.cover, 6);
    expect(mossThreshold(moss.minUp + moss.soft, moss)).toBeCloseTo(moss.cover, 6);
  });

  it("thins out smoothly down a rounded shoulder, so the patch edge follows the form", () => {
    let last = -1;
    for (let up = moss.minUp; up <= 1; up += 0.01) {
      const t = mossThreshold(up, moss);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
    const halfway = mossThreshold(moss.minUp + moss.soft / 2, moss);
    expect(halfway).toBeCloseTo(moss.cover / 2, 6);
  });

  it("makes the same noise moss on top and bare paint on the shoulder, with a dark rim at the edge", () => {
    const n = moss.cover * 0.6;
    expect(mossAt(n, 1, moss)).toBe("moss");
    expect(mossAt(n, moss.minUp + moss.soft * 0.2, moss)).toBe(null);
    expect(mossAt(moss.cover - moss.rim / 2, 1, moss)).toBe("dark");
    expect(mossAt(moss.cover + 0.01, 1, moss)).toBe(null);
  });

  it("writes the same sum into the shader", () => {
    const glsl = mossGlsl(moss);
    expect(glsl).toContain(`smoothstep(${moss.minUp.toFixed(3)}, ${(moss.minUp + moss.soft).toFixed(3)}, vWorldN.y)`);
    expect(glsl).toContain(moss.cover.toFixed(3));
  });

  it("refuses a soft edge that runs past straight up", () => {
    expect(() => parseMoss({ ...lookJson.world.moss, soft: 0.5 })).toThrow(/moss/);
    expect(() => parseMoss({ ...lookJson.world.moss, soft: 0 })).toThrow(/moss/);
  });
});
