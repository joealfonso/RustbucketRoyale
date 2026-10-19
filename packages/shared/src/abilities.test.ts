import { describe, expect, it } from "vitest";
import abilitiesJson from "../../../data/abilities.json";
import rosterJson from "../../../data/roster.json";
import { abilityFor, parseAbilities } from "./abilities";
import { parseRoster } from "./roster";

const roster = parseRoster(rosterJson);
const byId = (id: string) => roster.mechs.findIndex((m) => m.id === id);
const raw = () => JSON.parse(JSON.stringify(abilitiesJson));

describe("abilities", () => {
  it("gives Ironclad a ram, Stiletto a pounce, and the other two nothing yet", () => {
    const forMech = abilityFor(parseAbilities(abilitiesJson), roster);
    expect(forMech(byId("ironclad"))).toMatchObject({ kind: "ram", name: "Shield Ram" });
    expect(forMech(byId("stiletto"))).toMatchObject({ kind: "pounce", name: "Pounce" });
    expect(forMech(byId("cataclysm"))).toBeNull();
    expect(forMech(byId("arbiter"))).toBeNull();
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

  it("never shares objects with the raw file", () => {
    const file = raw();
    const set = parseAbilities(file);
    file.mechs.ironclad.speed = 99;
    expect(set.mechs.ironclad!.speed).toBe(abilitiesJson.mechs.ironclad.speed);
  });

  it("follows a number tuned into the set in place", () => {
    const set = parseAbilities(abilitiesJson);
    const forMech = abilityFor(set, roster);
    (set.mechs.ironclad as { speed: number }).speed = 40;
    expect(forMech(byId("ironclad"))!.speed).toBe(40);
  });
});
