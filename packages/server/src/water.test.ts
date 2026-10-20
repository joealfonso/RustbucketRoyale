import { describe, expect, it, vi } from "vitest";
import { NOISE_KINDS, Terrain, World, buildNavGrid, type Box, type MechInput } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { packMap, transferList, unpackMap } from "./mapPack";
import type { Player } from "./Player";
import type { MapForRoom, Room, RoomConfig } from "./Room";
import { Client, idle, makeRoom } from "./testClient";

const base = loadRoomConfig();
const METERS = 200;
const CELL = 4;
const BED_CM = -80; // the whole floor of the test map, 0.8 m down: as deep as generated water gets, near enough

// A flat 200 m map, either dry or under 0.8 m of water everywhere. Built fresh each call, because a match changes
// its World.
function flatMap(wet: boolean): MapForRoom {
  const corners = METERS / CELL + 1;
  const terrain = new Terrain(METERS, CELL, new Int32Array(corners * corners).fill(BED_CM), 0.5, wet ? 0 : null, 0.1);
  const boxes: Box[] = [{ minX: -110, maxX: 110, minZ: -110, maxZ: 110, minY: terrain.minHeight - 2, maxY: terrain.minHeight - 1 }];
  const nav = buildNavGrid(boxes, METERS, 0, 0, { cellMeters: 2, stepHeight: base.mech.stepHeight, mechHeight: base.mech.height }, terrain);
  const spawns: [number, number, number][] = [[0, 0], [40, 0], [-40, 0], [0, 40]].map(([x, z]) => [x!, terrain.minHeight + 0.05, z!]);
  return { world: new World(boxes, 16, terrain), nav, props: [], propOfBox: new Int32Array(boxes.length).fill(-1), spawns, meters: METERS };
}

const onFlat = (wet: boolean) => (c: RoomConfig): RoomConfig => ({ ...c, mapFor: () => flatMap(wet) });
const players = (room: Room) => (room as unknown as { players: Map<number, Player> }).players;
const RUN = NOISE_KINDS.indexOf("run");

function run(room: Room, clients: Client[], input: (c: Client) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c)); room.tick(); }
}

// A runner at the origin and a listener `gap` metres east. Whether the listener's radar showed the running.
function heardRunning(wet: boolean, gap: number): boolean {
  const { room, config } = makeRoom(onFlat(wet));
  const runner = new Client(room, config), listener = new Client(room, config);
  const r = players(room).get(runner.id)!, l = players(room).get(listener.id)!;
  r.state.x = 0; r.state.z = 0;
  l.state.x = gap; l.state.z = 0;
  run(room, [runner, listener], (c) => (c === runner ? idle({ moveY: 1, run: true }) : idle()), 60);
  return listener.snapshots().some((s) => s.noises.some((n) => n.kind === RUN));
}

describe("water", () => {
  const { loudness, wadingFootsteps } = base.noise;
  // Between how far running carries in water and how far on dry ground.
  const between = loudness.run * (1 + wadingFootsteps) / 2;

  it("muffles running: heard at a distance on dry ground, not at the same distance through water", () => {
    expect(wadingFootsteps).toBeLessThan(1); // or this proves nothing
    expect(heardRunning(false, between)).toBe(true);
    expect(heardRunning(true, between)).toBe(false);
  });

  it("muffles running but does not silence it: someone close still hears the splashing", () => {
    expect(heardRunning(true, loudness.run * wadingFootsteps * 0.5)).toBe(true);
  });

  it("bots hear wading footsteps only from as near as people do", () => {
    const botHeard = (wet: boolean) => {
      const { room, config } = makeRoom(onFlat(wet), "small", 1);
      const runner = new Client(room, config);
      const bot = [...players(room).values()].find((p) => p.bot)!;
      const r = players(room).get(runner.id)!;
      r.state.x = 0; r.state.z = 0;
      bot.state.x = -between; bot.state.z = 0;
      const hear = vi.spyOn(bot.bot!, "hear");
      run(room, [runner], () => idle({ moveY: 1, run: true }), 60);
      return hear.mock.calls.length > 0;
    };
    expect(botHeard(false)).toBe(true);
    expect(botHeard(true)).toBe(false);
  });

  it("keeps the water exactly through packing and moving to another thread", () => {
    const made = flatMap(true);
    const packed = packMap(made);
    const map = unpackMap(structuredClone(packed, { transfer: transferList(packed) }));
    const t = map.world.terrain!;
    expect([t.waterLevelCm, t.wadeMeters, t.waterLevel]).toEqual([0, 0.1, 0]);
    expect(t.wading(10, BED_CM / 100, 10)).toBe(true);
    // And a dry map stays dry.
    const dry = unpackMap(packMap(flatMap(false))).world.terrain!;
    expect([dry.waterLevelCm, dry.waterLevel]).toEqual([null, -Infinity]);
    expect(dry.wading(10, BED_CM / 100, 10)).toBe(false);
  });
});
