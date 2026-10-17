import { describe, expect, it } from "vitest";
import { World, boxFromData, createMechInput, createMechState, parseBotStats, type MechInput, type RingNow } from "@rustbucket/shared";
import botsJson from "../../../data/bots.json";
import { loadRoomConfig } from "./config";
import { Bot } from "./Bot";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Room } from "./Room";

const stats = parseBotStats(botsJson);
const config = loadRoomConfig();
const DT = 1 / 60;
const flat = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "" })]);
const random = () => 0.5;

function spotted(distance: number, world: World = flat) {
  const bot = new Bot(stats, random);
  const self = createMechState(config.mech, 0, 0, 0, 0);
  const input = createMechInput();
  // Looks down -Z. Give it a second to turn and settle.
  const target = [{ id: 2, x: 0, y: 0, z: -distance }];
  for (let i = 0; i < 120; i++) bot.think(self, target, null, world, DT, input);
  return { input, self, bot };
}

describe("Bot", () => {
  it("shoots at someone it can see once it has had time to react", () => {
    let fired = 0;
    const bot = new Bot(stats, random);
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    for (let i = 0; i < 180; i++) { bot.think(self, [{ id: 2, x: 0, y: 0, z: -30 }], null, flat, DT, input); if (input.fire) fired++; }
    expect(fired).toBeGreaterThan(20);
    expect(spotted(30).input.targetZ).toBeLessThan(0);
  });

  it("does not shoot at someone behind a wall, or beyond sight range", () => {
    const wall = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "" }), boxFromData({ name: "w", center: [0, 5, -15], size: [40, 10, 1], color: "" })]);
    expect(spotted(30, wall).input.fire).toBe(false);
    expect(spotted(stats.sightRange + 40).input.fire).toBe(false);
  });

  it("holds back from someone too close and closes in on someone far", () => {
    const near = spotted(5);
    expect(near.input.moveY).toBeLessThan(0.3); // not charging in
    const far = spotted(60);
    expect(far.input.moveY).toBeGreaterThan(0.3);
  });

  it("heads for the middle of the ring when it is outside it", () => {
    const bot = new Bot(stats, random);
    const self = createMechState(config.mech, 100, 0, 0, 0);
    const ring: RingNow = { cx: 0, cz: 0, radius: 40, stage: 1, shrinking: false, damagePerSecond: 2, secondsToChange: 10 };
    const input = createMechInput();
    for (let i = 0; i < 90; i++) bot.think(self, [], ring, flat, DT, input);
    // Facing roughly -X (toward the ring) and pushing forward, sprinting.
    expect(input.moveY).toBeGreaterThan(0.5);
    expect(input.run).toBe(true);
    expect(Math.sin(input.aimYaw)).toBeGreaterThan(0.5); // forward is (-sin yaw, -cos yaw), so -X means a positive sin
  });

  it("hops when it is stuck against something", () => {
    const bot = new Bot(stats, random);
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    let jetted = false;
    for (let i = 0; i < 300; i++) { bot.think(self, [{ id: 2, x: 0, y: 0, z: -60 }], null, flat, DT, input); if (input.jet) jetted = true; }
    expect(jetted).toBe(true); // it wants to move but this fake mech never does
  });
});

describe("rooms with bots", () => {
  const tick = (room: Room, humans: Client[], count: number) => {
    for (let i = 0; i < count; i++) { for (const h of humans) h.send(idle()); room.tick(); }
  };

  it("fill the room, are shown to people as bots, and a room of only bots counts as empty", () => {
    const { room, config: c } = makeRoom(undefined, "small", 4);
    const human = new Client(room, c);
    tick(room, [human], 10);
    const others = human.last().others;
    expect(others).toHaveLength(4);
    expect(others.every((o) => o.bot)).toBe(true);
    expect(room.playerCount).toBe(1);
    room.leave(human.id);
    expect(room.playerCount).toBe(0);
  });

  it("stand still in the lobby and then fight once the match is on", () => {
    const { room, config: c } = makeRoom(undefined, "small", 3);
    const human = new Client(room, c);
    tick(room, [human], 60);
    expect(human.messages.some((m) => m.t === "shot")).toBe(false);
    startMatch(room, human);
    tick(room, [human], 60 * 90);
    expect(human.messages.some((m) => m.t === "shot")).toBe(true);
  });

  it("play a whole match to its end, with someone winning, without breaking", () => {
    const { room, config: c } = makeRoom((cfg) => ({ ...cfg, match: { ...cfg.match, resultsSeconds: 60 } }), "small", 5);
    const human = new Client(room, c);
    startMatch(room, human);
    for (let i = 0; i < 60 * 480 && room.matchState === "active"; i++) { human.send(idle()); room.tick(); }
    expect(room.matchState).toBe("results");
    expect(human.messages.find((m) => m.t === "result")).toBeDefined();
    expect(human.messages.filter((m) => m.t === "eliminated").length).toBeGreaterThanOrEqual(1);
    const input: MechInput = createMechInput();
    expect(input.fire).toBe(false);
  });

  it("are capped by the spawns the map has", () => {
    const { room, config: c } = makeRoom(undefined, "small", 99);
    const human = new Client(room, c);
    tick(room, [human], 10);
    expect(human.last().others.length).toBe(c.mapFor("small", 0).spawns.length - c.net.maxPlayers);
  });
});
