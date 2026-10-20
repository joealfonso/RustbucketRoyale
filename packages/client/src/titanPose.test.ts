import { describe, expect, it } from "vitest";
import { parseTitanConfig } from "@rustbucket/shared";
import titanJson from "../../../data/titan.json";
import titanLookJson from "../../../data/titanLook.json";
import { parseTitanLook } from "./titanLook";
import { DOWN, ROAR, STOMP, THROW, WALK, createTitanMotion, crossed, titanMotion } from "./titanPose";

const look = parseTitanLook(titanLookJson);
const config = parseTitanConfig(titanJson);
const at = (action: number, seconds: number) => titanMotion(action, seconds, look, config, createTitanMotion());

describe("titanMotion", () => {
  it("adds nothing to a plain walk", () => {
    const m = at(WALK, 3);
    expect([m.pitch, m.roll, m.footLift, m.footForward, m.arms, m.topple]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(m.car).toBe(false);
  });

  it("raises the foot through the wind-up and has it down exactly when the server's stomp lands", () => {
    const windup = config.stomp.windupSeconds;
    const high = at(STOMP, windup - look.stomp.slamSeconds - 0.001);
    expect(high.footLift).toBeGreaterThan(look.stomp.footLiftMeters * 0.95);
    expect(high.pitch).toBeGreaterThan(0); // rearing back
    const falling = at(STOMP, windup - look.stomp.slamSeconds / 2);
    expect(falling.footLift).toBeLessThan(high.footLift);
    expect(falling.footLift).toBeGreaterThan(0);
    expect(at(STOMP, windup).footLift).toBe(0);
    expect(at(STOMP, windup).pitch).toBeLessThan(0); // its weight thrown forward
  });

  it("settles back to the walk by the end of the server's recovery", () => {
    const m = at(STOMP, config.stomp.windupSeconds + config.stomp.recoverSeconds);
    expect(m.pitch).toBeCloseTo(0);
    expect(m.footForward).toBeCloseTo(0);
  });

  it("holds the car from the pick-up until the server releases it, arms overhead as it lets go", () => {
    const windup = config.throw.windupSeconds;
    expect(at(THROW, 0).car).toBe(false);
    expect(at(THROW, windup * 0.6).car).toBe(true);
    expect(at(THROW, windup - 0.001).car).toBe(true);
    expect(at(THROW, windup).car).toBe(false);
    const release = at(THROW, windup - 0.001).arms;
    expect(release).toBeCloseTo((look.throw.releaseDegrees * Math.PI) / 180, 1);
    // Hauled up behind the head first, then swung forward to the release.
    expect(at(THROW, windup - look.throw.swingSeconds).arms).toBeGreaterThan(release);
    expect(at(THROW, windup + config.throw.recoverSeconds).arms).toBeCloseTo(0);
  });

  it("rears up for the roar and is back down by its end", () => {
    const mid = at(ROAR, config.roar.seconds * 0.4);
    expect(mid.pitch).toBeGreaterThan(0);
    expect(mid.arms).toBeGreaterThan(0);
    expect(at(ROAR, config.roar.seconds).pitch).toBeCloseTo(0);
  });

  it("tips forward faster and faster until the server's fall ends, then stays tipped", () => {
    const full = (look.fall.toppleDegrees * Math.PI) / 180;
    expect(at(DOWN, 0).topple).toBe(0);
    expect(at(DOWN, config.fall.seconds / 2).topple).toBeCloseTo(full / 4);
    expect(at(DOWN, config.fall.seconds).topple).toBeCloseTo(full);
    expect(at(DOWN, config.fall.seconds + 5).topple).toBeCloseTo(full);
  });
});

describe("crossed", () => {
  it("is true once, on the frame a clock passes the moment", () => {
    expect(crossed(0.8, 0.95, 0.9)).toBe(true);
    expect(crossed(0.9, 1, 0.9)).toBe(false);
    expect(crossed(0.7, 0.8, 0.9)).toBe(false);
  });
});
