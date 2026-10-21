import {
  World, buildNavGrid, buildRange, generateMap, parseBotConfig, parseChunkSet, parseCombatStats, parseGrenadeStats, parseMatchConfig, parseMechStats,
  parseNetStats, parseNoiseStats, parsePropConfig, parseRingConfig, parseDropsConfig, parseTiers, parseWeapons, parseLootConfig, parseUpgrades, parseZones, parseRoster, parseAbilities, parseTitanConfig, TUNABLE_FILES, type Roster, type RangeData, type TuningRaws,
} from "@rustbucket/shared";
import { parseBotAbilities } from "./botAbilities";
import { parseDropConfig } from "./dropConfig";
import type { MapForRoom, RoomConfig } from "./Room";

// Reads one data file by name ("mech.json"). The server reads them from disk (config.ts); offline practice in the
// browser hands over the files the page imported (client localRoom.ts). Either way they go through the same parsing,
// so a room in a browser runs on exactly the numbers a room on the server does.
export type ReadData = (name: string) => unknown;

export interface ConfigOptions {
  // Load the roster (data/roster.json) and its measured hit boxes (data/mechKits.json), as the real server does, so
  // each mech moves, takes damage and is hit its own way. Tests leave it off: one standard mech is what their
  // aiming and numbers are built around.
  roster?: boolean;
  // "generated" builds each match's map from its seed. "range" always uses the flat test strip, which
  // keeps combat tests simple because spawns and walls never move.
  maps?: "generated" | "range";
}

export function buildRoomConfig(read: ReadData, options: ConfigOptions = {}): RoomConfig {
  const mech = parseMechStats(read("mech.json"));
  const net = parseNetStats(read("net.json"));
  const weapons = parseWeapons(read("weapons.json"));
  const props = parsePropConfig(read("props.json"));
  const bots = read("bots.json");
  const base = {
    mech, net, weapons, props,
    loot: parseLootConfig(read("loot.json"), weapons, props),
    upgrades: parseUpgrades(read("upgrades.json")),
    bots: parseBotConfig(bots),
    botAbilities: parseBotAbilities(bots),
    noise: parseNoiseStats(read("noise.json")),
    grenade: parseGrenadeStats(read("grenade.json")),
    combat: parseCombatStats(read("combat.json")),
    match: parseMatchConfig(read("match.json")),
    ring: parseRingConfig(read("ring.json")),
    drops: parseDropsConfig(read("drops.json")),
    zones: parseZones(read("zones.json")),
    // Loaded with or without a roster: without one no mech has an ability, so the file is simply unused.
    abilities: parseAbilities(read("abilities.json")),
    titan: parseTitanConfig(read("titan.json")),
    drop: parseDropConfig(read("drop.json")),
    roster: undefined as Roster | undefined,
    kitHitboxes: undefined as unknown,
  };

  if (options.roster) {
    base.roster = parseRoster(read("roster.json"));
    base.kitHitboxes = read("mechKits.json");
  }

  return { ...base, mapFor: options.maps === "generated" ? generatedMaps(read) : rangeMaps(read) };
}

// The flat test strip, whatever the tier and seed. Each call makes a fresh world, because destroying a prop switches
// its box off and every match starts whole.
export function rangeMaps(read: ReadData): () => MapForRoom {
  const mech = parseMechStats(read("mech.json"));
  const net = parseNetStats(read("net.json"));
  const props = parsePropConfig(read("props.json"));
  const range = buildRange(read("greybox.json") as RangeData, props);
  const boxes = range.boxes;
  const nav = buildNavGrid(boxes, 600, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height });
  // Room for the eight people and as many bots again.
  const spawns: [number, number, number][] = Array.from({ length: net.maxPlayers * 2 }, (_, slot) => [(slot - 3.5) * net.spawnSpacing, 0.1, 0]);
  return () => ({ world: new World(boxes), nav, spawns, meters: 300, props: range.props, propOfBox: range.propOfBox });
}

// Builds each match's map from its seed, on whichever thread calls it. The map workers (mapWorker.ts) use this too,
// reading the same files, so a map made in a worker is the map the main thread would have made.
export function generatedMaps(read: ReadData): (tier: string, seed: number) => MapForRoom {
  const mech = parseMechStats(read("mech.json"));
  const props = parsePropConfig(read("props.json"));
  const chunks = parseChunkSet(read("chunks.json"));
  const tiers = parseTiers(read("tiers.json"));
  return (tier, seed) => {
    const map = generateMap(seed, tier, chunks, tiers, mech, props);
    return { world: map.world, nav: map.nav, spawns: map.spawns, meters: map.meters, props: map.props, propOfBox: map.propOfBox };
  };
}

// The raw tunable data files, for live tuning in development.
export function tuningRaws(read: ReadData): TuningRaws {
  const raws: Record<string, unknown> = { props: read("props.json") };
  for (const file of TUNABLE_FILES) raws[file] = read(`${file}.json`);
  return raws as TuningRaws;
}
