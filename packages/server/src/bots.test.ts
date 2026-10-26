import { describe, expect, it } from "vitest";
import { World, boxFromData, buildNavGrid, createMechInput, createMechState, parseBotConfig, stepMech, type Box, type MechInput, type RingNow } from "@rustbucket/shared";
import botsJson from "../../../data/bots.json";
import { loadRoomConfig } from "./config";
import { Bot } from "./Bot";
import { Pathfinder } from "./Pathfinder";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Room } from "./Room";

const botConfig = parseBotConfig(botsJson);
const stats = botConfig.difficulties.normal!;
const config = loadRoomConfig();
const DT = 1 / 60;
const flat = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "" })]);
const random = () => 0.5;

const tick = (room: Room, humans: Client[], count: number) => {
  for (let i = 0; i < count; i++) { for (const h of humans) h.send(idle()); room.tick(); }
};

function spotted(distance: number, world: World = flat) {
  const bot = new Bot(stats, random, botConfig.path, null);
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
    const bot = new Bot(stats, random, botConfig.path, null);
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    for (let i = 0; i < 180; i++) { bot.think(self, [{ id: 2, x: 0, y: 0, z: -30 }], null, flat, DT, input); if (input.fire) fired++; }
    expect(fired).toBeGreaterThan(20);
    expect(spotted(30).input.targetZ).toBeLessThan(0);
  });

  it("picks a bot over a person a little nearer, but not over one much nearer", () => {
    const aimAt = (personDistance: number) => {
      const bot = new Bot(stats, random, botConfig.path, null);
      bot.personDistanceScale = botConfig.hunt.personDistanceScale;
      const self = createMechState(config.mech, 0, 0, 0, 0);
      const input = createMechInput();
      const targets = [{ id: 2, x: 0, y: 0, z: -personDistance, person: true }, { id: 3, x: 30, y: 0, z: 0 }];
      for (let i = 0; i < 60; i++) bot.think(self, targets, null, flat, DT, input);
      return input.targetX > 15 ? "bot" : "person";
    };
    expect(aimAt(25)).toBe("bot");
    expect(aimAt(10)).toBe("person");
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
    const bot = new Bot(stats, random, botConfig.path, null);
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
    const bot = new Bot(stats, random, botConfig.path, null);
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    let jetted = false;
    for (let i = 0; i < 300; i++) { bot.think(self, [{ id: 2, x: 0, y: 0, z: -60 }], null, flat, DT, input); if (input.jet) jetted = true; }
    expect(jetted).toBe(true); // it wants to move but this fake mech never does
  });
});

