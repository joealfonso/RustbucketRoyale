import type { Loadout } from "@rustbucket/shared";
import type { PickupTextLook } from "./pickupLook";

// What a pickup just did, read from the change in your loadout between two snapshots. The loadout is the server's
// own count, so "+40 HEALTH" is the real amount the plate added, with no extra message on the wire.

export interface PickupLine {
  text: string;
  health: boolean; // drawn in the health colour
}

export interface PickupNames {
  weapons: readonly string[];
  upgrades: readonly string[];
  zones: readonly string[];
}

// Lines for everything gained from `old` to `now`, written into `out`. Only gains count: armor going down is damage,
// and a weapon going is the one you swapped out.
export function pickupLines(old: Loadout, now: Loadout, names: PickupNames, look: PickupTextLook, out: PickupLine[]): PickupLine[] {
  out.length = 0;
  now.armor.forEach((points, zone) => {
    const gained = Math.round(points - (old.armor[zone] ?? 0));
    if (gained > 0) out.push({ text: fill(look.health, gained, (names.zones[zone] ?? "").toUpperCase(), ""), health: true });
  });
  const grenades = now.grenades - old.grenades;
  if (grenades > 0) out.push({ text: fill(grenades === 1 ? look.grenade : look.grenades, grenades, "", ""), health: false });
  for (const weapon of now.slots) {
    if (weapon >= 0 && !old.slots.includes(weapon)) out.push({ text: fill(look.weapon, 0, "", names.weapons[weapon] ?? ""), health: false });
  }
  for (const upgrade of now.upgrades) {
    if (upgrade >= 0 && !old.upgrades.includes(upgrade)) out.push({ text: fill(look.upgrade, 0, "", names.upgrades[upgrade] ?? ""), health: false });
  }
  return out;
}

const fill = (template: string, n: number, zone: string, name: string) =>
  template.replace("{n}", String(n)).replace("{zone}", zone).replace("{name}", name);
