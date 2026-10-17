import { readFileSync } from "node:fs";
import {
  World, boxFromData, buildNavGrid, generateMap, parseBotConfig, parseChunkSet, parseCombatStats, parseGrenadeStats, parseMatchConfig, parseMechStats,
  parseNetStats, parseNoiseStats, parseRingConfig, parseTiers, parseWeaponStats, parseZones, type BoxData,
} from "@rustbucket/shared";
import type { MapForRoom, RoomConfig } from "./Room";

const dataDir = new URL("../../../data/", import.meta.url);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, dataDir), "utf8"));
}

export interface ConfigOptions {
  // "generated" builds each match's map from its seed. "range" always uses the flat test strip, which
  // keeps combat tests simple because spawns and walls never move.
  maps?: "generated" | "range";
}

// Same data files the client reads, so both sides always agree on the numbers.
export function loadRoomConfig(options: ConfigOptions = {}): RoomConfig {
  const mech = parseMechStats(readJson("mech.json"));
  const net = parseNetStats(readJson("net.json"));
  const base = {
    mech, net,
    bots: parseBotConfig(readJson("bots.json")),
    noise: parseNoiseStats(readJson("noise.json")),
    weapon: parseWeaponStats(readJson("weapon.json")),
    grenade: parseGrenadeStats(readJson("grenade.json")),
    combat: parseCombatStats(readJson("combat.json")),
    match: parseMatchConfig(readJson("match.json")),
    ring: parseRingConfig(readJson("ring.json")),
    zones: parseZones(readJson("zones.json")),
  };

  if (options.maps === "generated") {
    const chunks = parseChunkSet(readJson("chunks.json"));
    const tiers = parseTiers(readJson("tiers.json"));
    const mapFor = (tier: string, seed: number): MapForRoom => {
      const map = generateMap(seed, tier, chunks, tiers, mech);
      return { world: map.world, nav: map.nav, spawns: map.spawns, meters: map.meters };
    };
    return { ...base, mapFor };
  }

  const range = readJson("greybox.json") as { boxes: BoxData[] };
  const boxes = range.boxes.map(boxFromData);
  const world = new World(boxes);
  const nav = buildNavGrid(boxes, 600, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height });
  // Room for the eight people and as many bots again.
  const spawns: [number, number, number][] = Array.from({ length: net.maxPlayers * 2 }, (_, slot) => [(slot - 3.5) * net.spawnSpacing, 0.1, 0]);
  return { ...base, mapFor: () => ({ world, nav, spawns, meters: 300 }) };
}

export function tierNames(): string[] {
  return Object.keys(parseTiers(readJson("tiers.json")).tiers);
}
