import { describe, expect, it } from "vitest";
import lookJson from "../../../data/look.json";
import { parseSky, skyShare } from "./sky";

const sky = parseSky(lookJson.sky);

describe("sky", () => {
  it("is the horizon colour at the horizon, the zenith colour overhead, and never goes back down", () => {
    expect(skyShare(sky, 0)).toBeCloseTo(0, 6);
    expect(skyShare(sky, 90)).toBeCloseTo(1, 6);
    let last = 0;
    for (let up = 0; up <= 90; up += 0.1) {
      const share = skyShare(sky, up);
      expect(share).toBeGreaterThanOrEqual(last - 1e-9);
      last = share;
    }
  });

  it("comes in flat bands: halfway between two steps it holds the lower step's share", () => {
    for (let i = 0; i < sky.steps.length - 1; i++) {
      const mid = (sky.steps[i]!.upDegrees + sky.steps[i + 1]!.upDegrees) / 2;
      expect(skyShare(sky, mid)).toBeCloseTo(sky.steps[i]!.share, 3);
    }
  });

  it("rejects steps out of order, or that never reach the zenith", () => {
    const broken = (steps: unknown) => () => parseSky({ ...lookJson.sky, steps });
    expect(broken([{ upDegrees: 9, share: 0.5 }, { upDegrees: 3, share: 1 }])).toThrow(/sky step/);
    expect(broken([{ upDegrees: 3, share: 0.5 }, { upDegrees: 9, share: 0.8 }])).toThrow(/share 1/);
    expect(broken([{ upDegrees: 3, share: 1 }])).toThrow(/2 to/);
  });
});
