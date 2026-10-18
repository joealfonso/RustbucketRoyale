import type { PropConfig } from "./props";
import type { WeaponSet } from "./stats";

// What can lie on the ground. The first four are fixed, then one per weapon, in weapons.json order.
export const ITEM_GRENADE = 0;
export const ITEM_ARMOR_FIRST = 1; // legs, arms, torso: one plate item per hit zone
export const ITEM_WEAPON_FIRST = 4;
export const ITEM_UPGRADE_FIRST = 64; // weapons fit in between, upgrades after

export interface LootDrop {
  chance: number;
  table: Record<string, number>; // "grenade", "armor" (a plate for a random zone), "upgrade" (a random one) or a weapon id, by weight
}

export interface LootConfig {
  grenadesStart: number;
  grenadesMax: number;
  armorPlates: number[]; // points of one plate on legs, arms, torso
  pickupRadius: number; // small things are collected by walking within this
  interactRange: number; // weapons are taken with E within this
  interactCooldownSeconds: number;
  wreckLootSeconds: number; // E held this long beside a wreck spills what it carried
  spillRadius: number; // how far round a looted wreck its things land
  switchSeconds: number; // a short pause after changing weapon before it can fire
  maxPickups: number;
  colors: { grenade: string; armor: string };
  drops: Record<string, LootDrop>;
}

export function parseLootConfig(raw: unknown, weapons: WeaponSet, props: PropConfig): LootConfig {
  const d = raw as Record<string, unknown>;
  for (const key of ["grenadesStart", "grenadesMax", "pickupRadius", "interactRange", "interactCooldownSeconds", "wreckLootSeconds", "spillRadius", "switchSeconds", "maxPickups"]) {
    if (typeof d?.[key] !== "number" || !Number.isFinite(d[key])) throw new Error(`loot.json: ${key} must be a number`);
  }
  if (!Array.isArray(d.armorPlates) || d.armorPlates.length !== 3) throw new Error("loot.json: armorPlates needs legs, arms, torso");
  const drops = d.drops as Record<string, LootDrop> | undefined;
  for (const prop of props.types) {
    const drop = drops?.[prop.id];
    if (!drop || typeof drop.chance !== "number") throw new Error(`loot.json: needs a drop for prop "${prop.id}"`);
    // Map validation counts loot props from props.json, so the two files have to agree on which props drop anything.
    if (prop.dropsLoot !== drop.chance > 0) throw new Error(`loot.json: ${prop.id} drop chance disagrees with dropsLoot in props.json`);
    for (const name of Object.keys(drop.table)) {
      if (name !== "grenade" && name !== "armor" && name !== "upgrade" && !weapons.weapons.some((w) => w.id === name)) throw new Error(`loot.json: ${prop.id} drops unknown item "${name}"`);
    }
  }
  return d as unknown as LootConfig;
}

export const weaponItem = (weapon: number) => ITEM_WEAPON_FIRST + weapon;
export const itemWeapon = (item: number) => (item >= ITEM_WEAPON_FIRST && item < ITEM_UPGRADE_FIRST ? item - ITEM_WEAPON_FIRST : -1);
export const upgradeItem = (upgrade: number) => ITEM_UPGRADE_FIRST + upgrade;
export const itemUpgrade = (item: number) => (item >= ITEM_UPGRADE_FIRST ? item - ITEM_UPGRADE_FIRST : -1);
// Weapons and upgrades are taken with E. Everything else is walked over.
export const takenWithE = (item: number) => item >= ITEM_WEAPON_FIRST;
export const itemArmorZone = (item: number) => (item >= ITEM_ARMOR_FIRST && item < ITEM_WEAPON_FIRST ? item - ITEM_ARMOR_FIRST : -1);

// Picks what a broken prop drops, if anything. `random` returns a number from 0 up to but not including 1.
export function rollLoot(loot: LootConfig, weapons: WeaponSet, upgradeCount: number, propId: string, random: () => number): number | null {
  const drop = loot.drops[propId];
  if (!drop || random() >= drop.chance) return null;
  const entries = Object.entries(drop.table);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return null;
  let roll = random() * total;
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll >= 0) continue;
    if (name === "grenade") return ITEM_GRENADE;
    if (name === "armor") return ITEM_ARMOR_FIRST + Math.floor(random() * 3);
    if (name === "upgrade") return upgradeItem(Math.floor(random() * upgradeCount));
    return weaponItem(weapons.weapons.findIndex((w) => w.id === name));
  }
  return null;
}
