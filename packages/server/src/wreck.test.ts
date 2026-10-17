import { describe, expect, it } from "vitest";
import { ITEM_GRENADE, NOISE_KINDS, ZONE_TORSO, itemWeapon, type MechInput } from "@rustbucket/shared";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Player } from "./Player";
import type { Room, RoomConfig } from "./Room";

// Walk-over pickup made tiny, so the looter does not hoover up the spill and the tests can count it on the floor.
const noWalkOver = (c: RoomConfig): RoomConfig => ({ ...c, loot: { ...c.loot, pickupRadius: 0.01 } });

const players = (room: Room) => (room as unknown as { players: Map<number, Player> }).players;
const knockOut = (room: Room, victim: Client, killer: Client) => {
  const r = room as unknown as { eliminate(p: Player, k: Player | null): void };
  r.eliminate(players(room).get(victim.id)!, players(room).get(killer.id)!);
};

function run(room: Room, clients: Client[], input: (c: Client, i: number) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c, i)); room.tick(); }
}

// Two players in a running match. The second one carries a scattergun, two grenades and a torso plate, and is
// knocked out. The first walks up beside the wreck.
function wreckBeside(patch = noWalkOver) {
  const { room, config } = makeRoom(patch);
  const looter = new Client(room, config), victim = new Client(room, config), listener = new Client(room, config);
  startMatch(room, looter);
  const scatter = config.weapons.weapons.findIndex((w) => w.id === "scattergun");
  const v = players(room).get(victim.id)!;
  v.loadout.slots[1] = scatter;
  v.loadout.grenades = 2;
  v.loadout.armor[ZONE_TORSO] = 40;
  knockOut(room, victim, looter);
  // Spawns are in a row along X, so the wreck is straight to the side. Stop 2 m short of it, within reach of E.
  const target = v.state.x - 2;
  for (let i = 0; i < 240; i++) {
    const dx = target - (looter.last()?.you.x ?? 0);
    // Aim yaw PI faces +Z, so right (moveX +1) is -X.
    run(room, [looter, victim, listener], (c) => (c === looter ? idle({ moveX: Math.abs(dx) > 0.2 ? -Math.sign(dx) : 0 }) : idle()), 1);
  }
  return { room, config, looter, victim, listener, scatter };
}

const hold = (looter: Client) => (c: Client) => (c === looter ? idle({ interact: true }) : idle());

describe("looting a wreck", () => {
  it("takes E held for the loot time, then spills every weapon, grenade and plate round the wreck", () => {
    const { room, config, looter, victim, listener, scatter } = wreckBeside();
    const ticks = Math.ceil(config.loot.wreckLootSeconds * 60);
    expect(looter.last().pickups).toHaveLength(0);

    run(room, [looter, victim, listener], hold(looter), ticks - 10);
    expect(looter.last().looting).toBeGreaterThan(0.5);
    expect(looter.last().pickups).toHaveLength(0);

    run(room, [looter, victim, listener], hold(looter), 20);
    const items = looter.last().pickups.map((p) => p.item).sort((a, b) => a - b);
    expect(items.filter((i) => i === ITEM_GRENADE)).toHaveLength(2);
    expect(items.map(itemWeapon)).toContain(scatter);
    expect(items.map(itemWeapon)).toContain(config.weapons.start);
    expect(items).toHaveLength(5); // two weapons, two grenades, one plate
    expect(looter.last().looting).toBe(0);
    // The wreck shows as emptied, with its plates gone.
    const wreck = looter.last().others.find((o) => o.id === victim.id)!;
    expect(wreck).toMatchObject({ dead: true, looted: true, armor: [0, 0, 0] });
  });

  it("starts again from nothing if E is let go", () => {
    const { room, config, looter, victim, listener } = wreckBeside();
    const ticks = Math.ceil(config.loot.wreckLootSeconds * 60);
    run(room, [looter, victim, listener], hold(looter), ticks - 10);
    run(room, [looter, victim, listener], () => idle(), 2);
    expect(looter.last().looting).toBe(0);
    run(room, [looter, victim, listener], hold(looter), ticks - 10);
    expect(looter.last().pickups).toHaveLength(0);
  });

  it("does nothing out of reach", () => {
    const { room, config } = makeRoom(noWalkOver);
    const looter = new Client(room, config), victim = new Client(room, config);
    startMatch(room, looter);
    knockOut(room, victim, looter);
    // The second spawn is further away than E reaches.
    run(room, [looter, victim], hold(looter), 200);
    expect(looter.last().looting).toBe(0);
    expect(looter.last().pickups).toHaveLength(0);
  });

  it("can only be done once per wreck", () => {
    const { room, config, looter, victim, listener } = wreckBeside();
    run(room, [looter, victim, listener], hold(looter), Math.ceil(config.loot.wreckLootSeconds * 60) + 5);
    const spilled = looter.last().pickups.length;
    run(room, [looter, victim, listener], () => idle(), 2);
    // Pressing E again takes a spilled weapon (one fewer on the floor), but never starts looting the empty wreck.
    let progress = 0;
    for (let i = 0; i < Math.ceil(config.loot.wreckLootSeconds * 60) + 5; i++) {
      run(room, [looter, victim, listener], hold(looter), 1);
      progress = Math.max(progress, looter.last().looting);
    }
    expect(progress).toBe(0);
    expect(looter.last().pickups.length).toBeLessThanOrEqual(spilled);
  });

  it("is loud: people nearby hear it on the radar", () => {
    const { room, looter, victim, listener } = wreckBeside();
    const kind = NOISE_KINDS.indexOf("loot");
    let heard = false;
    for (let i = 0; i < 60; i++) {
      run(room, [looter, victim, listener], hold(looter), 1);
      if (listener.last().noises.some((n) => n.kind === kind)) heard = true;
    }
    expect(heard).toBe(true);
  });
});

describe("bots and loot", () => {
  it("walk over to a grenade they have room for and take it, with nobody in sight", () => {
    const { room, config } = makeRoom(undefined, "small", 1);
    room.tick();
    const bot = [...players(room).values()].find((p) => p.bot)!;
    const before = bot.loadout.grenades;
    const pickups = (room as unknown as { pickups: { add(i: number, x: number, y: number, z: number): void; count: number } }).pickups;
    pickups.add(ITEM_GRENADE, bot.state.x + 12, 0.5, bot.state.z + 4);
    for (let i = 0; i < 60 * 15 && bot.loadout.grenades === before; i++) room.tick();
    expect(bot.loadout.grenades).toBe(before + 1);
    expect(pickups.count).toBe(0);
    expect(config.bots.loot.searchMeters).toBeGreaterThan(13);
  });

  it("loot a wreck they find", () => {
    // Results last long enough for the bot to get there: knocking out both people ends the match.
    const { room, config } = makeRoom((c) => noWalkOver({ ...c, match: { ...c.match, resultsSeconds: 60 } }), "small", 1);
    const human = new Client(room, config), victim = new Client(room, config);
    startMatch(room, human);
    const bot = [...players(room).values()].find((p) => p.bot)!;
    knockOut(room, victim, human);
    knockOut(room, human, victim);
    expect(players(room).get(victim.id)!.looted).toBe(false);
    // Nobody is left standing for the bot to fight, so it goes looting. Its spawn is within search range of the wrecks.
    for (let i = 0; i < 60 * 20 && !players(room).get(victim.id)!.looted && !players(room).get(human.id)!.looted; i++) room.tick();
    const lootedOne = players(room).get(victim.id)!.looted || players(room).get(human.id)!.looted;
    expect(lootedOne).toBe(true);
    expect(bot.dead).toBe(false);
  });
});
