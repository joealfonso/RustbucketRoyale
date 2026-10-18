import { describe, expect, it } from "vitest";
import kitsJson from "../../../data/mechKits.json";
import zonesJson from "../../../data/zones.json";
import { makeZonesFor } from "./hitboxes";
import { parseZones } from "./zones";

const zones = parseZones(zonesJson);

describe("hit boxes per mech", () => {
  it("gives each player their roster mech's boxes, by player number", () => {
    const zonesFor = makeZonesFor(zones, kitsJson);
    const roster = kitsJson.roster;
    for (let id = 0; id < roster.length * 2; id++) {
      const kit = (kitsJson.kits as Record<string, { hitboxes?: Record<string, unknown[]> }>)[roster[id % roster.length]!]!;
      const expected = Object.values(kit.hitboxes!).reduce((n, list) => n + list.length, 0);
      expect(zonesFor(id).boxes).toHaveLength(expected);
    }
    expect(zonesFor(2).boxes).not.toEqual(zonesFor(3).boxes);
  });

  it("reads hit points live from zones.json, so tuning still reaches them", () => {
    const live = parseZones(zonesJson);
    const zonesFor = makeZonesFor(live, kitsJson);
    live.zones[0]!.hp = 999;
    expect(zonesFor(1).zones[0]!.hp).toBe(999);
  });

  it("falls back to the standard boxes with no roster", () => {
    expect(makeZonesFor(zones, { kits: {} })(5)).toBe(zones);
  });
});
