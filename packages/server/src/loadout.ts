import { ITEM_ARMOR_FIRST, ITEM_GRENADE, itemArmorZone, itemUpgrade, itemWeapon, upgradeItem, weaponItem, type Loadout, type LootConfig, type WeaponSet } from "@rustbucket/shared";

// What a mech carries and the rules for changing it. Plain functions on plain data, so they are easy to test.

export function freshLoadout(weapons: WeaponSet, loot: LootConfig): Loadout {
  return { slots: [weapons.start, -1], active: 0, grenades: loot.grenadesStart, armor: [0, 0, 0], upgrades: [-1, -1] };
}

export function activeWeapon(l: Loadout): number {
  return l.slots[l.active] ?? -1;
}

// Changes the weapon in hand. Returns true if it changed, so the caller can add the short switch pause.
export function selectSlot(l: Loadout, slot: number): boolean {
  if (slot !== 0 && slot !== 1) return false;
  if (slot === l.active || l.slots[slot]! < 0) return false;
  l.active = slot;
  return true;
}

// A small item walked over. Taken only if it is any use: a grenade when there is room, a plate when that zone's is
// not already full. Returns true if it was taken.
export function collectSmall(l: Loadout, item: number, loot: LootConfig): boolean {
  if (item === ITEM_GRENADE) {
    if (l.grenades >= loot.grenadesMax) return false;
    l.grenades++;
    return true;
  }
  const zone = itemArmorZone(item);
  if (zone < 0) return false;
  const plate = loot.armorPlates[zone]!;
  if (l.armor[zone]! >= plate) return false;
  l.armor[zone] = plate;
  return true;
}

// A weapon taken with E. An empty slot is filled and becomes the one in hand. With both full, the weapon in hand is
// swapped out. Returns the weapon that was dropped, or -1 if none.
export function takeWeapon(l: Loadout, item: number): number {
  const weapon = itemWeapon(item);
  if (weapon < 0) return -1;
  const empty = l.slots.indexOf(-1);
  if (empty >= 0) {
    l.slots[empty] = weapon;
    l.active = empty;
    return -1;
  }
  const dropped = l.slots[l.active]!;
  l.slots[l.active] = weapon;
  return dropped;
}

// An upgrade taken with E. It goes in an empty socket, or with both full the one fitted first comes off. One of a
// kind: a second of the same is refused. Returns the upgrade that came off, -1 if none, or null if it was refused.
export function takeUpgrade(l: Loadout, item: number): number | null {
  const upgrade = itemUpgrade(item);
  if (upgrade < 0 || l.upgrades.includes(upgrade)) return null;
  const empty = l.upgrades.indexOf(-1);
  if (empty >= 0) {
    l.upgrades[empty] = upgrade;
    return -1;
  }
  const dropped = l.upgrades[0];
  l.upgrades = [l.upgrades[1], upgrade];
  return dropped;
}

// What a looted wreck spills: every weapon and upgrade it carried, each grenade, and a plate for each zone that still had one.
export function spillItems(l: Loadout): number[] {
  const items: number[] = [];
  for (const weapon of l.slots) if (weapon >= 0) items.push(weaponItem(weapon));
  for (const upgrade of l.upgrades) if (upgrade >= 0) items.push(upgradeItem(upgrade));
  for (let i = 0; i < l.grenades; i++) items.push(ITEM_GRENADE);
  l.armor.forEach((points, zone) => { if (points > 0) items.push(ITEM_ARMOR_FIRST + zone); });
  return items;
}

// Whether a pickup is any use to someone carrying this, so a bot only goes for things it would actually take.
export function wantsItem(l: Loadout, item: number, loot: LootConfig): boolean {
  if (item === ITEM_GRENADE) return l.grenades < loot.grenadesMax;
  const zone = itemArmorZone(item);
  if (zone >= 0) return l.armor[zone]! < loot.armorPlates[zone]!;
  const upgrade = itemUpgrade(item);
  if (upgrade >= 0) return l.upgrades.includes(-1) && !l.upgrades.includes(upgrade);
  return itemWeapon(item) >= 0 && l.slots.includes(-1);
}
