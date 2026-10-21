// How the drop-in dive looks and sounds on this client (gate 16a), from data/dive.json. The dive itself is the
// shared simulation (packages/shared/src/drop.ts); everything here is camera, HUD and effects.

export interface DiveConfig {
  camera: {
    minPitchDegrees: number; // how far down you can look while dropping (walking stops at mech.json minPitch)
    pitchReturnDegreesPerSecond: number; // after landing, the view eases back up to the walking limit this fast
    pullBackMeters: number; liftMeters: number; // the camera sits this much further back and higher while dropping
    burnPull: number; // share of that pull kept during the retro burn, so the landing is framed closer
    followPerSecond: number;
    fovWidenDegrees: number; fovFromSpeed: number; fovFullSpeed: number; // wider with fall speed, m/s
    landingShake: number;
  };
  speedLines: { count: number; radiusMeters: number; clearRadiusMeters: number; lengthMeters: number; fromSpeed: number; fullSpeed: number; opacity: number; color: string };
  marker: { stepSeconds: number; maxSteps: number; everySeconds: number; radiusMeters: number; sizePerMeter: number; pulsePerSecond: number; opacity: number; color: string };
  trail: { puffsPerSecond: number; seconds: number; width: number; grow: number; overlap: number; rise: number; centerMeters: number };
  pose: {
    levelTiltDegrees: number; steepTiltDegrees: number; burnTiltDegrees: number; // how far the body tips nose down
    levelFallDegrees: number; steepFallDegrees: number; // the angle of travel below level that counts as each end
    pivotMeters: number; followPerSecond: number; wobbleDegrees: number; wobblePerSecond: number;
  };
  burn: { flameScale: number };
  impact: {
    dustPuffs: number; ringMeters: number; dustSpeed: number; dustSize: number; dustSeconds: number;
    debris: number; debrisSpeed: number; debrisLift: number; debrisSize: number; debrisSeconds: number; debrisColors: string[];
    shakeRadiusMeters: number; shakeForce: number;
  };
  wind: { fromSpeed: number; fullSpeed: number };
  hud: { countdownWords: string; riding: string; diving: string; burning: string };
}

// Keys that may be below zero: angles that point up or down.
const SIGNED = new Set(["minPitchDegrees", "burnTiltDegrees"]);
const STRINGS = new Set(["color", "countdownWords", "riding", "diving", "burning"]);
const GROUPS: Record<string, string[]> = {
  camera: ["minPitchDegrees", "pitchReturnDegreesPerSecond", "pullBackMeters", "liftMeters", "burnPull", "followPerSecond", "fovWidenDegrees", "fovFromSpeed", "fovFullSpeed", "landingShake"],
  speedLines: ["count", "radiusMeters", "clearRadiusMeters", "lengthMeters", "fromSpeed", "fullSpeed", "opacity", "color"],
  marker: ["stepSeconds", "maxSteps", "everySeconds", "radiusMeters", "sizePerMeter", "pulsePerSecond", "opacity", "color"],
  trail: ["puffsPerSecond", "seconds", "width", "grow", "overlap", "rise", "centerMeters"],
  pose: ["levelTiltDegrees", "steepTiltDegrees", "burnTiltDegrees", "levelFallDegrees", "steepFallDegrees", "pivotMeters", "followPerSecond", "wobbleDegrees", "wobblePerSecond"],
  burn: ["flameScale"],
  impact: ["dustPuffs", "ringMeters", "dustSpeed", "dustSize", "dustSeconds", "debris", "debrisSpeed", "debrisLift", "debrisSize", "debrisSeconds", "shakeRadiusMeters", "shakeForce"],
  wind: ["fromSpeed", "fullSpeed"],
  hud: ["countdownWords", "riding", "diving", "burning"],
};

export function parseDive(raw: unknown): DiveConfig {
  const d = raw as Record<string, Record<string, unknown> | undefined>;
  for (const [group, keys] of Object.entries(GROUPS)) {
    for (const key of keys) {
      const v = d?.[group]?.[key];
      if (STRINGS.has(key)) {
        if (typeof v !== "string" || v.length === 0) throw new Error(`dive.json: ${group}.${key} must be some text`);
      } else if (typeof v !== "number" || !Number.isFinite(v) || (!SIGNED.has(key) && v < 0)) {
        throw new Error(`dive.json: ${group}.${key} must be a number${SIGNED.has(key) ? "" : ", 0 or more"}`);
      }
    }
  }
  const c = d.camera as unknown as DiveConfig["camera"];
  if (c.minPitchDegrees >= 0 || c.minPitchDegrees < -89) throw new Error("dive.json: camera.minPitchDegrees must be between -89 and 0");
  if (!(c.fovFullSpeed > c.fovFromSpeed)) throw new Error("dive.json: camera.fovFullSpeed must be above fovFromSpeed");
  const p = d.pose as unknown as DiveConfig["pose"];
  if (!(p.steepFallDegrees > p.levelFallDegrees)) throw new Error("dive.json: pose.steepFallDegrees must be above levelFallDegrees");
  const colors = (d.impact as Record<string, unknown>).debrisColors;
  if (!Array.isArray(colors) || colors.length === 0 || !colors.every((x) => typeof x === "string")) throw new Error("dive.json: impact.debrisColors must be a list of colour names");
  return raw as DiveConfig;
}

// How far 0 to 1 a value is between two ends.
export function share(value: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

// Metres above the spawn's ground a match starts from on this tier, from data/drop.json's altitudeMeters (the
// server's own numbers), or null for a tier without a drop-in (the range), the same as the server's rule.
export function startAltitude(altitudes: Record<string, unknown>, tier: string): number | null {
  const value = altitudes[tier];
  return typeof value === "number" && value > 0 ? value : null;
}
