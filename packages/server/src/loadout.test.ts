import { describe, expect, it } from "vitest";
import lootJson from "../../../data/loot.json";
import propsJson from "../../../data/props.json";
import weaponsJson from "../../../data/weapons.json";
import { ITEM_ARMOR_FIRST, ITEM_GRENADE, parseLootConfig, parsePropConfig, parseWeapons, weaponItem } from "@rustbucket/shared";
import { activeWeapon, collectSmall, freshLoadout, selectSlot, takeWeapon } from "./loadout";

const weapons = parseWeapons(weaponsJson);
const loot = parseLootConfig(lootJson, weapons, parsePropConfig(propsJson));
const SCATTER = weapons.weapons.findIndex((w) => w.id === "scattergun");
const SPIKE = weapons.weapons.findIndex((w) => w.id === "spikeDriver");

describe("loadout", () => {
  it("starts with the start weapon in slot 1, nothing in slot 2, the starting grenades and no armor", () => {
    const l = freshLoadout(weapons, loot);
    expect(l.slots).toEqual([weapons.start, -1]);
    expect(activeWeapon(l)).toBe(weapons.start);
    expect(l.grenades).toBe(loot.grenadesStart);
    expect(l.armor).toEqual([0, 0, 0]);
  });

  it("cannot switch to an empty slot", () => {
    const l = freshLoadout(weapons, loot);
    expect(selectSlot(l, 1)).toBe(false);
    expect(l.active).toBe(0);
  });

  it("takes a weapon into the empty slot and puts it in hand, then swaps out the one in hand when both are full", () => {
    const l = freshLoadout(weapons, loot);
    expect(takeWeapon(l, weaponItem(SCATTER))).toBe(-1);
    expect(l.slots).toEqual([weapons.start, SCATTER]);
    expect(l.active).toBe(1);
    expect(selectSlot(l, 0)).toBe(true);
    expect(takeWeapon(l, weaponItem(SPIKE))).toBe(weapons.start); // the autocannon in hand is dropped
    expect(l.slots).toEqual([SPIKE, SCATTER]);
  });

  it("collects grenades up to the cap and a plate only when that zone's is not full", () => {
    const l = freshLoadout(weapons, loot);
    for (let i = 0; i < 10; i++) collectSmall(l, ITEM_GRENADE, loot);
    expect(l.grenades).toBe(loot.grenadesMax);
    expect(collectSmall(l, ITEM_GRENADE, loot)).toBe(false);
    expect(collectSmall(l, ITEM_ARMOR_FIRST + 2, loot)).toBe(true);
    expect(l.armor[2]).toBe(loot.armorPlates[2]);
    expect(collectSmall(l, ITEM_ARMOR_FIRST + 2, loot)).toBe(false);
    l.armor[2] = 5;
    expect(collectSmall(l, ITEM_ARMOR_FIRST + 2, loot)).toBe(true); // a dented plate gets replaced
  });

  it("does not collect a weapon by walking over it", () => {
    expect(collectSmall(freshLoadout(weapons, loot), weaponItem(SCATTER), loot)).toBe(false);
  });
});
