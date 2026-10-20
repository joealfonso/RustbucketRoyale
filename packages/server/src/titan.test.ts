import { describe, expect, it } from "vitest";
import { STEP, World, boxFromData, createGrenade, createMechInput, createMechState, parseBotConfig, stepGrenade, type ServerMessage, type TitanConfig } from "@rustbucket/shared";
import botsJson from "../../../data/bots.json";
import { Bot } from "./Bot";
import { loadRoomConfig } from "./config";
import type { Room, RoomConfig } from "./Room";
import { TITAN_ID } from "./Titan";
import { Client, idle, makeRoom, startMatch, type Snapshot } from "./testClient";

type Patch = Partial<Omit<TitanConfig, "stomp" | "throw">> & { stomp?: Partial<TitanConfig["stomp"]>; throw?: Partial<TitanConfig["throw"]> };
type TitanMessage = Extract<ServerMessage, { t: "titan" }>;

// A match on the flat test strip with two people standing on their spawns, a at x -21 and b at x -15, both at z 0.
function setup(patch: Patch = {}, tier = "medium", room: (c: RoomConfig) => RoomConfig = (c) => c) {
  const made = makeRoom((c) => room({
    ...c,
    titan: { ...c.titan, appearSeconds: 0, clearOfMechsMeters: 0, ...patch, stomp: { ...c.titan.stomp, ...patch.stomp }, throw: { ...c.titan.throw, ...patch.throw } },
  }), tier);
  const a = new Client(made.room, made.config), b = new Client(made.room, made.config);
  startMatch(made.room, a);
  return { ...made, a, b };
}

// Ticks with every person sending an input, so their mechs step (and anything thrown at them moves them).
function run(room: Room, clients: Client[], seconds: number, input = (_c: Client) => idle()): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    for (const c of clients) c.send(input(c));
    room.tick();
  }
}

// Puts the Titan, once it has woken, where a test wants it.
function placeAt(room: Room, clients: Client[], x: number, z: number) {
  run(room, clients, STEP);
  const titan = room.junkTitan!;
  titan.x = x;
  titan.z = z;
  return titan;
}

const mech = (room: Room, c: Client) => room.inspect().find((m) => m.id === c.id)!;
const titanMessages = (c: Client, event: TitanMessage["event"]) => c.messages.filter((m): m is TitanMessage => m.t === "titan" && m.event === event);
const noThrows = { throw: { minRange: 200, range: 201 } };

