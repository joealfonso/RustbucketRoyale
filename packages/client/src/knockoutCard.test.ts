import { describe, expect, it } from "vitest";
import abilitiesJson from "../../../data/abilities.json";
import rosterJson from "../../../data/roster.json";
import weaponsJson from "../../../data/weapons.json";
import { parseAbilities, parseRoster, parseWeapons } from "@rustbucket/shared";
import { knockoutWords, statLines, type Names } from "./knockoutCard";

const roster = parseRoster(rosterJson);
const names: Names = {
  roster, weapons: parseWeapons(weaponsJson), abilities: parseAbilities(abilitiesJson),
  player: (id) => (id === 1 ? "You" : `Bot ${id}`), selfId: 1,
};
const stiletto = roster.mechs.findIndex((m) => m.id === "stiletto");

describe("knockout card", () => {
  it("says who, in what mech, and how, oldest cause first", () => {
    const w = knockoutWords(12, { killerMech: stiletto, killerBot: true, causes: ["ability:pounce", "weapon:scattergun"] }, names);
    expect(w.by).toBe("by Bot 12, Stiletto-B (bot)");
    expect(w.how).toBe("Pounce, then Scattergun");
  });

  it("names the zone, and copes with an old server that sends no details", () => {
    expect(knockoutWords(null, { killerMech: -1, killerBot: false, causes: ["ring"] }, names).by).toBe("by The zone");
    expect(knockoutWords(7, undefined, names)).toEqual({ title: "Knocked out", by: "by Bot 7", how: "" });
    expect(knockoutWords(null, { killerMech: -1, killerBot: false, causes: [] }, names).by).toBe(""); // a fall
    expect(knockoutWords(1, { killerMech: 0, killerBot: false, causes: ["grenade"] }, names).by).toBe("by your own Grenade");
  });

  it("writes the match's fun stats with who scored them", () => {
    expect(statLines([{ kind: "longestPounce", playerId: 4, value: 31.4 }, { kind: "treesFelled", playerId: 1, value: 6 }], names.player))
      .toEqual(["Longest pounce: 31 m, Bot 4", "Trees felled: 6, You"]);
  });
});
