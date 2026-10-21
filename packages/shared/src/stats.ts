// Tuning shapes and loaders. Values live in data/*.json, never in code.
export interface MechStats {
  walkSpeed: number;
  runSpeed: number;
  crawlSpeedMultiplier: number; // share of walk speed left with broken legs
  waterSpeedMultiplier: number; // share of walk and run speed left while wading (dash and jets are untouched)
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
  // The drop-in ball (drop.ts): its fall speed, its fall speed while Space or W is held, and top steering speed in m/s, how fast the steering follows (m/s²),
  // and the braking retro-jets near the ground.
  ballFall: number; ballFastFall: number; ballSteer: number; ballSteerAcceleration: number;
  burnMeters: number; burnDeceleration: number; burnGlide: number; landingFall: number; landingStunSeconds: number;
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
  projectile: ProjectileStats; // what a shot does where it lands (gate 18b). Left out in weapons.json it is a plain hitscan hit
  secondary: SecondaryStats; // right-click (altFire.ts)
}

// What a shot does where it lands (gate 18b). Every kind is resolved on the server at the trigger pull, against where
// targets were a moment ago, and takes effect projectileSpeed later, when the drawn projectile gets there (flightSteps).
export interface HitscanStats { kind: "hitscan" }
// A rivet sticks where it lands (a wall, the ground, a prop, or riding on a mech) and pops after fuseSeconds with a
// small blast. A player has at most maxStuck stuck at once: one more pops the oldest early.
export interface RivetStats {
  kind: "rivet";
  fuseSeconds: number; blastDamage: number; blastRadius: number; maxStuck: number;
}
// A harpoon on a mech yanks it toward the shooter (yankSpeed for up to yankSeconds, stopping yankStopMeters short, with
// yankLift m/s upward); on a pickup (passing within itemHitRadius) it slides the pickup over itemPullSeconds to
// itemStopMeters in front of the shooter; on a prop of a type in smashProps it smashes it and slides its loot the same way.
export interface HarpoonStats {
  kind: "harpoon";
  yankSpeed: number; yankSeconds: number; yankLift: number; yankStopMeters: number;
  itemPullSeconds: number; itemStopMeters: number; itemHitRadius: number;
  smashProps: string[];
}
export type ProjectileStats = HitscanStats | RivetStats | HarpoonStats;

const RIVET_KEYS = ["fuseSeconds", "blastDamage", "blastRadius", "maxStuck"] as const;
const HARPOON_KEYS = ["yankSpeed", "yankSeconds", "yankLift", "yankStopMeters", "itemPullSeconds", "itemStopMeters", "itemHitRadius"] as const;

export function parseProjectile(raw: unknown, name: string): ProjectileStats {
  if (raw === undefined) return { kind: "hitscan" };
  const kind = (raw as { kind?: unknown } | null)?.kind;
  const above = (s: Record<string, number>, key: string) => { if (!(s[key]! > 0)) throw new Error(`${name}: "${key}" must be above 0`); };
  if (kind === "hitscan") return { kind };
  if (kind === "rivet") {
    const s = parseNumbers<Record<string, number>>(raw, name, [...RIVET_KEYS]);
    above(s, "fuseSeconds"); above(s, "blastRadius");
    if (!Number.isInteger(s.maxStuck) || s.maxStuck! < 1) throw new Error(`${name}: "maxStuck" must be a whole number of at least 1`);
    return { ...s, kind } as RivetStats;
  }
  if (kind === "harpoon") {
    const s = parseNumbers<Record<string, number>>(raw, name, [...HARPOON_KEYS]);
    above(s, "yankSpeed"); above(s, "itemPullSeconds"); above(s, "itemHitRadius");
    const smash = (raw as { smashProps?: unknown }).smashProps;
    if (!Array.isArray(smash) || !smash.every((p) => typeof p === "string")) throw new Error(`${name}: "smashProps" must be a list of prop type ids`);
    return { ...s, kind, smashProps: [...smash] } as HarpoonStats;
  }
  throw new Error(`${name}: "kind" must be hitscan, rivet or harpoon`);
}

