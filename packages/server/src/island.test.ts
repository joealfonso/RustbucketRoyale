import { describe, expect, it } from "vitest";
import { Predictor, createMechInput, generateMap, mechStatsFor, parseChunkSet, parseMechStats, parsePropConfig, parseTiers, type MechInput } from "@rustbucket/shared";
import { readFileSync } from "node:fs";
import { loadRoomConfig } from "./config";
import { packMap, transferList, unpackMap } from "./mapPack";
import type { Player } from "./Player";
import type { MapForRoom, Room, RoomConfig } from "./Room";
import { Pathfinder } from "./Pathfinder";
import { Client, makeRoom } from "./testClient";

const readJson = (name: string) => JSON.parse(readFileSync(new URL(`../../../data/${name}`, import.meta.url), "utf8"));
const tiers = parseTiers(readJson("tiers.json"));
const chunks = parseChunkSet(readJson("chunks.json"));
const props = parsePropConfig(readJson("props.json"));
const base = loadRoomConfig();
const SEED = 5;
const wadeOut = tiers.terrain!.tiers.arena!.island!.wadeOutMeters;

// The arena island as a browser builds it from the seed, and as the server gets it from a map worker: packed, moved
// to another thread and unpacked. Built fresh each call, because a match changes its World.
const clientMap = () => generateMap(SEED, "arena", chunks, tiers, parseMechStats(readJson("mech.json")), props);
function serverMap(): MapForRoom {
  const m = clientMap();
  const packed = packMap({ world: m.world, nav: m.nav, spawns: m.spawns, meters: m.meters, props: m.props, propOfBox: m.propOfBox });
  return unpackMap(structuredClone(packed, { transfer: transferList(packed) }));
}
const onIsland = (c: RoomConfig): RoomConfig => ({ ...c, mapFor: serverMap });
const players = (room: Room) => (room as unknown as { players: Map<number, Player> }).players;

// A clear lane from inland out to sea: a start on land and the heading (yaw) that walks it.
function laneToSea(): { x: number; z: number; yaw: number } {
  const map = clientMap(), t = map.terrain, nearby: number[] = [];
  for (let a = 0; a < 360; a += 5) {
    const dx = Math.cos((a * Math.PI) / 180), dz = Math.sin((a * Math.PI) / 180);
    let start = 0;
    while (t.coastAt(dx * start, dz * start) > 20) start++;
    let clear = true;
    for (let d = start; d < start + 40 && clear; d++) {
      const count = map.world.query(dx * d - 3, dz * d - 3, dx * d + 3, dz * d + 3, nearby);
      for (let i = 0; i < count; i++) if (nearby[i] !== 0) clear = false;
    }
    if (clear) return { x: dx * start, z: dz * start, yaw: Math.atan2(-dx, -dz) };
  }
  throw new Error("no clear lane to the sea");
}

describe("the island's sea on the server and in prediction", () => {
  const lane = laneToSea();

  // One player heads out to sea with the given input for `seconds`, predicting on the browser's map while the server
  // steps it on the worker's. Returns where both ended up and how far out to sea each ever got.
  function headOut(input: (step: number) => Partial<MechInput>, seconds: number) {
    const { room, config } = makeRoom(onIsland, "arena", 0);
    const client = new Client(room, config);
    const map = clientMap();
    const y = map.terrain.heightAt(lane.x, lane.z);
    client.predictor = new Predictor(mechStatsFor(config.mech, config.roster ?? null), map.world, lane.x, y, lane.z, lane.yaw);
    const server = players(room).get(client.id)!.state;
    Object.assign(server, { x: lane.x, y, z: lane.z, vx: 0, vy: 0, vz: 0, bodyYaw: lane.yaw });
    let serverFurthest = Infinity, clientFurthest = Infinity;
    const t = map.terrain;
    for (let i = 0; i < seconds * 60; i++) {
      client.send({ ...createMechInput(), aimYaw: lane.yaw, moveY: 1, ...input(i) });
      room.tick();
      serverFurthest = Math.min(serverFurthest, t.coastAt(server.x, server.z));
      clientFurthest = Math.min(clientFurthest, t.coastAt(client.predictor.state.x, client.predictor.state.z));
    }
    return { server, client: client.predictor.state, serverFurthest, clientFurthest, t };
  }

  for (const [name, input] of [
    ["walking", () => ({})],
    ["running", () => ({ run: true })],
    ["dashing", (i: number) => ({ dash: i % 30 === 0 })],
    ["jetting", () => ({ jet: true })],
  ] as const) {
    it(`stops a mech ${name} out to sea at the same line on the server and in prediction`, () => {
      const { server, client, serverFurthest, clientFurthest, t } = headOut(input, 8);
      expect(serverFurthest).toBeGreaterThanOrEqual(-wadeOut);
      expect(clientFurthest).toBe(serverFurthest);
      expect(t.coastAt(server.x, server.z)).toBeLessThan(-wadeOut + 1); // right up to the line, not short of it
      expect([client.x, client.y, client.z]).toEqual([server.x, server.y, server.z]);
    });
  }

  it("keeps the coastline through packing, so the server knows where the sea is", () => {
    const sent = serverMap().world.terrain!, made = clientMap().terrain;
    expect(sent.island).toBe(true);
    expect([...sent.coast!]).toEqual([...made.coast!]);
    expect(sent.wadeOutCm).toBe(made.wadeOutCm);
  });

  it("routes bots round the sea, and to the nearest shore when told to go out to it", () => {
    const map = clientMap();
    const finder = new Pathfinder(map.nav, base.bots.path, map.terrain);
    const out: number[] = [];
    const [sx, , sz] = map.spawns[0]!;
    // A goal far out in the map's corner, past the limit.
    expect(finder.findPath(sx, sz, -map.meters / 2 + 1, -map.meters / 2 + 1, out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    for (let k = 0; k < out.length; k += 2) expect(map.terrain.mayStand(out[k]!, out[k + 1]!)).toBe(true);
    expect(finder.reachedGoal).toBe(false); // so the bot gives the goal up at the shore

  });
});
