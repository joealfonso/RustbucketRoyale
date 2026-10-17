// Tuning shapes and loaders. Values live in data/*.json, never in code.
export interface MechStats {
  walkSpeed: number;
  runSpeed: number;
  acceleration: number;
  deceleration: number;
  airControl: number;
  turnSpeedDegrees: number;
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
}

export interface WeaponStats {
  shotsPerSecond: number;
  projectileSpeed: number;
  projectileLifetime: number;
  spreadDegrees: number;
  maxAimDistance: number;
  shakeForce: number;
}

export interface CameraStats {
  fov: number;
  distance: number;
  shoulderX: number;
  pivotHeight: number;
  radius: number;
  near: number;
  pullOutSpeed: number;
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
];
const WEAPON_KEYS: (keyof WeaponStats & string)[] = [
  "shotsPerSecond", "projectileSpeed", "projectileLifetime", "spreadDegrees", "maxAimDistance", "shakeForce",
];
const CAMERA_KEYS: (keyof CameraStats & string)[] = [
  "fov", "distance", "shoulderX", "pivotHeight", "radius", "near", "pullOutSpeed",
];

export const parseMechStats = (raw: unknown) => parseNumbers<MechStats>(raw, "mech.json", MECH_KEYS);
export const parseWeaponStats = (raw: unknown) => parseNumbers<WeaponStats>(raw, "weapon.json", WEAPON_KEYS);
export const parseCameraStats = (raw: unknown) => parseNumbers<CameraStats>(raw, "camera.json", CAMERA_KEYS);

// The M1 gate asks how long it takes to cross a 2000 m map at run speed.
export function secondsToCross(stats: MechStats, meters: number): number {
  return stats.runSpeed > 0 ? meters / stats.runSpeed : Number.POSITIVE_INFINITY;
}