// Right-click fire, built from a few kinds so no gun needs code of its own (gate 18a).
// Hold to spin up: the rate climbs to maxRateMultiplier times the gun's own over windupSeconds. Every alt shot adds
// heat; full heat locks both triggers for overheatSeconds. Heat cools whenever the right button is up.
export interface WindupStats {
  kind: "windup";
  windupSeconds: number; maxRateMultiplier: number; heatPerShot: number; coolPerSecond: number; overheatSeconds: number; spreadDegrees: number;
}
// One heavy shot in place of the gun's own: its own rate, damage, spread, range and kick.
export interface SlugStats {
  kind: "slug";
  shotsPerSecond: number; damage: number; spreadDegrees: number; maxAimDistance: number; shakeForce: number;
}
// Hold to charge, release to fire. Damage runs from minDamageShare to the gun's full damage; a full charge passes
// through pierceMechs mechs and pins each one it hits, slowed to pinSpeedShare of its speed for pinSeconds.
export interface ChargeStats {
  kind: "charge";
  chargeSeconds: number; minDamageShare: number; pierceMechs: number; pinSeconds: number; pinSpeedShare: number; shakeForce: number;
}
// Right-click pops every rivet of yours that has stuck, at once. Fires on the press only.
export interface DetonateStats { kind: "detonate" }
// A grapple: fires the harpoon (sharing the gun's fire gate, at its own rate) and pulls you at `speed` for up to
// maxSeconds toward where it lands, aimed standOffMeters out from the surface and climbMeters above it so a reel at a
// ledge ends on top, stopping stopMeters short.
export interface ReelStats {
  kind: "reel";
  shotsPerSecond: number; speed: number; maxSeconds: number; standOffMeters: number; climbMeters: number; stopMeters: number;
}
export type SecondaryStats = WindupStats | SlugStats | ChargeStats | DetonateStats | ReelStats;

const SECONDARY_KEYS: Record<SecondaryStats["kind"], readonly string[]> = {
  windup: ["windupSeconds", "maxRateMultiplier", "heatPerShot", "coolPerSecond", "overheatSeconds", "spreadDegrees"],
  slug: ["shotsPerSecond", "damage", "spreadDegrees", "maxAimDistance", "shakeForce"],
  charge: ["chargeSeconds", "minDamageShare", "pierceMechs", "pinSeconds", "pinSpeedShare", "shakeForce"],
  detonate: [],
  reel: ["shotsPerSecond", "speed", "maxSeconds", "standOffMeters", "climbMeters", "stopMeters"],
};

// Divided by, or a share that must stay a share: anything else is a typo that would hang or break a gun.
function checkSecondary(s: SecondaryStats, name: string): void {
  const above = (key: string, v: number) => { if (!(v > 0)) throw new Error(`${name}: "${key}" must be above 0`); };
  const share = (key: string, v: number) => { if (!(v >= 0 && v <= 1)) throw new Error(`${name}: "${key}" must be from 0 to 1`); };
  if (s.kind === "windup") {
    above("windupSeconds", s.windupSeconds); above("overheatSeconds", s.overheatSeconds); above("heatPerShot", s.heatPerShot);
    if (!(s.maxRateMultiplier >= 1)) throw new Error(`${name}: "maxRateMultiplier" must be at least 1`);
  } else if (s.kind === "slug") {
    above("shotsPerSecond", s.shotsPerSecond); above("maxAimDistance", s.maxAimDistance);
  } else if (s.kind === "reel") {
    above("shotsPerSecond", s.shotsPerSecond); above("speed", s.speed); above("maxSeconds", s.maxSeconds);
  } else if (s.kind === "charge") {
    above("chargeSeconds", s.chargeSeconds); share("minDamageShare", s.minDamageShare); share("pinSpeedShare", s.pinSpeedShare);
    if (!Number.isInteger(s.pierceMechs) || s.pierceMechs < 0) throw new Error(`${name}: "pierceMechs" must be a whole number of at least 0`);
  }
}

