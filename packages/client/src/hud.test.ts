import { describe, expect, it } from "vitest";
import { COOLDOWN_STEPS, cooldownStep } from "./hud";

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
