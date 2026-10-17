import { describe, expect, it } from "vitest";
import { NOISE_KINDS, createMechState, createMechInput, parseBotConfig, World, boxFromData, type MechInput, type NoiseEvent } from "@rustbucket/shared";
import botsJson from "../../../data/bots.json";
import { Bot } from "./Bot";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom } from "./testClient";
import type { Room, RoomConfig } from "./Room";

// Two people: the first at the origin, the second `gap` metres down the strip.
const apart = (gap: number) => (c: RoomConfig): RoomConfig => {
  const map = c.mapFor("small", 0);
  const spawns = map.spawns.map((s, i): [number, number, number] => (i === 0 ? [0, 0.1, 0] : i === 1 ? [0, 0.1, gap] : s));
  return { ...c, mapFor: () => ({ ...map, spawns }) };
};

function play(room: Room, a: Client, b: Client, aInput: () => MechInput, ticks: number): NoiseEvent[] {
  const heard: NoiseEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    a.send(aInput());
    b.send(idle());
    room.tick();
    for (const m of b.messages) if (m.t === "snapshot") heard.push(...m.noises);
    b.messages.length = 0;
  }
  return heard;
}

const kind = (name: (typeof NOISE_KINDS)[number]) => NOISE_KINDS.indexOf(name);

describe("noise", () => {
  it("running is heard nearby, at a spot near the runner but never exactly on it", () => {
    const { room, config } = makeRoom(apart(30));
    const a = new Client(room, config), b = new Client(room, config);
    const heard = play(room, a, b, () => idle({ moveX: 1, run: true }), 120);
    const runs = heard.filter((n) => n.kind === kind("run"));
    expect(runs.length).toBeGreaterThan(0);
    for (const n of runs) {
      const you = a.last().you;
      const off = Math.hypot(n.x - you.x, n.z - you.z);
      expect(off).toBeLessThan(config.noise.fuzzMaxMeters + 20); // the runner has moved on a little since, too
    }
  });

  it("walking makes no sound, so you can sneak", () => {
    const { room, config } = makeRoom(apart(30));
    const a = new Client(room, config), b = new Client(room, config);
    expect(play(room, a, b, () => idle({ moveX: 1 }), 120)).toHaveLength(0);
  });

  it("gunfire carries further than running", () => {
    const gap = (config: RoomConfig) => (config.noise.loudness.run + config.noise.loudness.shot) / 2;
    const base = loadRoomConfig();
    const { room, config } = makeRoom(apart(gap(base)));
    const a = new Client(room, config), b = new Client(room, config);
    const running = play(room, a, b, () => idle({ moveX: 1, run: true }), 60);
    expect(running.filter((n) => n.kind === kind("run"))).toHaveLength(0);
    const firing = play(room, a, b, () => idle({ fire: true, targetX: 50, targetY: 2, targetZ: 0 }), 60);
    expect(firing.filter((n) => n.kind === kind("shot")).length).toBeGreaterThan(0);
  });

  it("comes in pulses, not a flood: holding the jets is a beat, not sixty a second", () => {
    const { room, config } = makeRoom(apart(30));
    const a = new Client(room, config), b = new Client(room, config);
    const heard = play(room, a, b, () => idle({ jet: true }), 120);
    const jets = heard.filter((n) => n.kind === kind("jets")).length;
    expect(jets).toBeGreaterThan(0);
    expect(jets).toBeLessThanOrEqual(Math.ceil(2 / config.noise.pulseSeconds) + 1);
  });

  it("you do not hear yourself", () => {
    const { room, config } = makeRoom(apart(30));
    const a = new Client(room, config), b = new Client(room, config);
    play(room, a, b, () => idle({ moveX: 1, run: true }), 120);
    const ownNoises = a.snapshots().flatMap((s) => s.noises);
    expect(ownNoises).toHaveLength(0);
  });
});

describe("bots and noise", () => {
  const bots = parseBotConfig(botsJson);
  const config = loadRoomConfig();
  const ground = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "" })]);

  it("go to look at something they heard when nobody is in sight", () => {
    const bot = new Bot(bots.difficulties.normal!, () => 0.5, bots.path, null);
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    bot.hear(80, 0, 8);
    for (let i = 0; i < 90; i++) bot.think(self, [], null, ground, 1 / 60, input);
    // Facing +X, the way the sound came from, and walking that way. Forward is (-sin yaw, -cos yaw), so +X means sin is negative.
    expect(Math.sin(input.aimYaw)).toBeLessThan(-0.5);
    expect(input.moveY).toBeGreaterThan(0.5);
  });

  it("ignore a sound outside the safe zone rather than walk out of it", () => {
    const bot = new Bot(bots.difficulties.normal!, () => 0.5, bots.path, null);
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    // The ring is centred to the west (-X), and the sound came from the east, outside it.
    const ring = { cx: -10, cz: 0, radius: 60, stage: 1, shrinking: false, damagePerSecond: 2, secondsToChange: 30 };
    bot.hear(90, 0, 8);
    for (let i = 0; i < 90; i++) bot.think(self, [], ring, ground, 1 / 60, input);
    expect(Math.sin(input.aimYaw)).toBeGreaterThan(-0.5); // not facing the sound to the east
  });
});