export function parseSecondary(raw: unknown, name: string): SecondaryStats {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind !== "windup" && kind !== "slug" && kind !== "charge" && kind !== "detonate" && kind !== "reel") throw new Error(`${name}: "kind" must be windup, slug, charge, detonate or reel`);
  const numbers = parseNumbers<Record<string, number>>(raw, name, SECONDARY_KEYS[kind] as string[]);
  const s = { ...numbers, kind } as SecondaryStats;
  checkSecondary(s, name);
  return s;
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
  heuristicWeight: number; // above 1 a search heads for the goal more eagerly: far fewer cells, routes a little longer
  waterCost: number; // a step through water costs this many dry steps, so bots go round ponds unless wading is far shorter
  // Stepping round small things right in front (trunks, crates, boulders; server steer.ts). Guesses, tuned in steer.test.ts.
  steerLookMeters: number; // how far ahead it looks: more than a run covers in the far bots' 4 tick step
  steerClearanceMeters: number; // the gap left between its side and the thing it passes
  steerMaxSizeMeters: number; // anything wider or deeper than this is a wall, left to the route
  steerKeepSideMeters: number; // keeps the side it picked unless the other way is shorter by more than this
  steerGrazeMeters: number; // a wall it would only catch by this much of its side is stepped off too, not left to the route
  // How long a bot keeps at a goal it is getting nowhere with before it gives up on it: standing at the end of a route
  // that stops short of the goal, or holding E on loot that never comes.
  giveUpSeconds: number;
  // A route from a cell the coarse grid calls blocked (a mech beside a wall, or among crates) first finds its way out
  // on the fine nav grid from where the mech stands, looking this far. Past it, the old nearest open cell is used.
  escapeMeters: number;
  // Route legs pass anything the routes go round with this much to spare either side of a bot's middle, so its
  // shoulder does not catch the end of a wall. A guess: a mech's half width and a little.
  routeClearanceMeters: number;
  // A bot only moves on to its next waypoint from up to waypointReach away when it can walk straight there from where
  // it is; otherwise it first comes this near, so it does not cut a corner into the wall.
  cornerReachMeters: number;
}

export interface BotLootStats {
  searchMeters: number; // with nobody in sight, a bot goes for useful loot and full wrecks this close
  // ...and keeps looking this far while it is already after something, so loot near the edge of searchMeters is not
  // lost and found again with every step, turning the bot round each time.
  keepMeters: number;
  refreshTicks: number; // how often it looks again for the nearest thing worth having
}

export interface BotHuntStats {
  searchMeters: number; // with nobody in sight and nothing to loot or check, a bot heads for the nearest mech this close
  personDistanceScale: number; // a person looks this many times further off to a bot choosing whom to shoot
}

export interface BotConfig {
  mix: Record<string, number>; // share of each difficulty when bots are added
  fill: Record<string, number>; // total players (people plus bots) a room tops up to, by tier
  difficulties: Record<string, BotStats>;
  lod: BotLodStats;
  path: BotPathStats;
  hunt: BotHuntStats;
  loot: BotLootStats;
}

export interface HudStats {
  radarRangeMeters: number; // how far the radar's edge reaches
  detectRangeMeters: number; // mechs closer than this show on the radar whether they make a sound or not
  knockoutCardSeconds: number; // how long the knockout card stays up (gate 14c)
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
  walkBob: number; // share of your mech's walking bob the camera follows. 0 keeps it still (M1's shot bounce felt bad)
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
  rejoinGraceSeconds: number; // a mech whose connection drops mid match waits this long for its player to come back
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
  "walkSpeed", "runSpeed", "crawlSpeedMultiplier", "waterSpeedMultiplier", "acceleration", "deceleration", "airControl", "turnSpeedDegrees",
  "gravity", "maxFallSpeed", "stepHeight", "halfWidth", "height",
  "jetLift", "jetMaxRiseSpeed", "fuelMax", "fuelDrainPerSecond", "fuelRegenPerSecond", "fuelRegenDelay", "fuelUnlockFraction",
  "staminaMax", "runDrainPerSecond", "staminaRegenPerSecond", "staminaRegenDelay", "staminaUnlockFraction",
  "mouseSensitivity", "minPitch", "maxPitch",
  "dashSpeed", "dashSeconds", "dashCooldown", "dashStaminaCost", "sprintDoubleTapSeconds",
  "ballFall", "ballFastFall", "ballSteer", "ballSteerAcceleration",
  "burnMeters", "burnDeceleration", "burnGlide", "landingFall", "landingStunSeconds",
];
const WEAPON_KEYS: (keyof WeaponStats & string)[] = [
  "shotsPerSecond", "projectileSpeed", "projectileLifetime", "spreadDegrees", "maxAimDistance", "shakeForce", "damage", "pellets",
];
const CAMERA_KEYS: (keyof CameraStats & string)[] = [
  "fov", "distance", "shoulderX", "pivotHeight", "radius", "near", "pullOutSpeed", "dashFovKick", "walkBob",
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
  "floodKickBudget", "interpolationBufferMs", "maxViewDelayMs", "interestRange", "interestLeaveFactor", "correctionSmoothing", "snapDistance", "spawnSpacing", "rejoinGraceSeconds",
];

export const parseNetStats = (raw: unknown) => parseNumbers<NetStats>(raw, "net.json", NET_KEYS);
export const parseGrenadeStats = (raw: unknown) => parseNumbers<GrenadeStats>(raw, "grenade.json", GRENADE_KEYS);
export const parseCombatStats = (raw: unknown) => parseNumbers<CombatStats>(raw, "combat.json", COMBAT_KEYS);
export const parseBotStats = (raw: unknown, name = "bots.json") => parseNumbers<BotStats>(raw, name, BOT_KEYS);

