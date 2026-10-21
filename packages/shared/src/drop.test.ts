import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import { DROP_BURNING, DROP_DIVING, DROP_NONE, DROP_RIDING } from "./drop";
import { createMechInput } from "./MechInput";
import { createMechState, stepMech } from "./mechStep";
import { parseMechStats } from "./stats";
import { World, boxFromData } from "./world";

const stats = parseMechStats(mechJson);
const ground = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [8000, 1, 8000], color: "" })]);
const DT = 1 / 60;
const DEG = Math.PI / 180;

// Dives from 400 m looking `pitch` degrees, holding W, until landed. Returns how long, how far and the worst speed
// it hit the ground with.
function dive(pitch: number) {
  const s = createMechState(stats, 0, 400, 0, 0);
  s.dropPhase = DROP_DIVING;
  const input = createMechInput();
  input.aimPitch = pitch * DEG;
  input.moveY = 1;
  let seconds = 0, braked = false, landingSpeed = 0;
  while (s.dropPhase !== DROP_NONE && seconds < 60) {
    landingSpeed = -s.vy;
    stepMech(s, input, stats, DT, ground);
    if (s.dropPhase === DROP_BURNING) braked = true;
    seconds += DT;
  }
  return { s, seconds, distance: Math.hypot(s.x, s.z), braked, landingSpeed };
}

describe("drop-in dive", () => {
  it("looking down drops fast and short, looking ahead slow and far", () => {
    const steep = dive(-60), level = dive(-10);
    expect(steep.s.dropPhase).toBe(DROP_NONE);
    expect(level.s.dropPhase).toBe(DROP_NONE);
    expect(steep.seconds).toBeLessThan(level.seconds);
    expect(level.distance).toBeGreaterThan(steep.distance * 2);
  });

  it("brakes on its retro-jets near the ground and lands at the landing speed, then is stunned a moment", () => {
    const d = dive(-60);
    expect(d.braked).toBe(true);
    expect(d.landingSpeed).toBeLessThanOrEqual(stats.landingFall + 0.01);
    expect(d.s.y).toBeCloseTo(0, 3);
    expect(d.s.dropTime).toBeCloseTo(stats.landingStunSeconds, 5);
    // Stunned: holding W does not move it until the stun is over.
    const input = createMechInput();
    input.moveY = 1;
    stepMech(d.s, input, stats, DT, ground);
    expect(Math.hypot(d.s.vx, d.s.vz)).toBe(0);
  });

  it("holds still while riding, whatever is pressed", () => {
    const s = createMechState(stats, 5, 500, 5, 0);
    s.dropPhase = DROP_RIDING;
    const input = createMechInput();
    input.moveY = 1; input.jet = true; input.dash = true;
    for (let i = 0; i < 30; i++) stepMech(s, input, stats, DT, ground);
    expect([s.x, s.y, s.z]).toEqual([5, 500, 5]);
  });
});
