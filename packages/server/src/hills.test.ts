import { describe, expect, it } from "vitest";
import {
  ITEM_GRENADE, Terrain, World, addProp, buildNavGrid, type Box, type Loadout, type PickupState, type PropInstance, type ServerMessage,
} from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import type { Player } from "./Player";
import type { MapForRoom, Room, RoomConfig } from "./Room";
import { Client, idle, makeRoom, tickRoom } from "./testClient";

const base = loadRoomConfig();
const METERS = 200;
const CELL = 4;
const RISE = 0.25; // metres up per metre east: plainly a slope, well under walking steepness
const CRATE = 0, BARREL = 1; // prop ids on the test map

// A 200 m map that is one long slope rising to the east, 25 m up at the middle, with a crate and a barrel standing
// on it. Built fresh each call, because a match switches broken props off in its World.
function slopeTerrain(): Terrain {
  const corners = METERS / CELL + 1;
  const heights = new Int32Array(corners * corners);
  for (let j = 0; j < corners; j++) for (let i = 0; i < corners; i++) heights[j * corners + i] = Math.round(i * CELL * RISE * 100);
  return new Terrain(METERS, CELL, heights, 0.5);
}
const terrain = slopeTerrain();
const ground = (x: number, z: number) => terrain.heightAt(x, z);

function slopeMap(spawnAt: [number, number][]): MapForRoom {
  const boxes: Box[] = [{ minX: -110, maxX: 110, minZ: -110, maxZ: 110, minY: terrain.minHeight - 2, maxY: terrain.minHeight - 1 }];
  const props: PropInstance[] = [];
  // As generation does: a prop stands on the lowest ground under it, so no corner floats.
  const place = (type: number, x: number, z: number) => {
    const [sx, , sz] = base.props.types[type]!.size;
    addProp(boxes, props, base.props, type, x, z, Math.min(ground(x - sx / 2, z), ground(x + sx / 2, z)));
  };
  place(0, 10, 10); // crate
  place(2, 30, -10); // barrel
  const propOfBox = new Int32Array(boxes.length).fill(-1);
  for (const p of props) propOfBox[p.boxIndex] = p.id;
  const nav = buildNavGrid(boxes, METERS, 0, 0, { cellMeters: 2, stepHeight: base.mech.stepHeight, mechHeight: base.mech.height }, terrain);
  const spawns = spawnAt.map(([x, z]): [number, number, number] => [x, ground(x, z) + 0.05, z]);
  return { world: new World(boxes, 16, terrain), nav, props, propOfBox, spawns, meters: METERS };
}

const onSlope = (spawnAt: [number, number][] = [[0, 0], [-20, 0], [-40, 0], [-60, 0]]) => (c: RoomConfig): RoomConfig => ({
  ...c,
  mapFor: () => slopeMap(spawnAt),
  // Every prop drops a grenade, so there is always something to look at.
  loot: { ...c.loot, drops: { crate: { chance: 1, table: { grenade: 1 } }, junk: { chance: 1, table: { grenade: 1 } }, barrel: { chance: 0, table: {} } } },
});

// The room's private parts these tests look at.
interface Inside {
  players: Map<number, Player>;
  pickups: { near(x: number, z: number, range: number, out: PickupState[]): PickupState[] };
  pendingBlasts: { x: number; y: number; z: number }[];
  damageProp(id: number, amount: number, by: Player | null): void;
  spill(wreck: Player): void;
}
const inside = (room: Room) => room as unknown as Inside;
const allPickups = (room: Room) => [...inside(room).pickups.near(0, 0, METERS * 2, [])];

