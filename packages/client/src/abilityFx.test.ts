import { describe, expect, it } from "vitest";
import abilityFxJson from "../../../data/abilityFx.json";
import { abilityMoment, parseAbilityFx } from "./abilityFx";

describe("abilityMoment", () => {
  it("starts when the ability time goes from nothing to something, for either kind", () => {
    expect(abilityMoment(0, 0.7, "ram")).toBe("start");
    expect(abilityMoment(0, 1.9, "pounce")).toBe("start");
  });

  it("lands only when a pounce runs out, not when a ram does", () => {
    expect(abilityMoment(0.3, 0, "pounce")).toBe("land");
    expect(abilityMoment(0.02, 0, "ram")).toBeNull();
  });

  it("says nothing while it carries on or while it is idle", () => {
    expect(abilityMoment(0.5, 0.48, "ram")).toBeNull();
    expect(abilityMoment(0, 0, "pounce")).toBeNull();
    expect(abilityMoment(0, 0, undefined)).toBeNull();
  });
});

describe("parseAbilityFx", () => {
  it("reads the data file", () => {
    expect(parseAbilityFx(abilityFxJson).slam.ringSeconds).toBeGreaterThan(0);
  });

  it("fails loudly on a missing number or colour", () => {
    expect(() => parseAbilityFx({ ...abilityFxJson, hit: { ...abilityFxJson.hit, flashSeconds: "long" } })).toThrow(/hit.flashSeconds/);
    expect(() => parseAbilityFx({ ...abilityFxJson, dust: { ...abilityFxJson.dust, seconds: null } })).toThrow(/dust.seconds/);
    expect(() => parseAbilityFx({ ...abilityFxJson, warning: { ...abilityFxJson.warning, ringColor: 3 } })).toThrow(/warning.ringColor/);
    expect(() => parseAbilityFx({ ...abilityFxJson, warning: { ...abilityFxJson.warning, pulsesPerSecond: -1 } })).toThrow(/warning.pulsesPerSecond/);
    expect(() => parseAbilityFx({ ...abilityFxJson, ghost: { ...abilityFxJson.ghost, tint: null } })).toThrow(/ghost.tint/);
    expect(() => parseAbilityFx({ ...abilityFxJson, warning: { ...abilityFxJson.warning, ringWidth: 1 } })).toThrow(/ringWidth/);
  });
});
