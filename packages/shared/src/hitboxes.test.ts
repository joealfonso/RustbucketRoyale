import { describe, expect, it } from "vitest";
import kitsJson from "../../../data/mechKits.json";
import rosterJson from "../../../data/roster.json";
import zonesJson from "../../../data/zones.json";
import { makeZonesFor } from "./hitboxes";
import { parseRoster } from "./roster";
import { applyDamage, createHealth, parseZones, ZONE_LEGS } from "./zones";

const zones = parseZones(zonesJson);
const roster = parseRoster(rosterJson);

describe("hit zones per mech", () => {
  it("gives each roster mech its own measured boxes", () => {
    const zonesFor = makeZonesFor(zones, roster, kitsJson);
    roster.mechs.forEach((m, mech) => {
      const kit = (kitsJson.kits as Record<string, { hitboxes?: Record<string, unknown[]> }>)[m.id]!;
      const expected = Object.values(kit.hitboxes!).reduce((n, list) => n + list.length, 0);
      expect(zonesFor(mech).boxes).toHaveLength(expected);
    });
    expect(zonesFor(2).boxes).not.toEqual(zonesFor(3).boxes);
  });

  it("reads hit points and the other numbers live from zones.json, so tuning still reaches them", () => {
    const live = parseZones(zonesJson);
    const zonesFor = makeZonesFor(live, roster, kitsJson);
    live.zones[0]!.hp = 999;
    live.repairSeconds = 42;
    expect(zonesFor(1).zones[0]!.hp).toBe(999);
    expect(zonesFor(1).repairSeconds).toBe(42);
  });

  it("makes a tough mech take less from the same hit, read live from the roster", () => {
    const live = parseRoster(rosterJson);
    const zonesFor = makeZonesFor(zones, live, kitsJson);
    const ironclad = live.mechs.findIndex((m) => m.id === "ironclad");
    const stiletto = live.mechs.findIndex((m) => m.id === "stiletto");
    const taken = (mech: number) => applyDamage(createHealth(zones), zonesFor(mech), ZONE_LEGS, 20);
    expect(taken(ironclad)).toBeLessThan(taken(stiletto));
    live.mechs[ironclad]!.damageTaken.legs = 2;
    expect(taken(ironclad)).toBe(40);
  });

  it("falls back to the standard zones with no roster, and for a mech number out of range", () => {
    expect(makeZonesFor(zones, null, kitsJson)(5)).toBe(zones);
    const zonesFor = makeZonesFor(zones, roster, kitsJson);
    expect(zonesFor(99)).toBe(zonesFor(0));
  });

  it("lists the same mechs, in the same order, as the kits the client draws", () => {
    expect(roster.mechs.map((m) => m.id)).toEqual(kitsJson.roster);
  });
});
