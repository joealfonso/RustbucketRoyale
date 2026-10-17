import { readFileSync } from "node:fs";
import {
  World, boxFromData, generateMap, parseChunkSet, parseCombatStats, parseGrenadeStats, parseMechStats, parseNetStats,
  parseTiers, parseWeaponStats, parseZones, type BoxData,
} from "@rustbucket/shared";
import type { RoomConfig } from "./Room";

const dataDir = new URL("../../../data/", import.meta.url);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, dataDir), "utf8"));
}

export interface MapChoice {
  tier: string; // small, medium, large, or "range" for the old flat 2000 m test strip
  seed: number;
}

// Same data files the client reads, so both sides always agree on the numbers.
// The default is the small test range, which keeps the combat tests simple.
export function loadRoomConfig(choice: MapChoice = { tier: "range", seed: 0 }): RoomConfig {
  const mech = parseMechStats(readJson("mech.json"));
  const base = {
    mech,
    weapon: parseWeaponStats(readJson("weapon.json")),
    grenade: parseGrenadeStats(readJson("grenade.json")),
    combat: parseCombatStats(readJson("combat.json")),
    net: parseNetStats(readJson("net.json")),
    zones: parseZones(readJson("zones.json")),
    seed: choice.seed,
    tier: choice.tier,
  };

  if (choice.tier === "range") {
    const range = readJson("greybox.json") as { boxes: BoxData[] };
    const spawns: [number, number, number][] = Array.from({ length: base.net.maxPlayers }, (_, slot) => [(slot - 3.5) * base.net.spawnSpacing, 0.1, 0]);
    return { ...base, world: new World(range.boxes.map(boxFromData)), spawns };
  }

  const map = generateMap(choice.seed, choice.tier, parseChunkSet(readJson("chunks.json")), parseTiers(readJson("tiers.json")), mech);
  return { ...base, world: map.world, spawns: map.spawns };
}
