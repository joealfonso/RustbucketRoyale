// Tuning shapes and loaders. Values live in data/*.json, never in code.
export interface MechStats {
  walkSpeed: number;
  runSpeed: number;
  crawlSpeedMultiplier: number; // share of walk speed left with broken legs
  acceleration: number;
  deceleration: number;
  airControl: number;
  turnSpeedDegrees: number; // how fast the body swings to face where you look. 0 means instantly
  gravity: number;
  maxFallSpeed: number;
  stepHeight: number;
  halfWidth: number;
  height: number;
  jetLift: number;
  jetMaxRiseSpeed: number;
  fuelMax: number;
  fuelDrainPerSecond: number;
  fuelRegenPerSecond: number;
  fuelRegenDelay: number;
  fuelUnlockFraction: number;
  staminaMax: number;
  runDrainPerSecond: number;
  staminaRegenPerSecond: number;
  staminaRegenDelay: number;
  staminaUnlockFraction: number;
  mouseSensitivity: number;
  minPitch: number;
  maxPitch: number;
  dashSpeed: number;
  dashSeconds: number;
  dashCooldown: number;
  dashStaminaCost: number;
  sprintDoubleTapSeconds: number; // two presses of W this close together start a sprint
}

// One weapon's tuning and look. Every gun is just data: balance changes never touch code.
export interface WeaponStats {
  id: string;
  name: string;
  color: string; // art hook: tints the gun arm until real weapon models exist
  pellets: number; // shots per trigger pull, spread out (a scattergun fires several)
  shotsPerSecond: number;
  projectileSpeed: number;
  projectileLifetime: number;
  spreadDegrees: number;
  maxAimDistance: number;
  shakeForce: number;
  damage: number;
}

export interface GrenadeStats {
  throwSpeed: number;
  throwLift: number;
  gravity: number;
  bounce: number;
  friction: number;
  radius: number;
  fuseSeconds: number;
  blastRadius: number;
  damage: number;
  cooldownSeconds: number;
  shakeRadius: number; // blasts closer than this shake the camera
  shakeForce: number;
}

export interface CombatStats {
  lagCompensationMs: number; // the most a shot is ever rewound, whatever the client says
  defaultLagMs: number; // used when a client does not say how far behind it is
  historyMs: number;
  respawnSeconds: number;
}

// How the simple bots behave. One set of numbers for now, easy to beat on purpose.
export interface BotStats {
  sightRange: number;
  preferredDistance: number; // they try to fight from about this far
  strafeSeconds: number;
  aimErrorDegrees: number; // how far off their aim is, which is what makes them beatable
  aimRetargetSeconds: number; // how often the aim error is rerolled
  turnDegreesPerSecond: number;
  fireToleranceDegrees: number; // they shoot once their aim is this close to the target
  maxFireRange: number;
  reactionSeconds: number; // a pause after first spotting someone before shooting
  grenadeChancePerSecond: number;
  grenadeMinRange: number;
  grenadeMaxRange: number;
  stuckSeconds: number;
  wanderSeconds: number;
  ringMargin: number; // they head for the middle of the ring when this close to its edge
  dashChancePerSecond: number; // how often a bot in a fight dashes sideways to dodge
}

// How far from every person a bot can be before it switches to the cheap mode, and how that mode behaves.
export interface BotLodStats {
  fullRangeMeters: number;
  cheapEveryTicks: number; // a far bot thinks and moves only this often
  abstractFightRange: number; // two far bots closer than this fight on paper
  abstractFightSeconds: number;
  abstractLoserDamage: number; // share of every zone's hit points the loser loses each round
  abstractWinnerDamage: number;
}

export interface BotPathStats {
  cellMeters: number;
  maxNodes: number; // the most cells one search looks at
  replanSeconds: number;
  waypointReach: number;
  minPathDistance: number; // nearer goals are walked to directly
  goalMoveReplan: number; // plan again when the goal has moved this far
  searchesPerTick: number; // route searches one room runs per tick, the rest wait a tick
}

export interface BotLootStats {
  searchMeters: number; // with nobody in sight, a bot goes for useful loot and full wrecks this close
  refreshTicks: number; // how often it looks again for the nearest thing worth having
}

export interface BotConfig {
  mix: Record<string, number>; // share of each difficulty when bots are added
  fill: Record<string, number>; // total players (people plus bots) a room tops up to, by tier
  difficulties: Record<string, BotStats>;
  lod: BotLodStats;
  path: BotPathStats;
  loot: BotLootStats;
}

export interface HudStats {
  radarRangeMeters: number; // how far the radar's edge reaches
  detectRangeMeters: number; // mechs closer than this show on the radar whether they make a sound or not
}