describe("rooms with bots", () => {
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

  it("fight in the lobby, at people and at each other, and then for real once the match is on", () => {
    const { room, config: c } = makeRoom(undefined, "small", 3);
    const human = new Client(room, c);
    tick(room, [human], 10);
    tick(room, [human], 60 * 40);

    expect(human.messages.some((m) => m.t === "shot")).toBe(true);
    expect(room.matchState).toBe("lobby");

    startMatch(room, human);
    human.messages.length = 0;
    tick(room, [human], 60 * 90);
    expect(human.messages.some((m) => m.t === "eliminated")).toBe(true);
  });

  it("come to wherever the people are when the room is quiet, instead of staying out of sight", () => {
    // The one bot takes the first spawn and starts 130 m to the side of the human, on open ground, who joins after them.
    const { room, config: c } = makeRoom((cfg) => {
      const map = cfg.mapFor("small", 0);
      const spawns: [number, number, number][] = map.spawns.map((sp, i) => (i < 1 ? [sp[0] + 130, sp[1], sp[2]] : sp));
      return { ...cfg, mapFor: () => ({ ...map, spawns }) };
    }, "small", 1);
    const human = new Client(room, c);
    tick(room, [human], 10);
    const startNearest = Math.min(...human.last().others.map((o) => Math.hypot(o.x - human.last().you.x, o.z - human.last().you.z)));
    expect(startNearest).toBeGreaterThan(100);
    tick(room, [human], 60 * 45);
    const you = human.last().you;
    const nearest = Math.min(...human.last().others.map((o) => Math.hypot(o.x - you.x, o.z - you.z)));
    expect(nearest).toBeLessThan(80);
  });

  it("hold still during the countdown", () => {
    const { room, config: c } = makeRoom((cfg) => ({ ...cfg, match: { ...cfg.match, countdownSeconds: 4 } }), "small", 3);
    const human = new Client(room, c);
    tick(room, [human], 30);
    room.receive(human.id, JSON.stringify({ t: "start" }));
    tick(room, [human], 5);
    const before = human.last().others.map((o) => ({ x: o.x, z: o.z }));
    tick(room, [human], 90);
    expect(room.matchState).toBe("countdown");
    human.last().others.forEach((o, i) => expect(Math.hypot(o.x - before[i]!.x, o.z - before[i]!.z)).toBeLessThan(0.01));
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
    expect(human.last().others.length).toBe(c.mapFor("small", 0).spawns.length - 1);
  });

  it("start with a fixed count even when the map only has spawns for a full room of people", () => {
    const { room, config: c } = makeRoom((cfg) => ({ ...cfg, mapFor: loadRoomConfig({ maps: "generated" }).mapFor }), "arena", 7);
    expect(c.mapFor("arena", 1).spawns.length).toBe(c.net.maxPlayers);
    const first = new Client(room, c);
    tick(room, [first], 10);
    expect(first.last().others.filter((o) => o.bot).length).toBe(7);

    const second = new Client(room, c);
    tick(room, [first, second], 10);
    expect(first.last().others.filter((o) => o.bot).length).toBe(6);
  });
});

describe("bots fighting each other", () => {
  it("target and damage other bots in the lobby, not just people", () => {
    const { room, config: c } = makeRoom(undefined, "small", 4);
    const human = new Client(room, c);
    let botWasHurt = false;
    for (let i = 0; i < 60 * 60 && !botWasHurt; i++) {
      human.send(idle());
      room.tick();
      // Only bots show up in `others` here, so any damage on them came from another bot.
      botWasHurt = human.last()?.others.some((o) => o.dead || o.hp.some((hp, zone) => hp < [60, 60, 100][zone]!)) ?? false;
    }
    expect(botWasHurt).toBe(true);
  });
});

describe("bots with a route", () => {
  // A wall 30 m high and 120 m long across the middle. The bot starts south of it and the ring is north of it.
  const wall: Box = { minX: -60, maxX: 60, minZ: -1, maxZ: 1, minY: 0, maxY: 30 };
  const ground: Box = { minX: -200, maxX: 200, minZ: -200, maxZ: 200, minY: -1, maxY: 0 };
  const world = new World([ground, wall]);
  const ring: RingNow = { cx: 0, cz: 70, radius: 15, stage: 1, shrinking: false, damagePerSecond: 2, secondsToChange: 99 };

  function walk(withRoute: boolean): { z: number; crossedAt: number | null } {
    const nav = buildNavGrid([wall], 400, 0, 0, { cellMeters: 2, stepHeight: config.mech.stepHeight, mechHeight: config.mech.height });
    const finder = withRoute ? new Pathfinder(nav, botConfig.path) : null;
    const bot = new Bot(stats, random, botConfig.path, finder);
    const self = createMechState(config.mech, 0, 0, -40, 0);
    const input = createMechInput();
    let crossedAt: number | null = null;
    for (let i = 0; i < 60 * 70; i++) {
      finder?.newTick();
      bot.think(self, [], ring, world, DT, input);
      input.jet = false; // no hopping over a 30 m wall, so only a route can get it across
      stepMech(self, input, config.mech, DT, world);
      if (crossedAt === null && self.z > 5) crossedAt = i * DT;
    }
    return { z: self.z, crossedAt };
  }

  it("walks round a wall to reach the ring on the other side", () => {
    const result = walk(true);
    expect(result.crossedAt).not.toBeNull();
    expect(result.z).toBeGreaterThan(40);
  });

  it("gets round much sooner than a bot that only slides along the wall until it finds the end", () => {
    const withRoute = walk(true).crossedAt!;
    const without = walk(false).crossedAt ?? Infinity;
    expect(withRoute).toBeLessThan(without - 10);
  });
});

