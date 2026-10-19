import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import rosterJson from "../../../data/roster.json";
import { mechStatsFor, parseRoster, rosterIndex } from "./roster";
import { parseMechStats } from "./stats";

const roster = parseRoster(rosterJson);
const byId = (id: string) => roster.mechs.findIndex((m) => m.id === id);

describe("roster", () => {
  it("scales speed, fuel and lift from the shared mech numbers and leaves the rest alone", () => {
    const base = parseMechStats(mechJson);
    const statsFor = mechStatsFor(base, roster);
    const stiletto = statsFor(byId("stiletto"));
    const m = roster.mechs[byId("stiletto")]!;
    expect(stiletto.runSpeed).toBeCloseTo(base.runSpeed * m.speed);
    expect(stiletto.fuelMax).toBeCloseTo(base.fuelMax * m.jets);
    expect(stiletto.jetLift).toBeCloseTo(base.jetLift * m.lift);
    expect(stiletto.gravity).toBe(base.gravity);
    expect(statsFor(byId("cataclysm")).runSpeed).toBeLessThan(stiletto.runSpeed);
  });

  it("follows tuning of both the base and the roster live", () => {
    const base = parseMechStats(mechJson);
    const live = parseRoster(JSON.parse(JSON.stringify(rosterJson)));
    const ironclad = mechStatsFor(base, live)(0);
    base.runSpeed = 10;
    live.mechs[0]!.speed = 2;
    expect(ironclad.runSpeed).toBe(20);
    base.dashSpeed = 99;
    expect(ironclad.dashSpeed).toBe(99);
  });

  it("gives everyone the base numbers without a roster", () => {
    const base = parseMechStats(mechJson);
    expect(mechStatsFor(base, null)(3)).toBe(base);
  });

  it("never lets a bad mech number index past the roster", () => {
    expect(rosterIndex(roster, 2)).toBe(2);
    for (const bad of [-1, 4, 1.5, Number.NaN]) expect(rosterIndex(roster, bad)).toBe(0);
  });

  it("refuses a broken file", () => {
    expect(() => parseRoster({ mechs: [] })).toThrow();
    expect(() => parseRoster({ mechs: [{ ...rosterJson.mechs[0], speed: 0 }] })).toThrow();
    expect(() => parseRoster({ mechs: Array(5).fill(rosterJson.mechs[0]) })).toThrow();
  });
});
