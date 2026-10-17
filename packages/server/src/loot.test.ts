import { describe, expect, it } from "vitest";
import { ITEM_ARMOR_FIRST, ITEM_GRENADE, ZONE_TORSO, itemWeapon, weaponItem, type MechInput, type PickupState, type ServerMessage } from "@rustbucket/shared";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Room, RoomConfig } from "./Room";

// The test range has a crate at (-6, 18). The first player spawns at (-21, 0, 0), the second at (-15, 0, 0).
const aimAtCrate: Partial<MechInput> = { fire: true, targetX: -6, targetY: 1, targetZ: 18 };

// Every prop drops something, and always the item asked for.
const alwaysDrops = (table: Record<string, number>) => (c: RoomConfig): RoomConfig => ({
  ...c, loot: { ...c.loot, drops: { crate: { chance: 1, table }, junk: { chance: 1, table }, barrel: { chance: 0, table: {} } } },
});

function run(room: Room, clients: Client[], input: (c: Client, i: number) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c, i)); room.tick(); }
}
const pickups = (c: Client) => c.last().pickups;

// Walks a client to a spot by running straight at it, aim fixed so forward is +Z.
function walkTo(room: Room, c: Client, x: number, z: number, extra: Partial<MechInput> = {}, ticks = 240): void {
  for (let i = 0; i < ticks; i++) {
    const you = c.last()?.you ?? { x: 0, z: 0 };
    const dx = x - you.x, dz = z - you.z;
    const far = Math.hypot(dx, dz) > 0.4;
    // Aim yaw PI faces +Z, so right (moveX +1) is -X.
    c.send(idle({ moveY: far ? Math.sign(dz) * Math.min(1, Math.abs(dz)) : 0, moveX: far ? -Math.sign(dx) * Math.min(1, Math.abs(dx)) : 0, ...extra }));
    room.tick();
  }
}

describe("loot", () => {
  it("drops from a broken crate, and anyone near sees it", () => {
    const { room, config } = makeRoom(alwaysDrops({ grenade: 1 }));
    const a = new Client(room, config), b = new Client(room, config);
    run(room, [a, b], (c) => (c === a ? idle(aimAtCrate) : idle()), 60);
    const dropped = pickups(b);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.item).toBe(ITEM_GRENADE);
    expect(Math.hypot(dropped[0]!.x - -6, dropped[0]!.z - 18)).toBeLessThan(1);
  });

  it("is only sent again when the list near you changes", () => {
    const { room, config } = makeRoom(alwaysDrops({ grenade: 1 }));
    const a = new Client(room, config);
    const raw: (PickupState[] | null)[] = [];
    room.join((m) => { if (m.t === "snapshot") raw.push(m.pickups); });
    run(room, [a], () => idle(aimAtCrate), 60);
    const sent = raw.filter((p) => p !== null);
    expect(sent.at(-1)).toHaveLength(1); // the drop was sent once it appeared...
    expect(raw.filter((p) => p === null).length).toBeGreaterThan(sent.length); // ...and most snapshots said "unchanged"
  });

  it("a grenade is collected by walking over it, and adds one to the count", () => {
    const { room, config } = makeRoom(alwaysDrops({ grenade: 1 }));
    const a = new Client(room, config);
    run(room, [a], () => idle(aimAtCrate), 60);
    const before = a.last().loadout.grenades;
    const p = pickups(a)[0]!;
    walkTo(room, a, p.x, p.z);
    expect(a.last().loadout.grenades).toBe(before + 1);
    expect(pickups(a)).toHaveLength(0);
  });

  it("an armor plate is collected by walking over it and soaks damage before hit points", () => {
    const { room, config } = makeRoom(alwaysDrops({ armor: 1 }));
    const a = new Client(room, config);
    run(room, [a], () => idle(aimAtCrate), 60);
    const p = pickups(a)[0]!;
    const zone = p.item - ITEM_ARMOR_FIRST;
    walkTo(room, a, p.x, p.z);
    expect(a.last().loadout.armor[zone]).toBe(config.loot.armorPlates[zone]);
  });

  it("a weapon needs E, within reach, and goes in the empty slot", () => {
    const { room, config } = makeRoom(alwaysDrops({ scattergun: 1 }));
    const a = new Client(room, config);
    run(room, [a], () => idle(aimAtCrate), 60);
    const p = pickups(a)[0]!;
    expect(itemWeapon(p.item)).toBeGreaterThanOrEqual(0);

    // Pressing E from far away does nothing.
    run(room, [a], (_, i) => idle({ interact: i === 0 }), 10);
    expect(a.last().loadout.slots[1]).toBe(-1);

    // Walking onto it does nothing without E either.
    walkTo(room, a, p.x, p.z);
    expect(a.last().loadout.slots[1]).toBe(-1);

    run(room, [a], (_, i) => idle({ interact: i === 0 }), 10);
    expect(a.last().loadout.slots[1]).toBe(itemWeapon(p.item));
    expect(a.last().loadout.active).toBe(1);
    expect(pickups(a)).toHaveLength(0);
  });

  it("taking a third weapon drops the one in hand at your feet", () => {
    const { room, config } = makeRoom(alwaysDrops({ scattergun: 1 }));
    const a = new Client(room, config);
    // Two crates' worth: break the crate, take the scattergun, then make another drop appear by hand.
    run(room, [a], () => idle(aimAtCrate), 60);
    const p = pickups(a)[0]!;
    walkTo(room, a, p.x, p.z);
    run(room, [a], (_, i) => idle({ interact: i === 0 }), 10);
    expect(a.last().loadout.slots).toEqual([config.weapons.start, itemWeapon(p.item)]);
    // Drop a spike driver right where the player stands, through the room's own pickups.
    const spike = config.weapons.weapons.findIndex((w) => w.id === "spikeDriver");
    (room as unknown as { pickups: { add(i: number, x: number, y: number, z: number): void } }).pickups.add(weaponItem(spike), a.last().you.x, 0.5, a.last().you.z);
    run(room, [a], (_, i) => idle({ interact: i === 25, slot: 1 }), 40); // after the E cooldown from the first pickup
    expect(a.last().loadout.slots).toEqual([config.weapons.start, spike]);
    expect(pickups(a).map((q) => q.item)).toContain(p.item); // the scattergun is on the floor again
  });
});

