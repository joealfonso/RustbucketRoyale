import { describe, expect, it } from "vitest";
import kitsJson from "../../../data/mechKits.json";
import rosterJson from "../../../data/roster.json";
import { makeMuzzlesFor, STANDARD_MUZZLE } from "./muzzles";
import { parseRoster } from "./roster";
import { computeShot, createShot } from "./weapon";
import { createMechState } from "./mechStep";
import { parseMechStats, parseWeapons } from "./stats";
import mechJson from "../../../data/mech.json";
import weaponsJson from "../../../data/weapons.json";

const roster = parseRoster(rosterJson);
const index = (id: string) => roster.mechs.findIndex((m) => m.id === id);

describe("muzzles", () => {
  const muzzlesFor = makeMuzzlesFor(roster, kitsJson);

  it("gives each roster mech its own gun: Stiletto's on the left, Cataclysm's up on the mortar, two for Arbiter", () => {
    expect(muzzlesFor(index("stiletto"))[0]![0]).toBeLessThan(0);
    expect(muzzlesFor(index("cataclysm"))[0]![1]).toBeGreaterThan(3.5);
    expect(muzzlesFor(index("arbiter"))).toHaveLength(2);
    expect(muzzlesFor(index("ironclad"))[0]![0]).toBeGreaterThan(0);
  });

  it("falls back to the standard spot without a roster or marked muzzles", () => {
    expect(makeMuzzlesFor(null, kitsJson)(2)).toEqual([STANDARD_MUZZLE]);
    expect(makeMuzzlesFor(roster, { kits: {} })(1)).toEqual([STANDARD_MUZZLE]);
  });

  it("starts a shot at the muzzle, turned with the mech", () => {
    const mech = createMechState(parseMechStats(mechJson), 10, 0, 20, Math.PI); // facing +z
    const shot = createShot();
    const weapon = parseWeapons(weaponsJson).weapons[0]!;
    computeShot(mech, 10, 2, 100, weapon, () => 0.5, shot, 1, [-1.2, 2.2, -1.2]);
    // Turned half round, the mech's left (-x) is world +x and its front (-z) is world +z.
    expect(shot.ox).toBeCloseTo(11.2, 5);
    expect(shot.oy).toBeCloseTo(2.2, 5);
    expect(shot.oz).toBeCloseTo(21.2, 5);
  });
});
