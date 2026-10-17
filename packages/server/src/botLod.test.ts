import { describe, expect, it } from "vitest";
import botsJson from "../../../data/bots.json";
import { parseBotConfig } from "@rustbucket/shared";
import { AbstractFights, botsNeeded, pickDifficulty } from "./botLod";
import { lcg } from "./testClient";

const config = parseBotConfig(botsJson);

describe("difficulty", () => {
  it("is picked by the mix in the data file", () => {
    const counts: Record<string, number> = { easy: 0, normal: 0, hard: 0 };
    const random = lcg(1);
    for (let i = 0; i < 4000; i++) counts[pickDifficulty(config, random())]!++;
    expect(counts.easy! / 4000).toBeCloseTo(config.mix.easy!, 1);
    expect(counts.normal! / 4000).toBeCloseTo(config.mix.normal!, 1);
    expect(counts.hard! / 4000).toBeCloseTo(config.mix.hard!, 1);
  });

  it("makes harder bots better in every way that matters, and never worse", () => {
    const { easy, normal, hard } = config.difficulties;
    expect(hard!.aimErrorDegrees).toBeLessThan(normal!.aimErrorDegrees);
    expect(normal!.aimErrorDegrees).toBeLessThan(easy!.aimErrorDegrees);
    expect(hard!.reactionSeconds).toBeLessThan(normal!.reactionSeconds);
    expect(normal!.reactionSeconds).toBeLessThan(easy!.reactionSeconds);
    expect(hard!.turnDegreesPerSecond).toBeGreaterThan(normal!.turnDegreesPerSecond);
    expect(hard!.dashChancePerSecond).toBeGreaterThan(easy!.dashChancePerSecond);
    expect(hard!.sightRange).toBeGreaterThan(easy!.sightRange);
  });

  it("rejects a mix that names a difficulty that does not exist", () => {
    expect(() => parseBotConfig({ ...botsJson, mix: { insane: 1 } })).toThrow(/insane/);
    expect(() => parseBotConfig({ ...botsJson, difficulties: { easy: botsJson.difficulties.easy } })).toThrow(/normal/);
  });
});

describe("bot fill", () => {
  it("tops a room up to the target, counting people, and never past the spawns", () => {
    expect(botsNeeded(12, 0, 16)).toBe(12);
    expect(botsNeeded(12, 3, 16)).toBe(9);
    expect(botsNeeded(12, 12, 16)).toBe(0);
    expect(botsNeeded(12, 14, 16)).toBe(0);
    expect(botsNeeded(40, 1, 20)).toBe(19);
  });
});

describe("fights on paper", () => {
  const a = { id: 1, x: 0, z: 0, rating: 3 };
  const b = { id: 2, x: 10, z: 0, rating: 1 };

  it("settle after the set time, and not before", () => {
    const fights = new AbstractFights();
    const random = lcg(2);
    expect(fights.update([a, b], 1, config.lod, random)).toHaveLength(0);
    expect(fights.update([a, b], 1, config.lod, random)).toHaveLength(0);
    expect(fights.update([a, b], 1.5, config.lod, random)).toHaveLength(1);
  });

  it("only count bots that are close together, and start over if they part", () => {
    const fights = new AbstractFights();
    const random = lcg(2);
    const far = { ...b, x: 500 };
    expect(fights.update([a, far], 10, config.lod, random)).toHaveLength(0);
    fights.update([a, b], 2.5, config.lod, random);
    fights.update([a, far], 1, config.lod, random); // they separated
    expect(fights.update([a, b], 2, config.lod, random)).toHaveLength(0); // the clock restarted
  });

  it("favour the stronger bot without making it certain", () => {
    const random = lcg(5);
    let strongWins = 0;
    const rounds = 600;
    for (let i = 0; i < rounds; i++) {
      const fights = new AbstractFights();
      const [result] = fights.update([a, b], 5, config.lod, random);
      if (result!.winnerId === 1) strongWins++;
    }
    expect(strongWins / rounds).toBeGreaterThan(0.65);
    expect(strongWins / rounds).toBeLessThan(0.85);
  });
});
