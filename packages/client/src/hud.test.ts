import { describe, expect, it } from "vitest";
import { ALT_STEPS, COOLDOWN_STEPS, altMeter, bossBarShown, clock, cooldownStep, plateText, ringLabel } from "./hud";

describe("cooldownStep", () => {
  it("is full, meaning ready, once the cooldown is over", () => {
    expect(cooldownStep(0, 7)).toBe(COOLDOWN_STEPS);
    expect(cooldownStep(-0.01, 7)).toBe(COOLDOWN_STEPS);
  });

  it("starts empty and fills as the cooldown runs down, never reading ready before it is", () => {
    expect(cooldownStep(7, 7)).toBe(0);
    expect(cooldownStep(3.5, 7)).toBe(COOLDOWN_STEPS / 2);
    expect(cooldownStep(0.001, 7)).toBe(COOLDOWN_STEPS - 1);
  });

  it("stays in range when a tuned cooldown is shorter than what is left", () => {
    expect(cooldownStep(9, 7)).toBe(0);
  });
});

describe("clock", () => {
  it("shows minutes and two-digit seconds, dropping the fraction", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65.9)).toBe("1:05");
    expect(clock(480)).toBe("8:00");
  });

  it("never shows a negative time", () => {
    expect(clock(-3)).toBe("0:00");
  });
});

describe("ringLabel", () => {
  it("says what the zone is doing", () => {
    expect(ringLabel(20, true)).toBe("Zone closing");
    expect(ringLabel(20, false)).toBe("Zone holds");
    expect(ringLabel(0, true)).toBe("Final zone");
  });
});

describe("plateText", () => {
  it("shows whole points, or a dash for no plate", () => {
    expect(plateText(30)).toBe("30");
    expect(plateText(12.6)).toBe("13");
    expect(plateText(0)).toBe("--");
  });
});

describe("bossBarShown", () => {
  it("shows while the Titan stands within reach, and only then", () => {
    expect(bossBarShown(true, false, 90, 120, 150)).toBe(true); // 150 m away exactly
    expect(bossBarShown(true, false, 100, 120, 150)).toBe(false);
    expect(bossBarShown(false, false, 0, 0, 150)).toBe(false); // none near you
  });

  it("goes once it has fallen", () => {
    expect(bossBarShown(true, true, 10, 0, 150)).toBe(false);
  });
});

describe("altMeter", () => {
  const m = { step: 0, label: "", state: "" as const } as Parameters<typeof altMeter>[3];
  it("fills a windup's heat bar in steps, turns hot near the top and says OVERHEAT when locked", () => {
    expect(altMeter("windup", 0.5, false, m)).toMatchObject({ step: ALT_STEPS / 2, state: "", label: "" });
    expect(altMeter("windup", 0.8, false, m).state).toBe("hot");
    expect(altMeter("windup", 1, true, m)).toMatchObject({ step: ALT_STEPS, state: "overheat", label: "OVERHEAT" });
  });

  it("fills a charge ring and says PIERCE once full", () => {
    expect(altMeter("charge", 0.25, false, m)).toMatchObject({ step: ALT_STEPS / 4, state: "" });
    expect(altMeter("charge", 1, true, m)).toMatchObject({ state: "full", label: "PIERCE" });
  });

  it("lights the slug's dot when it is ready", () => {
    expect(altMeter("slug", 0, true, m)).toMatchObject({ step: ALT_STEPS, state: "ready" });
    expect(altMeter("slug", 0, false, m)).toMatchObject({ step: 0, state: "" });
  });
});
