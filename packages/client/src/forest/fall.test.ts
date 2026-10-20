import { describe, expect, it } from "vitest";
import forestJson from "../../../../data/forest.json";
import { parseForest } from "./config";
import { crownFade, fallAngle, fallOver, restAngle, sinkDepth } from "./fall";
import { FallHints } from "./fallHints";

const { fall, pine } = parseForest(forestJson);
const degrees = (r: number) => (r * 180) / Math.PI;

describe("a falling tree", () => {
  it("lies nearly flat on level ground and stops short of folding over on a slope", () => {
    const flat = degrees(restAngle(fall, 10, 0));
    expect(flat).toBeGreaterThan(75);
    expect(flat).toBeLessThan(90);
    expect(degrees(restAngle(fall, 10, -8))).toBeLessThanOrEqual(fall.maxDegrees + 1e-9); // falling down a steep slope
    expect(degrees(restAngle(fall, 10, 8))).toBeGreaterThanOrEqual(fall.minDegrees - 1e-9); // falling into the hill
  });

  it("starts slowly, speeds up, bounces once and comes to rest", () => {
    const rest = restAngle(fall, 10, 0);
    const quarter = fallAngle(fall, rest, fall.seconds / 4), half = fallAngle(fall, rest, fall.seconds / 2);
    expect(quarter).toBeLessThan(rest / 8);
    expect(half - quarter).toBeGreaterThan(quarter); // faster in the second quarter than the first
    expect(fallAngle(fall, rest, fall.seconds)).toBeCloseTo(rest);
    expect(fallAngle(fall, rest, fall.seconds + fall.bounceSeconds / 2)).toBeLessThan(rest);
    expect(fallAngle(fall, rest, fall.seconds + fall.bounceSeconds + 0.5)).toBe(rest);
  });

  it("lies a while, then sinks out of sight and is done", () => {
    const lying = fall.seconds + fall.bounceSeconds + fall.lieSeconds;
    expect(sinkDepth(fall, lying - 0.1)).toBe(0);
    expect(sinkDepth(fall, lying + fall.sinkSeconds)).toBeCloseTo(fall.sinkMeters);
    expect(fallOver(fall, lying + fall.sinkSeconds - 0.01)).toBe(false);
    expect(fallOver(fall, lying + fall.sinkSeconds)).toBe(true);
  });
});

describe("crowns in the way", () => {
  const { marginMeters: margin, least } = pine.fade;
  // A crown round (0, 0) from 4 m up to 12 m, 3 m wide at the bottom.
  const fade = (cx: number, cy: number, cz: number, fx: number, fy: number, fz: number) => crownFade(0, 0, 4, 12, 3, cx, cy, cz, fx, fy, fz, margin, least);

  it("leaves a crown alone when it hides nothing", () => {
    expect(fade(-20, 6, 10, 20, 5, 10)).toBe(1);
    expect(fade(-20, 20, 0, 20, 20, 0)).toBe(1); // the line passes over the top
  });

  it("stipples a crown between the camera and its mech", () => {
    expect(fade(-10, 6, 0, 10, 5, 0)).toBe(least);
  });

  it("drops a crown the camera is inside", () => {
    expect(fade(0.5, 6, 0, 10, 5, 0)).toBe(0);
  });
});

describe("fall hints", () => {
  it("falls a tree the way the shot through it was going", () => {
    const hints = new FallHints(fall.hintSeconds, fall.hintShotMeters);
    hints.shot(10, -30, 5, 1, 0, 60);
    expect(hints.directionFor(10.1, 0, 5.5)).toBeCloseTo(0);
    expect(Number.isNaN(hints.directionFor(10.1, 0, 15))).toBe(true); // a shot that missed by ten metres
    expect(Number.isNaN(hints.directionFor(10 + fall.hintSeconds + 0.1, 0, 5.5))).toBe(true); // too long ago
  });

  it("falls a tree away from a blast beside it", () => {
    const hints = new FallHints(fall.hintSeconds, fall.hintShotMeters);
    hints.blast(3, 0, 0, 6);
    expect(hints.directionFor(3.2, 0, 4)).toBeCloseTo(Math.PI / 2);
    expect(Number.isNaN(hints.directionFor(3.2, 0, 9))).toBe(true);
  });

  it("takes the newest hint that fits", () => {
    const hints = new FallHints(fall.hintSeconds, fall.hintShotMeters);
    hints.shot(1, -30, 0, 1, 0, 60);
    hints.shot(1.1, 0, -30, 0, 1, 60);
    expect(hints.directionFor(1.2, 0, 0)).toBeCloseTo(Math.PI / 2);
  });
});
