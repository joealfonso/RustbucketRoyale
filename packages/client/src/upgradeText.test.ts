import { describe, expect, it } from "vitest";
import { parseUpgrades } from "@rustbucket/shared";
import upgradesJson from "../../../data/upgrades.json";
import { upgradeEffectText } from "./upgradeText";

describe("upgrade effect text", () => {
  it("says each effect as a percent change", () => {
    const set = parseUpgrades(upgradesJson);
    const byId = (id: string) => set.upgrades.find((u) => u.id === id)!;
    expect(upgradeEffectText(byId("bigTanks"))).toBe("+60% jet fuel");
    expect(upgradeEffectText(byId("bigEars"))).toBe("+60% hearing, +100% radar range");
  });

  it("has words for every upgrade in the data", () => {
    for (const u of parseUpgrades(upgradesJson).upgrades) expect(upgradeEffectText(u)).not.toContain("undefined");
  });
});
