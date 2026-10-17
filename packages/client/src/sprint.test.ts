import { describe, expect, it } from "vitest";
import { Sprint } from "./sprint";

describe("Sprint", () => {
  it("starts on the second press of W and not the first", () => {
    const sprint = new Sprint();
    sprint.forwardPressed(1000, 0.25);
    expect(sprint.active).toBe(false);
    sprint.forwardReleased();
    sprint.forwardPressed(1150, 0.25);
    expect(sprint.active).toBe(true);
  });

  it("ends when W is let go", () => {
    const sprint = new Sprint();
    sprint.forwardPressed(1000, 0.25);
    sprint.forwardPressed(1100, 0.25);
    sprint.forwardReleased();
    expect(sprint.active).toBe(false);
  });

  it("does not start when the presses are too far apart", () => {
    const sprint = new Sprint();
    sprint.forwardPressed(1000, 0.25);
    sprint.forwardPressed(1500, 0.25);
    expect(sprint.active).toBe(false);
  });

  it("needs a fresh pair to sprint again", () => {
    const sprint = new Sprint();
    sprint.forwardPressed(1000, 0.25);
    sprint.forwardPressed(1100, 0.25);
    sprint.forwardReleased();
    sprint.forwardPressed(1200, 0.25); // a single new press, not a pair
    expect(sprint.active).toBe(false);
  });
});
