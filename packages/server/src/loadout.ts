import { ITEM_GRENADE, itemArmorZone, itemWeapon, type Loadout, type LootConfig, type WeaponSet } from "@rustbucket/shared";

// What a mech carries and the rules for changing it. Plain functions on plain data, so they are easy to test.

export function freshLoadout(weapons: WeaponSet, loot: LootConfig): Loadout {
  return { slots: [weapons.start, -1], active: 0, grenades: loot.grenadesStart, armor: [0, 0, 0] };
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
