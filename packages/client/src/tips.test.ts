import { describe, expect, it } from "vitest";
import tipsJson from "../../../data/tips.json";
import { Tips, parseTips, type TipId, type TipStore } from "./tips";

const memory = (start: TipId[] = []): TipStore & { ids: TipId[] } => {
  const s = { ids: [...start], load: () => [...s.ids], save: (ids: TipId[]) => { s.ids = ids; } };
  return s;
};
const config = parseTips(tipsJson);

describe("tips", () => {
  it("shows a tip once, for its time, and never again in this browser", () => {
    const store = memory();
    const tips = new Tips(config, store);
    tips.offer("ability", "Decoy drones");
    expect(tips.current(0.1)).toBe("Q: Decoy drones ready");
    expect(tips.current(config.showSeconds)).toBe("");
    tips.offer("ability", "Decoy drones");
    expect(tips.current(0.1)).toBe("");
    expect(new Tips(config, store).current(0.1)).toBe(""); // a new page remembers it
    expect(store.ids).toEqual(["ability"]);
  });

  it("does not talk over itself: a second tip waits until the first is done", () => {
    const tips = new Tips(config, memory());
    tips.offer("grenade");
    tips.offer("weapons");
    expect(tips.current(0.1)).toBe(config.tips.grenade);
    expect(tips.current(config.showSeconds)).toBe("");
    tips.offer("weapons");
    expect(tips.current(0.1)).toBe(config.tips.weapons);
  });

  it("offers sprinting only after a stretch of plain walking", () => {
    const tips = new Tips(config, memory());
    tips.walking(config.walkSecondsBeforeSprint / 2, true);
    tips.walking(60, false);
    expect(tips.current(0.1)).toBe("");
    tips.walking(config.walkSecondsBeforeSprint / 2, true);
    expect(tips.current(0.1)).toBe(config.tips.sprint);
  });

  it("refuses a file missing a tip", () => {
    expect(() => parseTips({ ...tipsJson, tips: { sprint: "x" } })).toThrow(/tips.json/);
  });
});
