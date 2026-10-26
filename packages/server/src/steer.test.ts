import { describe, expect, it } from "vitest";
import { World, createMechInput, createMechState, parseBotConfig, stepMech, type Box, type RingNow } from "@rustbucket/shared";
import botsJson from "../../../data/bots.json";
import { Bot } from "./Bot";
import { loadRoomConfig } from "./config";
import { createSteerMemory, steerRound } from "./steer";
import { lcg } from "./testClient";

const botConfig = parseBotConfig(botsJson);
const mech = loadRoomConfig().mech;
const DT = 1 / 60;
const ground: Box = { minX: -500, maxX: 500, minZ: -500, maxZ: 500, minY: -1, maxY: 0 };
// A pine's trunk, as data/props.json sizes it: 1 m across and 12 m tall, far too tall to hop.
const trunk = (x: number, z: number): Box => ({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5, minY: 0, maxY: 12 });
// The ring far down -Z with the bot outside it, so it runs straight there: no route, like a route through a wood.
const ring: RingNow = { cx: 0, cz: -200, radius: 15, stage: 1, shrinking: false, damagePerSecond: 2, secondsToChange: 99 };

// Walks a bot from (x, 0) towards the ring for `seconds`, without jets, and reports how far down -Z it got and the
// longest spell it spent going nowhere (under a metre in a second) before it was out past `woodEnd`. Past the wood it
// reaches the ring and stands about, which is not being stuck.
function cross(world: World, x: number, steer: boolean, seconds = 30, seed = 1, woodEnd = -110) {
  const bot = new Bot(botConfig.difficulties.normal!, lcg(seed), botConfig.path, null);
  if (steer) bot.body = mech;
  const self = createMechState(mech, x, 0, 0, Math.PI);
  const input = createMechInput();
  const trail: number[] = [];
  let longestStuck = 0, stuckFor = 0;
  for (let i = 0; i < seconds * 60; i++) {
    bot.think(self, [], ring, world, DT, input);
    input.jet = false;
    stepMech(self, input, mech, DT, world);
    trail.push(self.x, self.z);
    if (i >= 60 && self.z > woodEnd) {
      const k = (i - 60) * 2;
      const moved = Math.hypot(self.x - trail[k]!, self.z - trail[k + 1]!);
      stuckFor = moved < 1 ? stuckFor + DT : 0;
      longestStuck = Math.max(longestStuck, stuckFor);
    }
  }
  return { z: self.z, longestStuck };
}

describe("steering round trunks", () => {
  // Rows of trunks 6 m apart from z = -10 to z = -100, one dead on the bot's line in every row.
  const grid: Box[] = [ground];
  for (let z = -10; z >= -100; z -= 6) for (let x = -30; x <= 30; x += 6) grid.push(trunk(x, z));
  const dense = new World(grid);

  it("gets a bot through a dense grid of trunks without getting stuck for long", () => {
    const { z, longestStuck } = cross(dense, 0, true);
    expect(z).toBeLessThan(-110); // out the far side
    expect(longestStuck).toBeLessThan(1.5);
  });

  it("does much better than a bot that only bumps and hops sideways", () => {
    const steered = cross(dense, 0, true, 15).z;
    const bumping = cross(dense, 0, false, 15).z;
    expect(steered).toBeLessThan(bumping - 20);
  });

  it("gets every bot through a wood laid out like the generated ones", () => {
    // The forest pass's spacing, a trunk every 9 m each nudged up to 3 m either way, with a boulder (2 to 4.5 m,
    // part sunk) in place of the odd tree. Nothing keeps them apart here, unlike the generator, so this is the
    // harder case.
    const random = lcg(7);
    const boxes: Box[] = [ground];
    for (let z = -12; z >= -150; z -= 9) {
      for (let x = -60; x <= 60; x += 9) {
        const px = x + Math.round(random() * 6 - 3), pz = z + Math.round(random() * 6 - 3);
        const half = 1 + Math.round(random() * 12) / 10 * 1.25;
        boxes.push(random() < 0.08 ? { minX: px - half, maxX: px + half, minZ: pz - half, maxZ: pz + half, minY: -0.6, maxY: half * 1.4 } : trunk(px, pz));
      }
    }
    const wood = new World(boxes);
    for (let start = -20; start <= 20; start += 5) {
      const { z, longestStuck } = cross(wood, start, true, 30, start + 100, -160);
      expect(z, `bot from x ${start}`).toBeLessThan(-160);
      expect(longestStuck, `bot from x ${start}`).toBeLessThan(1.5);
    }
  });

  it("steps off the edge of a wall its line only catches by the shoulder", () => {
    // Small seed 2019: a bot going along a gap in a scrap pile caught the corner of a 8 m block by 0.35 m with its side
    // and pressed flat into its face for 9 s, the block too big to step round and the route running along its edge.
    const block: Box = { minX: 10, maxX: 18, minZ: -11.85, maxZ: -4.15, minY: 0, maxY: 6 };
    const world = new World([ground, block]);
    const bot = new Bot(botConfig.difficulties.normal!, lcg(1), botConfig.path, null);
    bot.body = mech;
    const self = createMechState(mech, 0, 0, -3.6, 0);
    const input = createMechInput();
    const east: RingNow = { ...ring, cx: 200, cz: -3.6 };
    for (let i = 0; i < 6 * 60; i++) {
      bot.think(self, [], east, world, DT, input);
      input.jet = false;
      stepMech(self, input, mech, DT, world);
    }
    expect(self.x).toBeGreaterThan(30);
  });

  it("leaves the way alone when nothing small is in it", () => {
    const wall: Box = { minX: -40, maxX: 40, minZ: -11, maxZ: -9, minY: 0, maxY: 10 }; // a wall is the route's job
    const world = new World([ground, trunk(5, -3), wall, { minX: -1, maxX: 1, minZ: -4, maxZ: -2, minY: 0, maxY: 0.4 }]); // the last one is stepped onto
    const out = { x: 0, z: 0 };
    steerRound(world, 0, 0, 0, 0, -1, mech, botConfig.path, createSteerMemory(), out);
    expect(out).toEqual({ x: 0, z: -1 });
  });

  it("keeps to the side it chose while it goes past", () => {
    const world = new World([ground, trunk(0, -3)]);
    const memory = createSteerMemory();
    const out = { x: 0, z: 0 };
    steerRound(world, 0.1, 0, 0, 0, -1, mech, botConfig.path, memory, out); // a hair to the right of the trunk's line: passes right
    expect(out.x).toBeGreaterThan(0);
    steerRound(world, -0.1, 0, 0, 0, -1, mech, botConfig.path, memory, out); // pushed a hair left, it still goes right
    expect(out.x).toBeGreaterThan(0);
  });

  it("goes round the outside of two things too close together to pass between", () => {
    // Trunks at x = -1.5 and 1.5 leave a 2 m gap, too narrow for a 1.8 m mech with room to spare. A bot a little
    // left of the middle goes round the left trunk, not into the gap.
    const world = new World([ground, trunk(-1.5, -3), trunk(1.5, -3)]);
    const out = { x: 0, z: 0 };
    steerRound(world, -0.3, 0, 0, 0, -1, mech, botConfig.path, createSteerMemory(), out);
    expect(out.x).toBeLessThan(0);
    // Off to the left of both, it would end up past the left one: the far trunk does not pull it back.
    steerRound(world, -3.6, 0, 0, 0, -1, mech, botConfig.path, createSteerMemory(), out);
    expect(out).toEqual({ x: 0, z: -1 });
  });
});
