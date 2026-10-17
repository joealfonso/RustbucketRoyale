import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import weaponJson from "../../../data/weapon.json";
import cameraJson from "../../../data/camera.json";
import { parseCameraStats, parseMechStats, parseWeaponStats, secondsToCross } from "./stats";

describe("stats", () => {
  it("accepts the shipped data files", () => {
    expect(() => parseMechStats(mechJson)).not.toThrow();
    expect(() => parseWeaponStats(weaponJson)).not.toThrow();
    expect(() => parseCameraStats(cameraJson)).not.toThrow();
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
