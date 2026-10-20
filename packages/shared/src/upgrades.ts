import type { Loadout } from "./protocol";

// What an upgrade can change. Each is a multiplier, 1 meaning no change.
export const UPGRADE_EFFECTS = ["fuel", "repairSpeed", "lootSpeed", "hearing", "radarRange", "fireRate", "speed"] as const;
export type UpgradeEffect = (typeof UPGRADE_EFFECTS)[number];

export interface UpgradeDef {
  id: string;
  name: string;
  color: string;
  effects: Partial<Record<UpgradeEffect, number>>;
  model: string | null; // art hook: the part bolted on the mech
}

export interface UpgradeSet {
  slots: number; // how many a mech carries at once
  upgrades: UpgradeDef[];
}

export function parseUpgrades(raw: unknown): UpgradeSet {
  const d = raw as { slots?: unknown; upgrades?: unknown };
  if (d?.slots !== 2) throw new Error("upgrades.json: slots must be 2 (the loadout and the wire format hold two)");
  if (!Array.isArray(d.upgrades) || d.upgrades.length === 0 || d.upgrades.length > 32) throw new Error("upgrades.json: needs 1 to 32 upgrades");
  for (const u of d.upgrades as Record<string, unknown>[]) {
    if (typeof u.id !== "string" || typeof u.name !== "string" || typeof u.color !== "string") throw new Error(`upgrades.json: ${String(u.id)} needs id, name and color`);
    const effects = u.effects as Record<string, unknown> | undefined;
    if (!effects || Object.keys(effects).length === 0) throw new Error(`upgrades.json: ${u.id} has no effects`);
    for (const [key, value] of Object.entries(effects)) {
      if (!(UPGRADE_EFFECTS as readonly string[]).includes(key)) throw new Error(`upgrades.json: ${u.id} has unknown effect "${key}"`);
      if (typeof value !== "number" || !(value > 0)) throw new Error(`upgrades.json: ${u.id} ${key} must be above 0`);
    }
  }
  return d as UpgradeSet;
}

// The combined multiplier for one effect from everything fitted. 1 with nothing fitted.
export function upgradeScale(l: Pick<Loadout, "upgrades">, set: UpgradeSet, effect: UpgradeEffect): number {
  let scale = 1;
  for (const u of l.upgrades) if (u >= 0) scale *= set.upgrades[u]?.effects[effect] ?? 1;
  return scale;
}