describe("a room on hills", () => {
  it("drops a broken prop's loot on the hillside, not at the height of flat ground", () => {
    const { room } = makeRoom(onSlope());
    inside(room).damageProp(CRATE, 1000, null);
    const [pickup] = allPickups(room);
    expect(pickup).toBeDefined();
    expect(pickup!.y).toBeCloseTo(ground(pickup!.x, pickup!.z) + 0.5, 6);
  });

  it("spills a looted wreck's items on the slope round it, uphill and downhill alike", () => {
    const { room, config } = makeRoom(onSlope());
    const c = new Client(room, config);
    const wreck = inside(room).players.get(c.id)!;
    const loadout: Loadout = { slots: [0, 1], active: 0, grenades: 3, armor: [1, 1, 1], upgrades: [-1, -1] };
    wreck.loadout = loadout;
    inside(room).spill(wreck);
    const items = allPickups(room);
    expect(items.length).toBe(8);
    expect(items.some((p) => p.x > wreck.state.x + 0.5) && items.some((p) => p.x < wreck.state.x - 0.5)).toBe(true);
    for (const p of items) expect(p.y, `item ${p.item} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeCloseTo(ground(p.x, p.z) + 0.5, 6);
    expect(items.some((p) => p.item === ITEM_GRENADE)).toBe(true);
  });

  it("sets a barrel off from the ground it stood on, so it hurts a mech beside it on the slope", () => {
    // The first player stands 3 m from the barrel, across the slope.
    const { room, config } = makeRoom(onSlope([[30, -13], [-60, 0]]));
    const victim = new Client(room, config);
    tickRoom(room, 30); // settle on the ground
    inside(room).damageProp(BARREL, 1000, null);
    const blast = inside(room).pendingBlasts[0]!;
    expect(blast.y).toBeCloseTo(ground(30, -10), 6);
    for (let i = 0; i < 60; i++) { victim.send(idle()); room.tick(); }
    const hp = victim.last().health.hp;
    expect(hp.some((v, zone) => v < config.zones.zones[zone]!.hp)).toBe(true);
  });

  it("stops a shot at the hillside in front of it", () => {
    const { room, config } = makeRoom(onSlope());
    const shooter = new Client(room, config);
    tickRoom(room, 30);
    const you = shooter.last().you;
    // Level, uphill to the east: the slope rises past chest height a few metres on.
    for (let i = 0; i < 10; i++) { shooter.send(idle({ fire: true, targetX: you.x + 100, targetY: you.y + 2.5, targetZ: you.z })); room.tick(); }
    const shots = shooter.messages.filter((m): m is Extract<ServerMessage, { t: "shot" }> => m.t === "shot");
    expect(shots.length).toBeGreaterThan(0);
    for (const s of shots) {
      expect(s.length).toBeLessThan(20);
      // It ends in the ground, give or take the marching step of the terrain ray.
      expect(s.oy + s.dy * s.length).toBeCloseTo(ground(s.ox + s.dx * s.length, s.oz + s.dz * s.length), 1);
    }
  });

  it("keeps a far bot, moved only a few times a second, on the ground as it walks up and down the slope", () => {
    // No people at all, so the bot is never near anyone and always takes the cheap path.
    const { room } = makeRoom(onSlope(), "small", 1);
    let lowest = Infinity, onGround = 0, ticks = 0;
    let minY = Infinity, maxY = -Infinity, travelled = 0, last: { x: number; z: number } | null = null;
    for (let i = 0; i < 60 * 60; i++) {
      room.tick();
      const bot = room.inspect().find((m) => m.bot)!;
      const above = bot.y - ground(bot.x, bot.z);
      lowest = Math.min(lowest, above);
      if (above < 0.1) onGround++;
      ticks++;
      minY = Math.min(minY, bot.y); maxY = Math.max(maxY, bot.y);
      if (last) travelled += Math.hypot(bot.x - last.x, bot.z - last.z);
      last = bot;
    }
    expect(lowest).toBeGreaterThanOrEqual(-1e-9);
    expect(travelled).toBeGreaterThan(50);
    expect(maxY - minY).toBeGreaterThan(5); // it really went up or down the hill
    expect(onGround / ticks).toBeGreaterThan(0.8); // walking on it, not hopping over it
  });
});
