import { describe, expect, it } from "vitest";
import type { Loadout } from "@rustbucket/shared";
import { parsePickupLook } from "./pickupLook";
import { pickupLines, type PickupLine } from "./pickupText";
import pickupLookJson from "../../../data/pickupLook.json";

const look = parsePickupLook(pickupLookJson).text;
const names = { weapons: ["Autocannon", "Scattergun"], upgrades: ["Big Tanks", "Quick Hands"], zones: ["legs", "arms", "torso"] };
const base = (): Loadout => ({ slots: [0, -1], active: 0, grenades: 1, armor: [0, 0, 0], upgrades: [-1, -1] });
const texts = (old: Loadout, now: Loadout) => pickupLines(old, now, names, look, [] as PickupLine[]).map((l) => l.text);

describe("pickup lines", () => {
  it("says the real amount a plate added, on the part it went on", () => {
    const now = { ...base(), armor: [0, 0, 40] };
    const lines = pickupLines(base(), now, names, look, []);
    expect(lines).toEqual([{ text: "+40 HEALTH · TORSO", health: true }]);
  });

  it("counts only what was missing when a dented plate is replaced", () => {
    expect(texts({ ...base(), armor: [12, 0, 0] }, { ...base(), armor: [30, 0, 0] })).toEqual(["+18 HEALTH · LEGS"]);
  });

  it("names grenades, weapons and upgrades", () => {
    expect(texts(base(), { ...base(), grenades: 2 })).toEqual(["+1 GRENADE"]);
    expect(texts(base(), { ...base(), grenades: 3 })).toEqual(["+2 GRENADES"]);
    expect(texts(base(), { ...base(), slots: [0, 1] })).toEqual(["Scattergun"]);
    expect(texts(base(), { ...base(), upgrades: [1, -1] })).toEqual(["Quick Hands"]);
  });

  it("says nothing for losses: damage, a thrown grenade, a swapped out weapon", () => {
    const old = { ...base(), slots: [0, 1] as [number, number], grenades: 2, armor: [30, 30, 40] };
    expect(texts(old, { ...old, grenades: 1, armor: [10, 30, 0] })).toEqual([]);
    expect(texts(old, { ...old, slots: [0, -1] })).toEqual([]);
  });

  it("rejects a look file with a missing line", () => {
    expect(() => parsePickupLook({ ...pickupLookJson, text: { ...pickupLookJson.text, health: "" } })).toThrow(/pickupLook.json/);
  });
});
