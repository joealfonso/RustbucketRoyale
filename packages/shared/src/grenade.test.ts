import { describe, expect, it } from "vitest";
import grenadeJson from "../../../data/grenade.json";
import { createGrenade, stepGrenade, throwGrenade } from "./grenade";
import { createMechState } from "./mechStep";
import mechJson from "../../../data/mech.json";
import { parseGrenadeStats, parseMechStats } from "./stats";
import { boxFromData } from "./world";

const stats = parseGrenadeStats(grenadeJson);
const mechStats = parseMechStats(mechJson);
const ground = boxFromData({ name: "g", center: [0, -0.5, 0], size: [2000, 1, 2000], color: "" });
const DT = 1 / 60;

function fly(seconds: number, boxes = [ground]) {
  const g = createGrenade();
  g.x = 0; g.y = 2; g.z = 0; g.vx = 10; g.vy = 0; g.vz = 0; g.timeLeft = stats.fuseSeconds;
  let exploded = false;
  const trail: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    exploded = stepGrenade(g, stats, DT, boxes) || exploded;
    trail.push(g.y);
  }
  return { g, exploded, trail };
}

describe("grenade", () => {
  it("falls, bounces on the ground and never goes through it", () => {
    const { trail } = fly(1.5);
    expect(Math.min(...trail)).toBeGreaterThan(0);
    // After first touching down it rises again, which is the bounce.
    const touchdown = trail.findIndex((y) => y < stats.radius + 0.05);
    expect(touchdown).toBeGreaterThan(0);
    expect(Math.max(...trail.slice(touchdown))).toBeGreaterThan(stats.radius + 0.2);
  });

  it("goes off when the fuse runs out, and not before", () => {
    expect(fly(stats.fuseSeconds - 0.1).exploded).toBe(false);
    expect(fly(stats.fuseSeconds + 0.1).exploded).toBe(true);
  });

  it("bounces off a wall instead of passing through it", () => {
    const wall = boxFromData({ name: "w", center: [6, 5, 0], size: [1, 20, 20], color: "" });
    const { g } = fly(1, [ground, wall]);
    expect(g.x).toBeLessThan(5.5);
  });

  it("is deterministic, so client and server fly the same arc", () => {
    expect(fly(1.2).g).toEqual(fly(1.2).g);
  });

  it("is thrown toward the aim point with some lift", () => {
    const mech = createMechState(mechStats, 0, 0, 0, 0);
    const g = createGrenade();
    throwGrenade(mech, 0, 2.4, -50, stats, g);
    expect(g.vz).toBeLessThan(0);
    expect(g.vy).toBeGreaterThan(0);
    expect(g.timeLeft).toBe(stats.fuseSeconds);
  });
});
