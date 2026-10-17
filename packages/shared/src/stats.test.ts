import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import weaponsJson from "../../../data/weapons.json";
import cameraJson from "../../../data/camera.json";
import grenadeJson from "../../../data/grenade.json";
import combatJson from "../../../data/combat.json";
import netJson from "../../../data/net.json";
import { parseCameraStats, parseCombatStats, parseGrenadeStats, parseMechStats, parseNetStats, parseWeapons, secondsToCross } from "./stats";

describe("stats", () => {
  it("accepts the shipped data files", () => {
    expect(() => parseMechStats(mechJson)).not.toThrow();
    expect(() => parseWeapons(weaponsJson)).not.toThrow();
    expect(parseWeapons(weaponsJson).weapons[parseWeapons(weaponsJson).start]!.id).toBe("autocannon");
    expect(() => parseCameraStats(cameraJson)).not.toThrow();
    expect(() => parseGrenadeStats(grenadeJson)).not.toThrow();
    expect(() => parseCombatStats(combatJson)).not.toThrow();
    expect(() => parseNetStats(netJson)).not.toThrow();
  });

  it("rejects a missing or non numeric field", () => {
    expect(() => parseMechStats({ ...mechJson, runSpeed: "fast" })).toThrow(/runSpeed/);
    const { walkSpeed: _removed, ...incomplete } = mechJson;
    expect(() => parseMechStats(incomplete)).toThrow(/walkSpeed/);
  });

  it("crossing time is distance over run speed", () => {
    const stats = parseMechStats({ ...mechJson, runSpeed: 20 });
    expect(secondsToCross(stats, 2000)).toBeCloseTo(100);
    expect(secondsToCross({ ...stats, runSpeed: 0 }, 2000)).toBe(Infinity);
  });
});