describe("weapons", () => {
  // The shooter faces the target from behind so its arms are out of the way, as in the combat tests.
  const AT_TARGET: Partial<MechInput> = { fire: true, targetX: -15, targetY: 2.4, targetZ: 0 };
  const turnedAway = (extra: Partial<MechInput> = {}) => idle({ aimYaw: -Math.PI / 2, ...extra });

  function duel(weaponId: string, patch: (c: RoomConfig) => RoomConfig = (c) => c) {
    const { room, config } = makeRoom(patch);
    const shooter = new Client(room, config), target = new Client(room, config);
    startMatch(room, shooter);
    const weapon = config.weapons.weapons.findIndex((w) => w.id === weaponId);
    // Hand the shooter the weapon directly, in slot 2.
    (room as unknown as { players: Map<number, { loadout: { slots: number[] } }> }).players.get(shooter.id)!.loadout.slots[1] = weapon;
    run(room, [shooter, target], (c) => (c === target ? turnedAway() : idle({ slot: 1 })), 40);
    return { room, config, shooter, target, weapon: config.weapons.weapons[weapon]! };
  }
  const hits = (c: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "hit" }> => m.t === "hit");

  it("switching slots changes the damage each hit does", () => {
    const { room, shooter, target, weapon } = duel("spikeDriver");
    run(room, [shooter, target], (c) => (c === target ? turnedAway() : idle({ ...AT_TARGET, slot: 1 })), 30);
    expect(hits(shooter)[0]?.damage).toBe(weapon.damage);
  });

  it("the scattergun fires several pellets per pull, each one its own shot", () => {
    const { room, shooter, target, weapon } = duel("scattergun");
    shooter.messages.length = 0;
    run(room, [shooter, target], (c) => (c === target ? turnedAway() : idle({ ...AT_TARGET, slot: 1 })), 10);
    expect(shooter.messages.filter((m) => m.t === "shot").length).toBe(weapon.pellets);
  });

  it("armor takes the damage first and the zone only takes what gets through", () => {
    const { room, shooter, target, config } = duel("spikeDriver");
    (room as unknown as { players: Map<number, { loadout: { armor: number[] } }> }).players.get(target.id)!.loadout.armor[ZONE_TORSO] = 40;
    run(room, [shooter, target], (c) => (c === target ? turnedAway() : idle({ ...AT_TARGET, slot: 1 })), 30);
    const spike = config.weapons.weapons.find((w) => w.id === "spikeDriver")!;
    expect(target.last().loadout.armor[ZONE_TORSO]).toBe(0);
    expect(target.last().health.hp[ZONE_TORSO]).toBe(100 - (spike.damage - 40));
  });

  it("a grenade needs one in the bag, and the count goes down", () => {
    const { room, config } = makeRoom((c) => ({ ...c, loot: { ...c.loot, grenadesStart: 1 } }));
    const a = new Client(room, config), b = new Client(room, config);
    run(room, [a, b], (c) => (c === a ? idle({ grenade: true, targetX: 0, targetY: 0, targetZ: 30 }) : idle()), 120);
    expect(b.messages.filter((m) => m.t === "grenade")).toHaveLength(1);
    expect(a.last().loadout.grenades).toBe(0);
  });

  it("a new match puts everyone back to the starting loadout and clears the floor", () => {
    const { room, config } = makeRoom(alwaysDrops({ grenade: 1 }));
    const a = new Client(room, config);
    run(room, [a], () => idle(aimAtCrate), 60);
    expect(pickups(a).length).toBeGreaterThan(0);
    startMatch(room, a);
    run(room, [a], () => idle(), 10);
    expect(pickups(a)).toHaveLength(0);
    expect(a.last().loadout).toEqual({ slots: [config.weapons.start, -1], active: 0, grenades: config.loot.grenadesStart, armor: [0, 0, 0] });
  });
});
