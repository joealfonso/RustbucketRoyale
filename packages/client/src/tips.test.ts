import { describe, expect, it } from "vitest";
import tipsJson from "../../../data/tips.json";
import { Tips, parseTips, type TipStore } from "./tips";

const memory = (start: string[] = []): TipStore & { ids: string[] } => {
  const s = { ids: [...start], load: () => [...s.ids], save: (ids: string[]) => { s.ids = ids; } };
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

describe("the right-click tip (gate 18a)", () => {
  it("names the gun's secondary", () => {
    const tips = new Tips(config, memory());
    tips.offer("secondary", "Slug");
    expect(tips.current(0.1)).toBe("Right-click: Slug");
  });

  it("is said once per gun, not once in total", () => {
    const store = memory();
    const tips = new Tips(config, store);
    tips.offer("secondary", "Slug");
    expect(tips.current(0.1)).toBe("Right-click: Slug");
    tips.current(config.showSeconds);
    tips.offer("secondary", "Slug");
    expect(tips.current(0.1)).toBe(""); // the same gun never twice
    tips.offer("secondary", "Charge");
    expect(tips.current(0.1)).toBe("Right-click: Charge");
    expect(store.ids).toEqual(["secondary:Slug", "secondary:Charge"]);
    expect(new Tips(config, store).offer("secondary", "Charge")).toBe(true); // remembered across pages
  });

  it("still loads a list saved before the tip went per gun", () => {
    const tips = new Tips(config, memory(["secondary", "ability"]));
    tips.offer("secondary", "Slug");
    expect(tips.current(0.1)).toBe("Right-click: Slug");
    tips.offer("ability", "Decoy drones");
    expect(tips.current(config.showSeconds)).toBe("");
    tips.offer("ability", "Decoy drones");
    expect(tips.current(0.1)).toBe(""); // the old ability entry still counts
  });
});

describe("the supply drop and Titan tips", () => {
  it("are in the file and parse", () => {
    expect(config.tips.supplyDrop).toMatch(/beam/i);
    expect(config.tips.titan).toMatch(/Titan/);
    expect(() => parseTips({ ...tipsJson, tips: { ...tipsJson.tips, supplyDrop: "" } })).toThrow(/supplyDrop/);
    expect(() => parseTips({ ...tipsJson, tips: { ...tipsJson.tips, titan: undefined } })).toThrow(/titan/);
  });

  it("each shows once, and offer says when a caller can stop trying", () => {
    const tips = new Tips(config, memory());
    expect(tips.offer("supplyDrop")).toBe(true);
    expect(tips.offer("titan")).toBe(false); // another tip is on screen: try again later
    expect(tips.current(0.1)).toBe(config.tips.supplyDrop);
    expect(tips.current(config.showSeconds)).toBe("");
    expect(tips.offer("titan")).toBe(true);
    expect(tips.current(0.1)).toBe(config.tips.titan);
    expect(tips.current(config.showSeconds)).toBe("");
    expect(tips.offer("supplyDrop")).toBe(true);
    expect(tips.current(0.1)).toBe("");
  });
});
