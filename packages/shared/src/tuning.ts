import { parseLootConfig } from "./loot";
import { parsePropConfig } from "./props";
import { parseBotConfig, parseCombatStats, parseGrenadeStats, parseMechStats, parseNoiseStats, parseWeapons } from "./stats";
import { parseUpgrades } from "./upgrades";
import { parseZones } from "./zones";
import { parseRoster } from "./roster";

// The data files that can be tuned live during a playtest. Map files are left out: the map is already built from them.
export const TUNABLE_FILES = ["mech", "weapons", "grenade", "zones", "loot", "upgrades", "bots", "noise", "combat", "roster"] as const;
export type TunableFile = (typeof TUNABLE_FILES)[number];

// The raw JSON of each tunable file, as it is on disk, plus props.json which loot.json is checked against.
export type TuningRaws = Record<TunableFile | "props", unknown>;

export const isTunableFile = (file: string): file is TunableFile => (TUNABLE_FILES as readonly string[]).includes(file);

// Loot and upgrade parsing hands back the raw object itself, so it is copied first: the parsed copy then never
// shares objects with the raw file being tuned.
const copy = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

// Parses one tunable file the way loading does, so a tuned value goes through the same checks.
export function parseTunable(file: TunableFile, raws: TuningRaws): unknown {
  switch (file) {
    case "mech": return parseMechStats(raws.mech);
    case "weapons": return parseWeapons(raws.weapons);
    case "grenade": return parseGrenadeStats(raws.grenade);
    case "zones": return parseZones(raws.zones);
    case "loot": return parseLootConfig(copy(raws.loot), parseWeapons(raws.weapons), parsePropConfig(raws.props));
    case "upgrades": return parseUpgrades(copy(raws.upgrades));
    case "bots": return parseBotConfig(raws.bots);
    case "noise": return parseNoiseStats(raws.noise);
    case "combat": return parseCombatStats(raws.combat);
    case "roster": return parseRoster(copy(raws.roster));
  }
}

// Sets the number at a dotted path ("weapons.1.damage") in a raw file. Only an existing number can be changed,
// so tuning can never add a key or turn a number into something else. Returns the old value, or null if refused.
export function setNumberAt(root: unknown, path: string, value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const keys = path.split(".");
  let node = root as Record<string, unknown> | null;
  for (const key of keys.slice(0, -1)) {
    const next = node?.[key];
    if (typeof next !== "object" || next === null) return null;
    node = next as Record<string, unknown>;
  }
  const last = keys.at(-1)!;
  const old = node?.[last];
  if (typeof old !== "number" || !Object.hasOwn(node!, last)) return null;
  node![last] = value;
  return old;
}

// Copies every value of `source` into `target`, keeping `target`'s objects and arrays, so code that already holds a
// reference (a bot's stats, the predictor's mech stats) sees the new numbers. The two must have the same shape.
export function assignDeep(target: unknown, source: unknown): void {
  if (typeof target !== "object" || target === null || typeof source !== "object" || source === null) return;
  const t = target as Record<string, unknown>, s = source as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    if (typeof s[key] === "object" && s[key] !== null && typeof t[key] === "object" && t[key] !== null) assignDeep(t[key], s[key]);
    else t[key] = s[key];
  }
}

// Tunes one number in the raw files and returns the file parsed again, or null if the path is not a number or the
// new value fails the file's checks (in which case nothing changes).
export function applyTune(raws: TuningRaws, file: string, path: string, value: number): unknown | null {
  if (!isTunableFile(file)) return null;
  const old = setNumberAt(raws[file], path, value);
  if (old === null) return null;
  try {
    return parseTunable(file, raws);
  } catch {
    setNumberAt(raws[file], path, old);
    return null;
  }
}
