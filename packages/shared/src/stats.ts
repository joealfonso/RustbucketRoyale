// Tuning shapes and loaders. Values live in data/*.json, never in code.
export interface MechStats {
  walkSpeed: number;
  runSpeed: number;
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

export interface WeaponStats {
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
  lagCompensationMs: number;
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
  interpolationDelayMs: number;
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
  "walkSpeed", "runSpeed", "acceleration", "deceleration", "airControl", "turnSpeedDegrees",
  "gravity", "maxFallSpeed", "stepHeight", "halfWidth", "height",
  "jetLift", "jetMaxRiseSpeed", "fuelMax", "fuelDrainPerSecond", "fuelRegenPerSecond", "fuelRegenDelay", "fuelUnlockFraction",
  "staminaMax", "runDrainPerSecond", "staminaRegenPerSecond", "staminaRegenDelay", "staminaUnlockFraction",
  "mouseSensitivity", "minPitch", "maxPitch",
  "dashSpeed", "dashSeconds", "dashCooldown", "dashStaminaCost", "sprintDoubleTapSeconds",
];
const WEAPON_KEYS: (keyof WeaponStats & string)[] = [
  "shotsPerSecond", "projectileSpeed", "projectileLifetime", "spreadDegrees", "maxAimDistance", "shakeForce", "damage",
];
const CAMERA_KEYS: (keyof CameraStats & string)[] = [
  "fov", "distance", "shoulderX", "pivotHeight", "radius", "near", "pullOutSpeed", "dashFovKick",
];

const GRENADE_KEYS: (keyof GrenadeStats & string)[] = [
  "throwSpeed", "throwLift", "gravity", "bounce", "friction", "radius", "fuseSeconds", "blastRadius", "damage", "cooldownSeconds", "shakeRadius", "shakeForce",
];
const COMBAT_KEYS: (keyof CombatStats & string)[] = ["lagCompensationMs", "historyMs", "respawnSeconds"];

const BOT_KEYS: (keyof BotStats & string)[] = [
  "sightRange", "preferredDistance", "strafeSeconds", "aimErrorDegrees", "aimRetargetSeconds", "turnDegreesPerSecond",
  "fireToleranceDegrees", "maxFireRange", "reactionSeconds", "grenadeChancePerSecond", "grenadeMinRange", "grenadeMaxRange",
  "stuckSeconds", "wanderSeconds", "ringMargin",
];

const NET_KEYS: (keyof NetStats & string)[] = [
  "snapshotEvery", "maxPlayers", "maxInputsPerTick", "maxQueuedInputs", "maxMessagesPerSecond",
  "floodKickBudget", "interpolationDelayMs", "correctionSmoothing", "snapDistance", "spawnSpacing",
];

export const parseNetStats = (raw: unknown) => parseNumbers<NetStats>(raw, "net.json", NET_KEYS);
export const parseGrenadeStats = (raw: unknown) => parseNumbers<GrenadeStats>(raw, "grenade.json", GRENADE_KEYS);
export const parseCombatStats = (raw: unknown) => parseNumbers<CombatStats>(raw, "combat.json", COMBAT_KEYS);
export const parseBotStats = (raw: unknown) => parseNumbers<BotStats>(raw, "bots.json", BOT_KEYS);
export const parseMechStats = (raw: unknown) => parseNumbers<MechStats>(raw, "mech.json", MECH_KEYS);
export const parseWeaponStats = (raw: unknown) => parseNumbers<WeaponStats>(raw, "weapon.json", WEAPON_KEYS);
export const parseCameraStats = (raw: unknown) => parseNumbers<CameraStats>(raw, "camera.json", CAMERA_KEYS);

// The M1 gate asks how long it takes to cross a 2000 m map at run speed.
export function secondsToCross(stats: MechStats, meters: number): number {
  return stats.runSpeed > 0 ? meters / stats.runSpeed : Number.POSITIVE_INFINITY;
}
