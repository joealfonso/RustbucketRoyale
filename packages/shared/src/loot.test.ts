import { describe, expect, it } from "vitest";
import lootJson from "../../../data/loot.json";
import propsJson from "../../../data/props.json";
import weaponsJson from "../../../data/weapons.json";
import { ITEM_GRENADE, itemArmorZone, itemWeapon, parseLootConfig, rollLoot } from "./loot";
import { parsePropConfig } from "./props";
import { parseWeapons } from "./stats";

const weapons = parseWeapons(weaponsJson);
const props = parsePropConfig(propsJson);
const loot = parseLootConfig(lootJson, weapons, props);

function lcg(seed: number): () => number {
  let a = seed;
  return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe("loot rolls", () => {
  it("drop about as often as the data says, and only items from the table", () => {
    const random = lcg(3);
    let drops = 0;
    const kinds = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const item = rollLoot(loot, weapons, "crate", random);
      if (item === null) continue;
      drops++;
      kinds.add(item === ITEM_GRENADE ? "grenade" : itemArmorZone(item) >= 0 ? "armor" : weapons.weapons[itemWeapon(item)]!.id);
    }
    expect(drops / 4000).toBeCloseTo(loot.drops.crate!.chance, 1);
    expect([...kinds].sort()).toEqual(Object.keys(loot.drops.crate!.table).sort());
  });

  it("barrels drop nothing", () => {
    const random = lcg(4);
    for (let i = 0; i < 200; i++) expect(rollLoot(loot, weapons, "barrel", random)).toBeNull();
  });

  it("rejects a table naming something that does not exist", () => {
    expect(() => parseLootConfig({ ...lootJson, drops: { ...lootJson.drops, crate: { chance: 1, table: { laser: 1 } } } }, weapons, props)).toThrow(/laser/);
  });
});
