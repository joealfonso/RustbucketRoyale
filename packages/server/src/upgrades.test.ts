import { describe, expect, it } from "vitest";
import { NOISE_KINDS, ZONE_LEGS, parseUpgrades, upgradeItem, upgradeScale, type MechInput } from "@rustbucket/shared";
import upgradesJson from "../../../data/upgrades.json";
import { loadRoomConfig } from "./config";
import { freshLoadout, spillItems, takeUpgrade, wantsItem } from "./loadout";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Player } from "./Player";
import type { Room } from "./Room";

const config = loadRoomConfig();
const set = config.upgrades;
const index = (id: string) => set.upgrades.findIndex((u) => u.id === id);
const TANKS = index("bigTanks"), HANDS = index("quickHands"), EARS = index("bigEars"), CLOCK = index("overclock");

const players = (room: Room) => (room as unknown as { players: Map<number, Player> }).players;
const fit = (room: Room, c: Client, ...upgrades: number[]) => { players(room).get(c.id)!.loadout.upgrades = [upgrades[0] ?? -1, upgrades[1] ?? -1]; };
const drop = (room: Room, item: number, x: number, z: number) =>
  (room as unknown as { pickups: { add(i: number, x: number, y: number, z: number): void } }).pickups.add(item, x, 0.5, z);

function run(room: Room, clients: Client[], input: (c: Client) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c)); room.tick(); }
}

describe("upgrade sockets", () => {
  it("fill the empty socket, then swap out the one fitted first, and refuse a second of the same", () => {
    const l = freshLoadout(config.weapons, config.loot);
    expect(takeUpgrade(l, upgradeItem(TANKS))).toBe(-1);
    expect(takeUpgrade(l, upgradeItem(TANKS))).toBeNull();
    expect(takeUpgrade(l, upgradeItem(EARS))).toBe(-1);
    expect(l.upgrades).toEqual([TANKS, EARS]);
    expect(takeUpgrade(l, upgradeItem(CLOCK))).toBe(TANKS);
    expect(l.upgrades).toEqual([EARS, CLOCK]);
  });

  it("spill from a wreck, and bots only want one they have room for and do not have", () => {
    const l = freshLoadout(config.weapons, config.loot);
    l.upgrades = [HANDS, -1];
    expect(spillItems(l)).toContain(upgradeItem(HANDS));
    expect(wantsItem(l, upgradeItem(HANDS), config.loot)).toBe(false);
    expect(wantsItem(l, upgradeItem(EARS), config.loot)).toBe(true);
    l.upgrades = [HANDS, CLOCK];
    expect(wantsItem(l, upgradeItem(EARS), config.loot)).toBe(false);
  });

  it("multiply together, and refuse an effect that does not exist", () => {
    expect(upgradeScale({ upgrades: [-1, -1] }, set, "fuel")).toBe(1);
    expect(upgradeScale({ upgrades: [TANKS, -1] }, set, "fuel")).toBe(set.upgrades[TANKS]!.effects.fuel);
    expect(upgradeScale({ upgrades: [TANKS, CLOCK] }, set, "repairSpeed")).toBe(1);
    const bad = { ...upgradesJson, upgrades: [{ ...upgradesJson.upgrades[0]!, effects: { laserEyes: 2 } }] };
    expect(() => parseUpgrades(bad)).toThrow(/laserEyes/);
  });
});

describe("upgrades in a room", () => {
  it("are taken with E, and a third drops the one fitted first at your feet", () => {
    const { room, config: c } = makeRoom();
    const a = new Client(room, c);
    run(room, [a], () => idle(), 5);
    const { x, z } = a.last().you;
    for (const u of [TANKS, EARS, CLOCK]) {
      drop(room, upgradeItem(u), x, z);
      run(room, [a], () => idle({ interact: true }), 2);
      run(room, [a], () => idle(), 25); // let go, and wait out the E cooldown
    }
    expect(a.last().loadout.upgrades).toEqual([EARS, CLOCK]);
    expect(a.last().pickups.map((p) => p.item)).toContain(upgradeItem(TANKS));
    expect(a.last().others).toEqual([]);
  });

  it("Big Tanks: a bigger tank, which your own prediction knows about", () => {
    const { room, config: c } = makeRoom();
    const a = new Client(room, c);
    fit(room, a, TANKS);
    run(room, [a], () => idle(), 300); // the bigger tank fills up by the normal refill
    expect(a.last().you.fuelScale).toBeCloseTo(set.upgrades[TANKS]!.effects.fuel!, 5);
    expect(a.last().you.fuel).toBeCloseTo(c.mech.fuelMax * set.upgrades[TANKS]!.effects.fuel!, 0);
  });

  it("Overclock: more shots a second", () => {
    const shots = (upgraded: boolean) => {
      const { room, config: c } = makeRoom();
      const a = new Client(room, c);
      if (upgraded) fit(room, a, CLOCK);
      run(room, [a], () => idle({ fire: true, targetX: -21, targetY: 2, targetZ: 100 }), 240);
      return a.messages.filter((m) => m.t === "shot").length;
    };
    expect(shots(true)).toBeGreaterThan(shots(false) * 1.15);
  });

  it("Quick Hands: repair in half the time", () => {
    const { room, config: c } = makeRoom();
    const a = new Client(room, c);
    startMatch(room, a);
    fit(room, a, HANDS);
    players(room).get(a.id)!.hp[ZONE_LEGS] = 0;
    run(room, [a], () => idle({ repair: true }), Math.ceil((c.zones.repairSeconds / set.upgrades[HANDS]!.effects.repairSpeed!) * 60) + 5);
    expect(a.last().health.hp[ZONE_LEGS]).toBeGreaterThan(0);
  });

  it("Big Ears: hear things from further away", () => {
    const heardAt = (upgraded: boolean) => {
      const { room, config: c } = makeRoom();
      const listener = new Client(room, c), runner = new Client(room, c);
      if (upgraded) fit(room, listener, EARS);
      // Put the runner just beyond normal earshot for running.
      const r = players(room).get(runner.id)!;
      r.state.x = players(room).get(listener.id)!.state.x + c.noise.loudness.run * 1.2;
      run(room, [listener, runner], (cl) => (cl === runner ? idle({ moveY: 1, run: true }) : idle()), 60);
      return listener.snapshots().some((s) => s.noises.some((n) => n.kind === NOISE_KINDS.indexOf("run")));
    };
    expect(heardAt(false)).toBe(false);
    expect(heardAt(true)).toBe(true);
  });
});
