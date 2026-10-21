import type { UpgradeDef, UpgradeEffect } from "@rustbucket/shared";

// What an upgrade does, in a few words for the HUD, worked out from its effects in data/upgrades.json so the label
// always matches the numbers: "+60% jet fuel".
const LABELS: Record<UpgradeEffect, string> = {
  fuel: "jet fuel",
  repairSpeed: "repair speed",
  lootSpeed: "loot speed",
  hearing: "hearing",
  radarRange: "radar range",
  fireRate: "fire rate",
  speed: "speed",
};

export function upgradeEffectText(def: UpgradeDef): string {
  return Object.entries(def.effects)
    .map(([effect, scale]) => {
      const percent = Math.round(((scale as number) - 1) * 100);
      return `${percent >= 0 ? "+" : ""}${percent}% ${LABELS[effect as UpgradeEffect]}`;
    })
    .join(", ");
}