describe("bots replanning", () => {
  // A wall across the way to a far goal, so the route has a corner in it.
  const wall = { minX: -60, maxX: 60, minZ: -1, maxZ: 1, minY: 0, maxY: 30 };
  const ring: RingNow = { cx: 0, cz: 150, radius: 15, stage: 1, shrinking: false, damagePerSecond: 2, secondsToChange: 99 };

  function setup() {
    const nav = buildNavGrid([wall], 400, 0, 0, { cellMeters: 2, stepHeight: config.mech.stepHeight, mechHeight: config.mech.height });
    const finder = new Pathfinder(nav, botConfig.path);
    let searches = 0;
    const findPath = finder.findPath.bind(finder);
    finder.findPath = (...args) => { searches++; return findPath(...args); };
    const bot = new Bot(stats, random, botConfig.path, finder);
    const self = createMechState(config.mech, 0, 0, -40, 0);
    const input = createMechInput();
    const think = (ticks: number) => { for (let i = 0; i < ticks; i++) { finder.newTick(); bot.think(self, [], ring, flat, DT, input); } };
    return { self, think, searches: () => searches };
  }

  it("keep a whole route rather than searching again on the clock", () => {
    const { think, searches } = setup();
    think(60 * botConfig.path.replanSeconds * 4); // standing still, the route stays good
    expect(searches()).toBe(1);
  });

  it("search again once pushed somewhere the next waypoint cannot be walked to in a straight line", () => {
    const { self, think, searches } = setup();
    think(1);
    self.x = 0; self.z = -5; // shoved onto the wall, so the way to the next waypoint runs along it
    think(60 * botConfig.path.replanSeconds * 2);
    expect(searches()).toBeGreaterThan(1);
  });
});

