import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import weaponsJson from "../../../data/weapons.json";
import grenadeJson from "../../../data/grenade.json";
import zonesJson from "../../../data/zones.json";
import lootJson from "../../../data/loot.json";
import upgradesJson from "../../../data/upgrades.json";
import botsJson from "../../../data/bots.json";
import noiseJson from "../../../data/noise.json";
import combatJson from "../../../data/combat.json";
import propsJson from "../../../data/props.json";
import rosterJson from "../../../data/roster.json";
import abilitiesJson from "../../../data/abilities.json";
import { applyTune, assignDeep, parseTunable, setNumberAt, TUNABLE_FILES, type TuningRaws } from "./tuning";
import type { WeaponSet } from "./stats";
import type { ZoneSet } from "./zones";

const raws = (): TuningRaws => JSON.parse(JSON.stringify({
  mech: mechJson, weapons: weaponsJson, grenade: grenadeJson, zones: zonesJson, loot: lootJson, upgrades: upgradesJson,
  bots: botsJson, noise: noiseJson, combat: combatJson, roster: rosterJson, abilities: abilitiesJson, props: propsJson,
}));

describe("live tuning", () => {
  it("parses every tunable file from its raw JSON", () => {
    const r = raws();
    for (const file of TUNABLE_FILES) expect(parseTunable(file, r)).toBeTruthy();
  });

  it("changes only numbers that are already there", () => {
    const r = raws();
    expect(setNumberAt(r.weapons, "weapons.1.damage", 99)).not.toBeNull();
    expect((r.weapons as { weapons: { damage: number }[] }).weapons[1]!.damage).toBe(99);
    expect(setNumberAt(r.weapons, "weapons.1.name", 5)).toBeNull();
    expect(setNumberAt(r.weapons, "weapons.9.damage", 5)).toBeNull();
    expect(setNumberAt(r.mech, "laserEyes", 5)).toBeNull();
    expect(setNumberAt(r.mech, "walkSpeed", Number.NaN)).toBeNull();
  });

  it("refuses a value the file's own checks refuse, and leaves the file as it was", () => {
    const r = raws();
    const before = (r.zones as { damagedBelowFraction: number }).damagedBelowFraction;
    expect(applyTune(r, "zones", "damagedBelowFraction", 2)).toBeNull();
    expect((r.zones as { damagedBelowFraction: number }).damagedBelowFraction).toBe(before);
    expect(applyTune(r, "chunks", "size", 5)).toBeNull(); // map files are not tunable
  });

  it("updates the live values in place, so anything holding them sees the change", () => {
    const r = raws();
    const live = parseTunable("weapons", r) as WeaponSet;
    const held = live.weapons[0]!;
    assignDeep(live, applyTune(r, "weapons", "weapons.0.damage", 77));
    expect(held.damage).toBe(77);
    const zones = parseTunable("zones", r) as ZoneSet;
    assignDeep(zones, applyTune(r, "zones", "zones.0.hp", 80));
    expect(zones.zones[0]!.hp).toBe(80);
  });
});
