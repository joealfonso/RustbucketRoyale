import { describe, expect, it } from "vitest";
import stepEaseJson from "../../../data/stepEase.json";
import { StepEase, parseStepEase } from "./stepEase";

const config = parseStepEase(stepEaseJson);

describe("step ease", () => {
  it("starts a step up drawn at the old height and eases to the new one", () => {
    const ease = new StepEase(config);
    ease.stepped(0.4, true);
    expect(ease.update(0)).toBeCloseTo(-0.4, 5);
    const later = ease.update(1 / 60);
    expect(later).toBeGreaterThan(-0.4);
    expect(later).toBeLessThan(0);
    for (let i = 0; i < 60; i++) ease.update(1 / 60);
    expect(ease.offset).toBe(0);
  });

  it("never draws above the mech: each step only lowers the drawn height toward the last one", () => {
    const ease = new StepEase(config);
    for (let i = 0; i < 10; i++) { ease.stepped(0.3, true); expect(ease.update(1 / 60)).toBeLessThanOrEqual(0); }
  });

  it("leaves slopes, jets, falls and the air alone", () => {
    const ease = new StepEase(config);
    ease.stepped(config.minRiseMeters / 2, true); // a slope
    ease.stepped(config.maxRiseMeters * 2, true); // a correction or a jet
    ease.stepped(-0.4, true); // stepping down
    ease.stepped(0.4, false); // in the air
    expect(ease.update(0)).toBe(0);
  });
});