describe("the Junk Titan", () => {
  it("wakes up on medium at its time, announced, and is sent to people near it; never on small", () => {
    const medium = setup({ appearSeconds: 3 }, "medium");
    run(medium.room, [medium.a, medium.b], 2.5);
    expect(medium.room.junkTitan).toBeNull();
    expect((medium.a.last() as Snapshot).titan).toBeNull();
    run(medium.room, [medium.a, medium.b], 1);
    expect(medium.room.junkTitan).not.toBeNull();
    expect(medium.a.messages.some((m) => m.t === "notice" && m.text === medium.config.titan.announce)).toBe(true);
    expect(medium.a.last().titan).toMatchObject({ hp: 1 });

    const small = setup({ appearSeconds: 3 }, "small");
    run(small.room, [small.a, small.b], 4);
    expect(small.room.junkTitan).toBeNull();
    expect(small.a.last().titan).toBeNull();
  });

  it("is on medium and large by default, and not on small", () => {
    const config = loadRoomConfig();
    expect(config.titan.tiers).toContain("medium");
    expect(config.titan.tiers).toContain("large");
    expect(config.titan.tiers).not.toContain("small");
  });

  it("walks towards a mech in range", () => {
    const { room, a, b } = setup(noThrows);
    const titan = placeAt(room, [a, b], -21, 60);
    const before = Math.hypot(titan.x + 21, titan.z);
    run(room, [a, b], 6);
    expect(Math.hypot(titan.x + 21, titan.z)).toBeLessThan(before - 5);
    expect(a.last().titan!.action).toBe("walk");
  });

  it("stomps a mech at its feet: hurts it, throws it clear, and smashes the crate beside it", () => {
    const { room, a, b, config } = setup({ ...noThrows, stomp: { triggerRadius: 10, radius: 12 } });
    const titan = placeAt(room, [a, b], -10, 8);
    const crate = 0; // the strip's first prop: the crate at x -6, z 18
    run(room, [a, b], 3);
    const stomps = titanMessages(a, "stomp");
    expect(stomps).toHaveLength(1);
    expect(stomps[0]!.radius).toBe(12);
    const hurt = mech(room, b), spared = mech(room, a);
    expect(hurt.hp[0]).toBeLessThan(config.zones.zones[0]!.hp);
    expect(hurt.hp[2]).toBeLessThan(config.zones.zones[2]!.hp);
    expect(Math.hypot(hurt.x - titan.x, hurt.z - titan.z)).toBeGreaterThan(Math.hypot(5, 8) + 4);
    expect(spared.hp).toEqual(config.zones.zones.map((z) => z.hp)); // further than the stomp reaches
    expect(a.messages.some((m) => m.t === "prop" && m.id === crate)).toBe(true);
  });

  it("throws a car that lands where the shared grenade step says, and hurts who it lands on", () => {
    const { room, a, b, config } = setup();
    placeAt(room, [a, b], -21, 50);
    run(room, [a, b], 6);
    const thrown = titanMessages(a, "throw")[0]!;
    const landed = titanMessages(a, "land")[0]!;
    expect(thrown).toBeDefined();
    expect(landed).toBeDefined();
    // Fly the car as a client would, from the throw message alone, on its own copy of the map.
    const car = createGrenade();
    Object.assign(car, { x: thrown.x, y: thrown.y, z: thrown.z, vx: thrown.vx, vy: thrown.vy, vz: thrown.vz, timeLeft: (Math.round(config.titan.throw.flightSeconds / STEP) - 0.5) * STEP });
    const world = config.mapFor("medium", 0).world;
    while (!stepGrenade(car, config.titan.car, STEP, world));
    expect([car.x, car.y, car.z]).toEqual([landed.x, landed.y, landed.z]);
    expect(Math.hypot(landed.x + 21, landed.z)).toBeLessThan(1.5); // a stood still, so it came down on a
    expect(mech(room, a).hp[2]).toBeLessThan(config.zones.zones[2]!.hp);
  });

  it("knocks a mech out as the Titan, with no killer mech", () => {
    const { room, a, b } = setup({ throw: { damage: 5000 } });
    placeAt(room, [a, b], -21, 50);
    run(room, [a, b], 6);
    const out = a.messages.find((m): m is Extract<ServerMessage, { t: "eliminated" }> => m.t === "eliminated" && m.id === a.id)!;
    expect(out.killerId).toBeNull();
    expect(out.how).toEqual({ killerMech: -1, killerBot: false, causes: ["titan:car"] });
  });

  it("falls to enough damage, spills a pile of loot, and credits whoever shot it", () => {
    const { room, a, b, config } = setup({ hp: 100, ...noThrows }, "medium", (c) => ({ ...c, match: { ...c.match, matchSeconds: 7 } }));
    const titan = placeAt(room, [a, b], -21, 30);
    run(room, [a, b], 4, (c) => (c === a ? idle({ fire: true, targetX: -21, targetY: 7.5, targetZ: 30 }) : idle()));
    expect(titan.alive).toBe(false);
    const hits = a.messages.filter((m): m is Extract<ServerMessage, { t: "hit" }> => m.t === "hit" && m.targetId === TITAN_ID);
    expect(hits.reduce((sum, h) => sum + h.damage, 0)).toBeCloseTo(100, 6);
    expect(hits.at(-1)!.killed).toBe(true);
    expect(hits.slice(0, -1).every((h) => !h.killed)).toBe(true);
    expect(titanMessages(b, "fall")).toHaveLength(1);
    expect(b.messages.some((m) => m.t === "notice" && m.text === config.titan.fallNotice)).toBe(true);
    expect(a.last().titan).toMatchObject({ action: "down", hp: 0 });

    run(room, [a, b], config.titan.fall.seconds);
    const pile = a.last().pickups.filter((p) => Math.hypot(p.x - titan.x, p.z - titan.z) <= config.titan.fall.spillMeters + 0.5);
    expect(pile).toHaveLength(config.titan.fall.contents.length);

    run(room, [a, b], 4); // to the end of the short match
    const result = a.messages.find((m): m is Extract<ServerMessage, { t: "result" }> => m.t === "result")!;
    expect(result.stats).toContainEqual({ kind: "titanDamage", playerId: a.id, value: 100 });
  });

  it("pushes a mech out of its body", () => {
    const { room, a, b, config } = setup(noThrows);
    const titan = placeAt(room, [a, b], -19, 1);
    run(room, [a, b], 1);
    expect(Math.hypot(mech(room, a).x - titan.x, mech(room, a).z - titan.z)).toBeGreaterThanOrEqual(config.titan.radius - 0.5);
  });
});

describe("a bot and the Titan", () => {
  const botConfig = parseBotConfig(botsJson);
  const config = loadRoomConfig();
  const flat = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "" })]);

  it("shoots it high up its body when it is the nearest thing", () => {
    const bot = new Bot(botConfig.difficulties.normal!, () => 0.5, botConfig.path, null);
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    let fired = 0;
    for (let i = 0; i < 180; i++) {
      bot.think(self, [{ id: TITAN_ID, x: 0, y: 0, z: -40, aimHeight: config.titan.aimHeight }], null, flat, STEP, input);
      if (input.fire) fired++;
    }
    expect(fired).toBeGreaterThan(20);
    expect(input.targetY).toBeGreaterThan(5);
  });

  it("runs out of its reach rather than standing at its feet", () => {
    const bot = new Bot(botConfig.difficulties.normal!, () => 0.5, botConfig.path, null);
    const self = createMechState(config.mech, 0, 0, -5, 0);
    const input = createMechInput();
    bot.keepOutOf(0, 0, config.titan.botKeepOutMeters);
    bot.think(self, [{ id: TITAN_ID, x: 0, y: 0, z: 0, aimHeight: config.titan.aimHeight }], null, flat, STEP, input);
    // Facing the Titan (+z from here is towards it), the way out is backwards.
    expect(input.run).toBe(true);
    const yaw = input.aimYaw;
    const wantX = -Math.sin(yaw) * input.moveY + Math.cos(yaw) * input.moveX, wantZ = -Math.cos(yaw) * input.moveY - Math.sin(yaw) * input.moveX;
    expect(wantZ).toBeLessThan(-0.9);
    expect(Math.abs(wantX)).toBeLessThan(0.3);
  });
});
