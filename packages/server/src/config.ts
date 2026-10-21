import { readFileSync } from "node:fs";
import {
  World, buildNavGrid, buildRange, generateMap, parseBotConfig, parseChunkSet, parseCombatStats, parseGrenadeStats, parseMatchConfig, parseMechStats,
  parseNetStats, parseNoiseStats, parsePropConfig, parseRingConfig, parseDropsConfig, parseTiers, parseWeapons, parseLootConfig, parseUpgrades, parseZones, parseRoster, parseAbilities, parseTitanConfig, TUNABLE_FILES, type Roster, type RangeData, type TuningRaws,
} from "@rustbucket/shared";
import { parseBotAbilities } from "./botAbilities";
import { parseDropConfig } from "./dropConfig";
import type { MapForRoom, RoomConfig } from "./Room";

const dataDir = new URL("../../../data/", import.meta.url);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, dataDir), "utf8"));
}

export interface ConfigOptions {
  // Load the roster (data/roster.json) and its measured hit boxes (data/mechKits.json), as the real server does, so
  // each mech moves, takes damage and is hit its own way. Tests leave it off: one standard mech is what their
  // aiming and numbers are built around.
  roster?: boolean;
  // "generated" builds each match's map from its seed. "range" always uses the flat test strip, which
  // keeps combat tests simple because spawns and walls never move.
  maps?: "generated" | "range";
}

// Same data files the client reads, so both sides always agree on the numbers.
export function loadRoomConfig(options: ConfigOptions = {}): RoomConfig {
  const mech = parseMechStats(readJson("mech.json"));
  const net = parseNetStats(readJson("net.json"));
  const weapons = parseWeapons(readJson("weapons.json"));
  const props = parsePropConfig(readJson("props.json"));
  const bots = readJson("bots.json");
  const base = {
    mech, net, weapons, props,
    loot: parseLootConfig(readJson("loot.json"), weapons, props),
    upgrades: parseUpgrades(readJson("upgrades.json")),
    bots: parseBotConfig(bots),
    botAbilities: parseBotAbilities(bots),
    noise: parseNoiseStats(readJson("noise.json")),
    grenade: parseGrenadeStats(readJson("grenade.json")),
    combat: parseCombatStats(readJson("combat.json")),
    match: parseMatchConfig(readJson("match.json")),
    ring: parseRingConfig(readJson("ring.json")),
    drops: parseDropsConfig(readJson("drops.json")),
    zones: parseZones(readJson("zones.json")),
    // Loaded with or without a roster: without one no mech has an ability, so the file is simply unused.
    abilities: parseAbilities(readJson("abilities.json")),
    titan: parseTitanConfig(readJson("titan.json")),
    drop: parseDropConfig(readJson("drop.json")),
    roster: undefined as Roster | undefined,
    kitHitboxes: undefined as unknown,
  };

  if (options.roster) {
    base.roster = parseRoster(readJson("roster.json"));
    base.kitHitboxes = readJson("mechKits.json");
  }

  if (options.maps === "generated") return { ...base, mapFor: generatedMaps() };

  // Each call builds a fresh world, because destroying a prop switches its box off and every match starts whole.
  const range = buildRange(readJson("greybox.json") as RangeData, base.props);
  const boxes = range.boxes;
  const nav = buildNavGrid(boxes, 600, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height });
  // Room for the eight people and as many bots again.
  const spawns: [number, number, number][] = Array.from({ length: net.maxPlayers * 2 }, (_, slot) => [(slot - 3.5) * net.spawnSpacing, 0.1, 0]);
  return { ...base, mapFor: () => ({ world: new World(boxes), nav, spawns, meters: 300, props: range.props, propOfBox: range.propOfBox }) };
}

// Builds each match's map from its seed, on whichever thread calls it. The map workers (mapWorker.ts) use this too,
// reading the same files, so a map made in a worker is the map the main thread would have made.
export function generatedMaps(): (tier: string, seed: number) => MapForRoom {
  const mech = parseMechStats(readJson("mech.json"));
  const props = parsePropConfig(readJson("props.json"));
  const chunks = parseChunkSet(readJson("chunks.json"));
  const tiers = parseTiers(readJson("tiers.json"));
  return (tier, seed) => {
    const map = generateMap(seed, tier, chunks, tiers, mech, props);
    return { world: map.world, nav: map.nav, spawns: map.spawns, meters: map.meters, props: map.props, propOfBox: map.propOfBox };
  };
}

export function tierNames(): string[] {
  return Object.keys(parseTiers(readJson("tiers.json")).tiers);
}

// The raw tunable data files, for live tuning in development.
export function loadTuningRaws(): TuningRaws {
  const raws: Record<string, unknown> = { props: readJson("props.json") };
  for (const file of TUNABLE_FILES) raws[file] = readJson(`${file}.json`);
  return raws as TuningRaws;
}
