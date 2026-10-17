import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";

describe("Meter", () => {
  it("locks when drained to empty", () => {
    const meter = new Meter(100);
    meter.drain(100, 0);
    expect(meter.locked).toBe(true);
    expect(meter.canUse).toBe(false);
  });

  it("stays locked until refilled past the unlock fraction", () => {
    const meter = new Meter(100);
    meter.drain(100, 0);
    meter.regen(10, 1, 0.25); // 10 of 100
    expect(meter.locked).toBe(true);
    meter.regen(10, 2, 0.25); // 30 of 100
    expect(meter.locked).toBe(false);
  });

  it("waits for the regen delay before refilling", () => {
    const meter = new Meter(100);
    meter.drain(50, 1);
    meter.regen(10, 0.5, 0.25);
    meter.regen(10, 0.5, 0.25);
    expect(meter.value).toBeCloseTo(50);
    meter.regen(10, 1, 0.25);
    expect(meter.value).toBeCloseTo(60);
  });

  it("clamps value when max is lowered", () => {
    const meter = new Meter(100);
    meter.setMax(40);
    expect(meter.value).toBe(40);
  });
});