export interface CameraStats {
  fov: number;
  distance: number;
  shoulderX: number;
  pivotHeight: number;
  radius: number;
  near: number;
  pullOutSpeed: number;
  dashFovKick: number; // extra degrees of field of view at the start of a dash
}

export interface NetStats {
  snapshotEvery: number;
  maxPlayers: number;
  maxInputsPerTick: number;
  maxQueuedInputs: number;
  maxMessagesPerSecond: number;
  floodKickBudget: number;
  interpolationBufferMs: number; // extra time kept on top of one snapshot interval, to ride out jitter
  maxViewDelayMs: number;
  interestRange: number; // a client is only sent mechs and events closer than this
  interestLeaveFactor: number; // a mech already being sent stays until it is this many times further away, so the edge does not flicker
  correctionSmoothing: number;
  snapDistance: number;
  spawnSpacing: number;
}

// Fails loudly on a missing or non numeric field, so a typo in a data file cannot silently become NaN.
function parseNumbers<T>(raw: unknown, name: string, keys: readonly (keyof T & string)[]): T {
  if (typeof raw !== "object" || raw === null) throw new Error(`${name}: expected an object`);
  const record = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${name}: "${key}" must be a finite number`);
    }
    out[key] = value;
  }
  return out as T;
}

const MECH_KEYS: (keyof MechStats & string)[] = [
  "walkSpeed", "runSpeed", "crawlSpeedMultiplier", "acceleration", "deceleration", "airControl", "turnSpeedDegrees",
  "gravity", "maxFallSpeed", "stepHeight", "halfWidth", "height",
  "jetLift", "jetMaxRiseSpeed", "fuelMax", "fuelDrainPerSecond", "fuelRegenPerSecond", "fuelRegenDelay", "fuelUnlockFraction",
  "staminaMax", "runDrainPerSecond", "staminaRegenPerSecond", "staminaRegenDelay", "staminaUnlockFraction",
  "mouseSensitivity", "minPitch", "maxPitch",
  "dashSpeed", "dashSeconds", "dashCooldown", "dashStaminaCost", "sprintDoubleTapSeconds",
];
const WEAPON_KEYS: (keyof WeaponStats & string)[] = [
  "shotsPerSecond", "projectileSpeed", "projectileLifetime", "spreadDegrees", "maxAimDistance", "shakeForce", "damage", "pellets",
];
const CAMERA_KEYS: (keyof CameraStats & string)[] = [
  "fov", "distance", "shoulderX", "pivotHeight", "radius", "near", "pullOutSpeed", "dashFovKick",
];

const GRENADE_KEYS: (keyof GrenadeStats & string)[] = [
  "throwSpeed", "throwLift", "gravity", "bounce", "friction", "radius", "fuseSeconds", "blastRadius", "damage", "cooldownSeconds", "shakeRadius", "shakeForce",
];
const COMBAT_KEYS: (keyof CombatStats & string)[] = ["lagCompensationMs", "defaultLagMs", "historyMs", "respawnSeconds"];

const BOT_KEYS: (keyof BotStats & string)[] = [
  "sightRange", "preferredDistance", "strafeSeconds", "aimErrorDegrees", "aimRetargetSeconds", "turnDegreesPerSecond",
  "fireToleranceDegrees", "maxFireRange", "reactionSeconds", "grenadeChancePerSecond", "grenadeMinRange", "grenadeMaxRange",
  "stuckSeconds", "wanderSeconds", "ringMargin", "dashChancePerSecond",
];

const NET_KEYS: (keyof NetStats & string)[] = [
  "snapshotEvery", "maxPlayers", "maxInputsPerTick", "maxQueuedInputs", "maxMessagesPerSecond",
  "floodKickBudget", "interpolationBufferMs", "maxViewDelayMs", "interestRange", "interestLeaveFactor", "correctionSmoothing", "snapDistance", "spawnSpacing",
];

export const parseNetStats = (raw: unknown) => parseNumbers<NetStats>(raw, "net.json", NET_KEYS);
export const parseGrenadeStats = (raw: unknown) => parseNumbers<GrenadeStats>(raw, "grenade.json", GRENADE_KEYS);
export const parseCombatStats = (raw: unknown) => parseNumbers<CombatStats>(raw, "combat.json", COMBAT_KEYS);
export const parseBotStats = (raw: unknown, name = "bots.json") => parseNumbers<BotStats>(raw, name, BOT_KEYS);

const LOD_KEYS: (keyof BotLodStats & string)[] = ["fullRangeMeters", "cheapEveryTicks", "abstractFightRange", "abstractFightSeconds", "abstractLoserDamage", "abstractWinnerDamage"];
const PATH_KEYS: (keyof BotPathStats & string)[] = ["cellMeters", "maxNodes", "replanSeconds", "waypointReach", "minPathDistance", "goalMoveReplan", "searchesPerTick"];

export function parseBotConfig(raw: unknown): BotConfig {
  const d = raw as Record<string, Record<string, unknown>>;
  const numbersIn = (obj: unknown, what: string): Record<string, number> => {
    if (typeof obj !== "object" || obj === null) throw new Error(`bots.json: ${what} must be an object`);
    for (const [k, v] of Object.entries(obj)) if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`bots.json: ${what}.${k} must be a number`);
    return obj as Record<string, number>;
  };
  const difficulties: Record<string, BotStats> = {};
  for (const [name, stats] of Object.entries(d?.difficulties ?? {})) difficulties[name] = parseBotStats(stats, `bots.json difficulties.${name}`);
  if (!difficulties.normal) throw new Error("bots.json: needs a normal difficulty");
  const mix = numbersIn(d?.mix, "mix");
  for (const name of Object.keys(mix)) if (!difficulties[name]) throw new Error(`bots.json: mix names unknown difficulty "${name}"`);
  return {
    mix, fill: numbersIn(d?.fill, "fill"), difficulties,
    lod: parseNumbers<BotLodStats>(d?.lod, "bots.json lod", LOD_KEYS),
    path: parseNumbers<BotPathStats>(d?.path, "bots.json path", PATH_KEYS),
    loot: parseNumbers<BotLootStats>(d?.loot, "bots.json loot", ["searchMeters", "refreshTicks"]),
  };
}
export const parseHudStats = (raw: unknown) => parseNumbers<HudStats>(raw, "hud.json", ["radarRangeMeters", "detectRangeMeters"]);
export const parseMechStats = (raw: unknown) => parseNumbers<MechStats>(raw, "mech.json", MECH_KEYS);
export interface WeaponSet {
  start: number; // index of the weapon everyone begins with
  weapons: WeaponStats[];
}

export function parseWeapons(raw: unknown): WeaponSet {
  const d = raw as { start?: unknown; weapons?: unknown };
  if (!Array.isArray(d?.weapons) || d.weapons.length === 0) throw new Error("weapons.json: needs weapons");
  const weapons = (d.weapons as Record<string, unknown>[]).map((w) => {
    if (typeof w.id !== "string" || typeof w.name !== "string" || typeof w.color !== "string") throw new Error("weapons.json: every weapon needs id, name and color");
    const numbers = parseNumbers<Omit<WeaponStats, "id" | "name" | "color">>(w, `weapons.json ${w.id}`, WEAPON_KEYS as never);
    if (!Number.isInteger(numbers.pellets) || numbers.pellets < 1) throw new Error(`weapons.json: ${w.id} pellets must be a whole number of at least 1`);
    return { ...numbers, id: w.id, name: w.name, color: w.color } as WeaponStats;
  });
  const start = weapons.findIndex((w) => w.id === d.start);
  if (start < 0) throw new Error(`weapons.json: start weapon "${String(d.start)}" is not in the list`);
  return { start, weapons };
}
export const parseCameraStats = (raw: unknown) => parseNumbers<CameraStats>(raw, "camera.json", CAMERA_KEYS);

// The M1 gate asks how long it takes to cross a 2000 m map at run speed.
export function secondsToCross(stats: MechStats, meters: number): number {
  return stats.runSpeed > 0 ? meters / stats.runSpeed : Number.POSITIVE_INFINITY;
}

// Everything a mech does that can be heard, quietest first. Walking makes no sound, so sneaking is possible.
export const NOISE_KINDS = ["run", "dash", "repair", "loot", "jets", "shot", "explosion", "smash"] as const;
export type NoiseKind = (typeof NOISE_KINDS)[number];

export interface NoiseStats {
  pulseSeconds: number; // one mech makes at most one pulse of each kind this often
  fuzzFraction: number; // a pulse is shown off its true spot by up to this share of the distance...
  fuzzMaxMeters: number; // ...but never more than this
  botInvestigateSeconds: number; // how long a bot goes looking for something it heard
  loudness: Record<NoiseKind, number>; // metres away it can be heard
}

export function parseNoiseStats(raw: unknown): NoiseStats {
  const base = parseNumbers<Omit<NoiseStats, "loudness">>(raw, "noise.json", ["pulseSeconds", "fuzzFraction", "fuzzMaxMeters", "botInvestigateSeconds"]);
  const loudness = parseNumbers<Record<NoiseKind, number>>((raw as { loudness?: unknown })?.loudness, "noise.json loudness", [...NOISE_KINDS]);
  return { ...base, loudness };
}

