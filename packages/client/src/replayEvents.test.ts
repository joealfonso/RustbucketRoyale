import { describe, expect, it } from "vitest";
import { createShot, type AbilityMessage } from "@rustbucket/shared";
import { ABILITY, EXPLODE, ReplayEvents, SHOT } from "./replayEvents";

const shotAt = (x: number) => ({ ...createShot(), ox: x, oy: 2, oz: 3, dx: 0, dy: 0, dz: -1, length: 40 });

describe("ReplayEvents", () => {
  it("keeps the newest events once full, in the order they happened", () => {
    const events = new ReplayEvents(4);
    for (let i = 0; i < 10; i++) events.explode(i * 10, i, 0, 0);
    expect(events.size).toBe(4);
    expect(events.timeAt(0)).toBe(60);
    expect(events.valueAt(3, 0)).toBe(9);
  });

  it("finds the first event after a moment, so each one fires once", () => {
    const events = new ReplayEvents(8);
    for (const t of [10, 20, 20, 30]) events.explode(t, 0, 0, 0);
    expect(events.firstAfter(0)).toBe(0);
    expect(events.firstAfter(10)).toBe(1);
    expect(events.firstAfter(20)).toBe(3);
    expect(events.firstAfter(30)).toBe(4);
  });

  it("gives back a shot with its shooter, weapon and whether it hit a mech", () => {
    const events = new ReplayEvents(4);
    events.shot(5, 12, shotAt(7), 3, true);
    const out = createShot();
    events.readShot(0, out);
    expect(events.kindAt(0)).toBe(SHOT);
    expect(events.idAt(0)).toBe(12);
    expect(events.weaponAt(0)).toBe(3);
    expect(events.hitMechAt(0)).toBe(true);
    expect(out).toEqual(shotAt(7));
  });

  it("gives back an ability moment as the message the game shows it from", () => {
    const events = new ReplayEvents(4);
    const moment: AbilityMessage = { t: "ability", id: 4, kind: "pounce", event: "land", x: 1, y: 2, z: 3, ids: [9] };
    events.ability(5, moment);
    events.explode(6, 0, 0, 0);
    const out: AbilityMessage = { t: "ability", id: 0, kind: "ram", event: "start", x: 0, y: 0, z: 0 };
    events.readAbility(0, out);
    expect(events.kindAt(0)).toBe(ABILITY);
    expect(events.kindAt(1)).toBe(EXPLODE);
    expect(out).toEqual({ ...moment, ids: undefined });
  });
});