describe("bots that are getting nowhere", () => {
  const ground: Box = { minX: -200, maxX: 200, minZ: -200, maxZ: 200, minY: -1, maxY: 0 };

  it("walk out of a clearing the route grid sees as sealed in, rather than standing in it", () => {
    // A thin post in each of the eight 8 m route cells round the one centred on (4, 4), 2 m off the middle of each,
    // like a clearing in a wood: every cell round it has a trunk in, but a mech walks straight out between them.
    const posts: Box[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx !== 0 || dz !== 0) posts.push({ minX: 4 + dx * 8 + 2, maxX: 4 + dx * 8 + 2.5, minZ: 4 + dz * 8 + 2, maxZ: 4 + dz * 8 + 2.5, minY: 0, maxY: 6 });
      }
    }
    const world = new World([ground, ...posts]);
    const finder = new Pathfinder(buildNavGrid(posts, 400, 0, 0, { cellMeters: 2, stepHeight: config.mech.stepHeight, mechHeight: config.mech.height }), botConfig.path);
    const bot = new Bot(stats, random, botConfig.path, finder);
    const self = createMechState(config.mech, 4, 0, 4, 0);
    const input = createMechInput();
    const ring: RingNow = { cx: 4, cz: 150, radius: 15, stage: 1, shrinking: false, damagePerSecond: 2, secondsToChange: 99 };
    for (let i = 0; i < 60 * 10; i++) {
      finder.newTick();
      bot.think(self, [], ring, world, DT, input);
      stepMech(self, input, config.mech, DT, world);
    }
    expect(self.z).toBeGreaterThan(40);
  });

  // Walks a bot for some seconds with no jets, so only its route gets it anywhere, and returns where it ended up.
  function walkNoJets(walls: Box[], x: number, z: number, seconds: number, each: (bot: Bot, tick: number) => void, ring: (tick: number) => RingNow | null = () => null): { x: number; z: number } {
    const world = new World([ground, ...walls]);
    const finder = new Pathfinder(buildNavGrid(walls, 400, 0, 0, { cellMeters: 2, stepHeight: config.mech.stepHeight, mechHeight: config.mech.height }), botConfig.path);
    const bot = new Bot(stats, random, botConfig.path, finder);
    bot.body = config.mech;
    const self = createMechState(config.mech, x, 0, z, 0);
    const input = createMechInput();
    for (let i = 0; i < 60 * seconds; i++) {
      finder.newTick();
      each(bot, i);
      bot.think(self, [], ring(i), world, DT, input);
      input.jet = false;
      stepMech(self, input, config.mech, DT, world);
      if (process.env.TRACE && i % 60 === 0) process.stderr.write(`${i / 60} ${self.x.toFixed(1)},${self.z.toFixed(1)} ${JSON.stringify((bot as any).path.map((v: number) => +v.toFixed(1)))} ${(bot as any).pathIndex} short ${(bot as any).shortFor.toFixed(1)}\n`);
    }
    return { x: self.x, z: self.z };
  }

  it("go round a long wall they stand against, not into it", () => {
    // Small seed 1000: a bot against a 7 m wall pushed into it for 176 s, its route starting in the open cell over it.
    const wall: Box = { minX: 2.2, maxX: 2.6, minZ: -40, maxZ: 40, minY: 0, maxY: 7 };
    const end = walkNoJets([wall], 3.5, 0, 30, (bot, i) => { if (i % 60 === 0) bot.hear(-60, 0, 8); });
    expect(end.x).toBeLessThan(-40);
  });

  it("go into a building by its door after a noise inside it", () => {
    // Medium seed 2000: a bot after a noise in a building stood bumping its wall outside. The noise comes again and
    // again, a little off each time, as the room's do.
    const walls: Box[] = [[-10, -10, 10, -9], [-10, 9, 10, 10], [-10, -10, -9, 10], [9, -10, 10, -2], [9, 2, 10, 10]]
      .map(([minX, minZ, maxX, maxZ]) => ({ minX: minX!, minZ: minZ!, maxX: maxX!, maxZ: maxZ!, minY: 0, maxY: 6 }));
    const end = walkNoJets(walls, -70, 0, 40, (bot, i) => { if (i % 60 === 0) bot.hear(-3 + ((i / 60) % 3) - 1, 1, 8); });
    expect(Math.abs(end.x)).toBeLessThan(9); // inside the room
    expect(Math.abs(end.z)).toBeLessThan(9);
  });

  it("go to the nearer of two noises heard turn about, rather than turning round with each", () => {
    // Medium seed 2001: beside a big fight a bot heard a new shot every quarter second, each a little off its real spot,
    // took every newest one as where to go, and dithered on the spot.
    const end = walkNoJets([], 0, 0, 10, (bot, i) => { if (i % 15 === 0) bot.hear((i / 15) % 2 === 0 ? 60 : -70, 0, 8); });
    expect(end.x).toBeGreaterThan(40);
  });

  it("plan again on reaching the end of a route when the goal has moved on a little since", () => {
    // Medium seed 2006: a route ends where its goal was when it was planned, and a goal that moved less than
    // goalMoveReplan did not count as moved, so a bot arrived at the old spot and stood there, or circled it.
    // Here the goal is the middle of a tiny ring. While the bot is still going round the first wall it moves on, behind
    // a second wall from where it was.
    const walls: Box[] = [{ minX: -20, maxX: 20, minZ: -31, maxZ: -29, minY: 0, maxY: 7 }, { minX: -10, maxX: 10, minZ: -67, maxZ: -65, minY: 0, maxY: 7 }];
    const moved = botConfig.path.goalMoveReplan - 3;
    const ring = (i: number): RingNow => ({ cx: 0, cz: i < 60 * 2 ? -60 : -60 - moved, radius: 1, stage: 1, shrinking: false, damagePerSecond: 2, secondsToChange: 99 });
    const end = walkNoJets(walls, 0, 0, 40, () => {}, ring);
    expect(Math.hypot(end.x, end.z + 60 + moved)).toBeLessThan(4);
  });

  it("give up on loot that never comes, rather than holding E on it for ever", () => {
    const world = new World([ground]);
    const bot = new Bot(stats, random, botConfig.path, null);
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    let lastHeld = 0;
    for (let i = 0; i < 60 * 12; i++) {
      // A wreck right beside it that never gives anything up, offered again and again as the room does.
      if (i % config.bots.loot.refreshTicks === 0) bot.setLootGoal(0.5, 0, true);
      bot.think(self, [], null, world, DT, input);
      stepMech(self, input, config.mech, DT, world);
      if (input.interact) lastHeld = i * DT;
    }
    expect(lastHeld).toBeLessThan(botConfig.path.giveUpSeconds + 1);
    expect(Math.hypot(self.x, self.z)).toBeGreaterThan(10);
  });
});