const LOD_KEYS: (keyof BotLodStats & string)[] = ["fullRangeMeters", "cheapEveryTicks", "abstractFightRange", "abstractFightSeconds", "abstractLoserDamage", "abstractWinnerDamage"];
const PATH_KEYS: (keyof BotPathStats & string)[] = ["cellMeters", "maxNodes", "replanSeconds", "waypointReach", "minPathDistance", "goalMoveReplan", "searchesPerTick", "heuristicWeight", "waterCost", "steerLookMeters", "steerClearanceMeters", "steerMaxSizeMeters", "steerKeepSideMeters", "steerGrazeMeters", "giveUpSeconds", "escapeMeters", "routeClearanceMeters", "cornerReachMeters"];

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
    loot: parseNumbers<BotLootStats>(d?.loot, "bots.json loot", ["searchMeters", "keepMeters", "refreshTicks"]),
    hunt: parseNumbers<BotHuntStats>(d?.hunt, "bots.json hunt", ["searchMeters", "personDistanceScale"]),
  };
}
export const parseHudStats = (raw: unknown) => parseNumbers<HudStats>(raw, "hud.json", ["radarRangeMeters", "detectRangeMeters", "knockoutCardSeconds"]);
// The drop divides by these, so a 0 would hang a mech in the air forever.
const MECH_ABOVE_ZERO: (keyof MechStats & string)[] = ["ballFall", "ballFastFall", "ballSteerAcceleration", "burnDeceleration", "landingFall"];

export function parseMechStats(raw: unknown): MechStats {
  const stats = parseNumbers<MechStats>(raw, "mech.json", MECH_KEYS);
  for (const key of MECH_ABOVE_ZERO) if (!(stats[key] > 0)) throw new Error(`mech.json: "${key}" must be above 0`);
  return stats;
}
export interface WeaponSet {
  start: number; // index of the weapon everyone begins with
  weapons: WeaponStats[];
}

export function parseWeapons(raw: unknown): WeaponSet {
  const d = raw as { start?: unknown; weapons?: unknown };
  if (!Array.isArray(d?.weapons) || d.weapons.length === 0) throw new Error("weapons.json: needs weapons");
  const weapons = (d.weapons as Record<string, unknown>[]).map((w) => {
    if (typeof w.id !== "string" || typeof w.name !== "string" || typeof w.color !== "string") throw new Error("weapons.json: every weapon needs id, name and color");
    const numbers = parseNumbers<Omit<WeaponStats, "id" | "name" | "color" | "secondary">>(w, `weapons.json ${w.id}`, WEAPON_KEYS as never);
    if (!Number.isInteger(numbers.pellets) || numbers.pellets < 1) throw new Error(`weapons.json: ${w.id} pellets must be a whole number of at least 1`);
    if (!(numbers.shotsPerSecond > 0)) throw new Error(`weapons.json: ${w.id} shotsPerSecond must be above 0`);
    const secondary = parseSecondary(w.secondary, `weapons.json ${w.id} secondary`);
    const projectile = parseProjectile(w.projectile, `weapons.json ${w.id} projectile`);
    if (projectile.kind !== "hitscan" && !(numbers.projectileSpeed > 0)) throw new Error(`weapons.json: ${w.id} projectileSpeed must be above 0`);
    // Detonate only has rivets to pop.
    if (secondary.kind === "detonate" && projectile.kind !== "rivet") throw new Error(`weapons.json: ${w.id} detonate needs a rivet projectile`);
    return { ...numbers, id: w.id, name: w.name, color: w.color, projectile, secondary } as WeaponStats;
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
  wadingFootsteps: number; // running and dashing through water is heard this share as far: water muffles footsteps
  loudness: Record<NoiseKind, number>; // metres away it can be heard
}

export function parseNoiseStats(raw: unknown): NoiseStats {
  const base = parseNumbers<Omit<NoiseStats, "loudness">>(raw, "noise.json", ["pulseSeconds", "fuzzFraction", "fuzzMaxMeters", "botInvestigateSeconds", "wadingFootsteps"]);
  const loudness = parseNumbers<Record<NoiseKind, number>>((raw as { loudness?: unknown })?.loudness, "noise.json loudness", [...NOISE_KINDS]);
  return { ...base, loudness };
}

