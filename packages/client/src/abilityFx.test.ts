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
    expect(() => parseAbilityFx({ ...abilityFxJson, dust: { ...abilityFxJson.dust, color: 3 } })).toThrow(/dust.color/);
  });
});
