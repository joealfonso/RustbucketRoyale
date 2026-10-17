import { describe, expect, it } from "vitest";
import { DoubleTap } from "./doubleTap";

describe("DoubleTap", () => {
  it("fires on the second press inside the window, not the first", () => {
    const tap = new DoubleTap();
    expect(tap.press("KeyD", 1000, 0.25)).toBe(false);
    expect(tap.press("KeyD", 1200, 0.25)).toBe(true);
  });

  it("does not fire when the presses are too far apart", () => {
    const tap = new DoubleTap();
    tap.press("KeyD", 1000, 0.25);
    expect(tap.press("KeyD", 1400, 0.25)).toBe(false);
  });

  it("tracks each key on its own", () => {
    const tap = new DoubleTap();
    tap.press("KeyW", 1000, 0.25);
    expect(tap.press("KeyD", 1100, 0.25)).toBe(false);
    expect(tap.press("KeyW", 1200, 0.25)).toBe(true);
  });

  it("a third quick press starts a new pair instead of chaining a second dash", () => {
    const tap = new DoubleTap();
    tap.press("ShiftLeft", 1000, 0.25);
    expect(tap.press("ShiftLeft", 1100, 0.25)).toBe(true);
    expect(tap.press("ShiftLeft", 1200, 0.25)).toBe(false);
  });
});