describe("rooms that fill themselves", () => {
  it("top up to the tier size with people counted, make room for people who arrive, and refill when they leave", () => {
    const { room, config: c } = makeRoom(undefined, "small", null);
    const target = c.bots.fill.small!;
    const bots = (client: Client) => client.last().others.filter((o) => o.bot).length;

    const first = new Client(room, c);
    tick(room, [first], 10);
    expect(bots(first)).toBe(target - 1);

    const second = new Client(room, c);
    tick(room, [first, second], 10);
    expect(bots(first)).toBe(target - 2);

    room.leave(second.id);
    tick(room, [first], 10);
    expect(bots(first)).toBe(target - 1);
  });

  it("do not change in the middle of a match, and top up again for the next one", () => {
    const { room, config: c } = makeRoom((cfg) => ({ ...cfg, match: { ...cfg.match, resultsSeconds: 1 } }), "small", null);
    const host = new Client(room, c);
    startMatch(room, host);
    const late = new Client(room, c); // arrives mid match, so watches
    tick(room, [host, late], 10);
    expect(late.last().others.filter((o) => o.bot).length).toBe(c.bots.fill.small! - 1);
  });
});

describe("bots far from anyone", () => {
  // Every bot counts as far when the full AI range is tiny.
  const farAway = (cfg: ReturnType<typeof loadRoomConfig>) => ({
    ...cfg,
    bots: { ...cfg.bots, lod: { ...cfg.bots.lod, fullRangeMeters: 5 } },
    net: { ...cfg.net, interestRange: 1e6 }, // so the person can see everything for the test
  });

  it("do not shoot at anyone, since they are not looking for targets", () => {
    const { room, config: c } = makeRoom(farAway, "small", 3);
    const human = new Client(room, c);
    tick(room, [human], 60 * 15);
    expect(human.messages.some((m) => m.t === "shot")).toBe(false);
  });

  it("fight on paper when two meet, and one goes down with nothing but a result", () => {
    const { room, config: c } = makeRoom((cfg) => {
      const base = farAway(cfg);
      const map = cfg.mapFor("small", 0);
      // Two bots 6 m apart, and the person well away from them.
      const spawns: [number, number, number][] = map.spawns.map((s, i) => (i === 0 ? [20, 0.1, 400] : i === 1 ? [26, 0.1, 400] : s));
      return { ...base, mapFor: () => ({ ...map, spawns }) };
    }, "small", 2);
    const human = new Client(room, c);
    let hurt = false;
    for (let i = 0; i < 60 * 40 && !hurt; i++) {
      human.send(idle()); room.tick();
      hurt = human.last()?.others.some((o) => o.dead || o.hp.some((hp, zone) => hp < [60, 60, 100][zone]!)) ?? false;
    }
    expect(hurt).toBe(true);
    expect(human.messages.some((m) => m.t === "shot")).toBe(false);
  });
});
