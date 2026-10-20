import { describe, expect, it } from "vitest";
import { FeatureCost } from "./featureCost";
import { FrameTimes } from "./frameTimes";

describe("feature cost", () => {
  it("measures everything on, then each feature off in turn, and switches them back on", () => {
    const on: Record<string, boolean> = { shadows: true, paint: true };
    const cost: Record<string, number> = { shadows: 2, paint: 0.5 };
    const features = Object.keys(on).map((name) => ({ name, set: (v: boolean) => { on[name] = v; } }));
    const measure = new FeatureCost(features, 1, 2);
    const gpu = new FrameTimes(240), out = { median: 0, worst: 0 };
    measure.start();
    for (let frame = 0; frame < 60 * 10 && measure.running; frame++) {
      // 3 ms of everything else, plus whatever is switched on, plus a hitch in the first frames after each switch.
      gpu.record(3 + Object.keys(on).reduce((ms, name) => ms + (on[name] ? cost[name]! : 0), 0) + (frame % 180 < 5 ? 40 : 0));
      measure.tick(1 / 60, gpu, out);
    }
    expect(measure.running).toBe(false);
    expect(measure.baselineMs).toBeCloseTo(5.5, 5);
    expect(measure.results.map((r) => [r.name, Math.round(r.ms * 10) / 10])).toEqual([["shadows", 2], ["paint", 0.5]]);
    expect(on).toEqual({ shadows: true, paint: true });
    expect(measure.summary()).toBe("shadows 2.0, paint 0.5 ms (all on: 5.5 ms)");
  });
});
