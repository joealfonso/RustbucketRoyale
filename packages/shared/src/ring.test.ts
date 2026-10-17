import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import matchJson from "../../../data/match.json";
import ringJson from "../../../data/ring.json";
import tiersJson from "../../../data/tiers.json";
import { parseMatchConfig } from "./match";
import { createRingNow, isOutsideRing, makeRingSchedule, maxEdgeSpeed, parseRingConfig, ringAt, ringDuration } from "./ring";
import { SeededRng } from "./generation/SeededRng";
import { parseMechStats } from "./stats";
import { parseTiers } from "./generation/tiers";

const config = parseRingConfig(ringJson);
const match = parseMatchConfig(matchJson);
const mech = parseMechStats(mechJson);
const tiers = parseTiers(tiersJson);

// Tests may use a seeded generator for repeatable rings.
const random = (seed: number) => { const rng = new SeededRng(seed); return () => rng.next32() / 4294967296; };

describe("ring schedule", () => {
  for (const tier of Object.keys(tiers.tiers)) {
    const meters = tiers.tiers[tier]!.meters;

    it(`${tier}: finishes inside the match with time to spare`, () => {
      const schedule = makeRingSchedule(config, tier, meters, random(1));
      expect(ringDuration(schedule)).toBeLessThanOrEqual(match.matchSeconds - 30);
      expect(ringDuration(schedule)).toBeGreaterThan(match.matchSeconds * 0.7); // and uses most of the 8 minutes
    });

    it(`${tier}: never closes faster than a walking mech can keep ahead of, for any random centres`, () => {
      const limit = mech.walkSpeed * config.maxEdgeSpeedFraction;
      for (let seed = 1; seed <= 300; seed++) {
        const schedule = makeRingSchedule(config, tier, meters, random(seed));
        expect(maxEdgeSpeed(schedule), `seed ${seed}`).toBeLessThanOrEqual(limit + 1e-9);
      }
    });

    it(`${tier}: each circle sits inside the one before it, and the first covers the whole map`, () => {
      const schedule = makeRingSchedule(config, tier, meters, random(5));
      expect(schedule.initial.radius).toBeGreaterThan((meters / 2) * Math.SQRT2 * 0.99);
      let prev = schedule.initial;
      for (const s of schedule.stages) {
        expect(Math.hypot(s.cx - prev.cx, s.cz - prev.cz) + s.radius).toBeLessThanOrEqual(prev.radius + 1e-9);
        prev = s;
      }
    });
  }

  it("holds, shrinks, and settles on the last circle", () => {
    const schedule = makeRingSchedule(config, "medium", 1000, random(2));
    const now = createRingNow();
    const first = schedule.stages[0]!;

    ringAt(schedule, 0, now);
    expect(now.radius).toBeCloseTo(schedule.initial.radius);
    expect(now.shrinking).toBe(false);
    expect(now.secondsToChange).toBeCloseTo(first.waitSeconds);

    ringAt(schedule, first.waitSeconds + first.shrinkSeconds / 2, now);
    expect(now.shrinking).toBe(true);
    expect(now.radius).toBeCloseTo((schedule.initial.radius + first.radius) / 2);

    ringAt(schedule, first.waitSeconds + first.shrinkSeconds, now);
    expect(now.radius).toBeCloseTo(first.radius);
    expect(now.damagePerSecond).toBe(schedule.stages[1]!.damagePerSecond); // the next stage's damage starts once this one settles

    ringAt(schedule, 100000, now);
    const last = schedule.stages.at(-1)!;
    expect(now.radius).toBeCloseTo(last.radius);
    expect(now.shrinking).toBe(false);
    expect(now.secondsToChange).toBe(0);
  });

  it("only gets smaller", () => {
    const schedule = makeRingSchedule(config, "large", 2000, random(9));
    const now = createRingNow();
    let last = Infinity;
    for (let t = 0; t <= 480; t += 1) {
      ringAt(schedule, t, now);
      expect(now.radius).toBeLessThanOrEqual(last + 1e-9);
      last = now.radius;
    }
  });

  it("knows who is outside", () => {
    expect(isOutsideRing({ cx: 0, cz: 0, radius: 10 }, 11, 0)).toBe(true);
    expect(isOutsideRing({ cx: 0, cz: 0, radius: 10 }, 6, 6)).toBe(false);
  });

  it("rejects a bad ring file", () => {
    expect(() => parseRingConfig({})).toThrow();
    expect(() => parseRingConfig({ ...ringJson, tiers: { small: [] } })).toThrow();
  });
});
