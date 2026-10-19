import { describe, expect, it } from "vitest";
import abilitiesJson from "../../../data/abilities.json";
import rosterJson from "../../../data/roster.json";
import { abilityFor, parseAbilities, type RamStats } from "./abilities";
import { parseRoster } from "./roster";

const roster = parseRoster(rosterJson);
const byId = (id: string) => roster.mechs.findIndex((m) => m.id === id);
const raw = () => JSON.parse(JSON.stringify(abilitiesJson));

describe("abilities", () => {
  it("gives each roster mech its own ability", () => {
    const forMech = abilityFor(parseAbilities(abilitiesJson), roster);
    expect(forMech(byId("ironclad"))).toMatchObject({ kind: "ram", name: "Shield Ram" });
    expect(forMech(byId("stiletto"))).toMatchObject({ kind: "pounce", name: "Pounce" });
    expect(forMech(byId("cataclysm"))).toMatchObject({ kind: "barrage", name: "Mortar Strike", shells: 3 });
    expect(forMech(byId("arbiter"))).toMatchObject({ kind: "decoy", name: "Decoy Drones", count: 2 });
  });

  it("gives nobody an ability without a roster", () => {
    expect(abilityFor(parseAbilities(abilitiesJson), null)(0)).toBeNull();
  });

  it("refuses bad data loudly", () => {
    expect(() => parseAbilities({})).toThrow();
    const badKind = raw(); badKind.mechs.ironclad.kind = "laser";
    expect(() => parseAbilities(badKind)).toThrow(/kind/);
    const noSpeed = raw(); delete noSpeed.mechs.stiletto.speed;
    expect(() => parseAbilities(noSpeed)).toThrow(/speed/);
    const zeroCooldown = raw(); zeroCooldown.mechs.ironclad.cooldownSeconds = 0;
    expect(() => parseAbilities(zeroCooldown)).toThrow(/cooldownSeconds/);
    const negativeDamage = raw(); negativeDamage.mechs.stiletto.damage = -1;
    expect(() => parseAbilities(negativeDamage)).toThrow(/damage/);
  });

  it("refuses a fraction of a shell or a decoy, none at all, or a strike range that is back to front", () => {
    const halfShell = raw(); halfShell.mechs.cataclysm.shells = 2.5;
    expect(() => parseAbilities(halfShell)).toThrow(/shells/);
    const noShells = raw(); noShells.mechs.cataclysm.shells = 0;
    expect(() => parseAbilities(noShells)).toThrow(/shells/);
    const halfDecoy = raw(); halfDecoy.mechs.arbiter.count = 1.5;
    expect(() => parseAbilities(halfDecoy)).toThrow(/count/);
    const noDecoys = raw(); noDecoys.mechs.arbiter.count = 0;
    expect(() => parseAbilities(noDecoys)).toThrow(/count/);
    const backwards = raw(); backwards.mechs.cataclysm.minRange = 200;
    expect(() => parseAbilities(backwards)).toThrow(/minRange/);
    const same = raw(); same.mechs.cataclysm.minRange = same.mechs.cataclysm.maxRange;
    expect(() => parseAbilities(same)).toThrow(/minRange/);
    const noLife = raw(); delete noLife.mechs.arbiter.lifeSeconds;
    expect(() => parseAbilities(noLife)).toThrow(/lifeSeconds/);
    const negativeSpread = raw(); negativeSpread.mechs.arbiter.spreadDegrees = -5;
    expect(() => parseAbilities(negativeSpread)).toThrow(/spreadDegrees/);
  });

  it("never shares objects with the raw file", () => {
    const file = raw();
    const set = parseAbilities(file);
    file.mechs.ironclad.speed = 99;
    expect((set.mechs.ironclad as RamStats).speed).toBe(abilitiesJson.mechs.ironclad.speed);
  });

  it("follows a number tuned into the set in place", () => {
    const set = parseAbilities(abilitiesJson);
    const forMech = abilityFor(set, roster);
    (set.mechs.ironclad as { speed: number }).speed = 40;
    expect((forMech(byId("ironclad")) as RamStats).speed).toBe(40);
  });
});
