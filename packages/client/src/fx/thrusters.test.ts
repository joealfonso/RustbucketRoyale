import { describe, expect, it } from "vitest";
import thrusterFxJson from "../../../../data/thrusterFx.json";
import { flameLength, parseThrusterFx } from "./thrusters";

const config = parseThrusterFx(thrusterFxJson);
const { flame } = config;

describe("flameLength", () => {
  it("is nothing with the jets off", () => {
    expect(flameLength(flame, false, 10, 1.3)).toBe(0);
  });

  it("stays within its flicker of the base length while hovering", () => {
    for (let t = 0; t < 2; t += 0.01) {
      const length = flameLength(flame, true, 0, t);
      expect(length).toBeGreaterThanOrEqual(flame.length * (1 - flame.flicker) - 1e-9);
      expect(length).toBeLessThanOrEqual(flame.length * (1 + flame.flicker) + 1e-9);
    }
  });

  it("holds one length through a flipbook frame and is longer climbing hard", () => {
    const frame = 1 / flame.framesPerSecond;
    expect(flameLength(flame, true, 0, 3 * frame + 0.001)).toBe(flameLength(flame, true, 0, 4 * frame - 0.001));
    expect(flameLength(flame, true, flame.risingSpeed, 0.5)).toBeCloseTo(flameLength(flame, true, 0, 0.5) * (1 + flame.risingBoost));
    expect(flameLength(flame, true, -20, 0.5)).toBe(flameLength(flame, true, 0, 0.5)); // falling adds nothing
  });
});

describe("parseThrusterFx", () => {
  it("has nozzles for every roster mech and fails without a default", () => {
    for (const id of ["ironclad", "stiletto", "cataclysm", "arbiter"]) expect(config.nozzles[id]?.length).toBeGreaterThan(0);
    expect(() => parseThrusterFx({ ...thrusterFxJson, nozzles: {} })).toThrow(/default/);
    expect(() => parseThrusterFx({ ...thrusterFxJson, flame: { ...thrusterFxJson.flame, tilt: [0, 1] } })).toThrow(/tilt/);
  });
});
