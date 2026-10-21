import { parseDropSprites, type DropSpritesConfig } from "./fx/dropSprites";

// How the drop-in looks and sounds on this client (gates 16a to 16c), from data/dive.json: the flaming scrap ball you
// fall in, the aim ring and landing marker, the camera, the burst and the landing. The drop itself is the shared
// simulation (packages/shared/src/drop.ts); everything here is camera, HUD and effects.

export interface DiveConfig {
  camera: {
    minPitchDegrees: number; // how far down you can look while dropping (walking stops at mech.json minPitch)
    startPitchDegrees: number; // where the view is put when you first hang over the map, looking down at it
    pitchReturnDegreesPerSecond: number; // after landing, the view eases back up to the walking limit this fast
    pullBackMeters: number; liftMeters: number; // the camera sits this much further back and higher while dropping
    burnPull: number; // share of that pull kept during the retro burn, so the landing is framed closer
    followPerSecond: number;
    fovWidenDegrees: number; fovFromSpeed: number; fovFullSpeed: number; // wider with fall speed, m/s
    landingShake: number;
  };
  // The ring on the ground under your crosshair while you drop, which is where you are steering for.
  aim: { rangeMeters: number; radiusMeters: number; sizePerMeter: number; opacity: number; color: string };
  speedLines: { count: number; radiusMeters: number; clearRadiusMeters: number; lengthMeters: number; widthMeters: number; fromSpeed: number; fullSpeed: number };
  marker: { stepSeconds: number; maxSteps: number; everySeconds: number; radiusMeters: number; sizePerMeter: number; pulsePerSecond: number; opacity: number; color: string };
  trail: { spacingMeters: number; seconds: number; width: number; grow: number; rise: number; centerMeters: number };
  pose: { burnTiltDegrees: number; pivotMeters: number; followPerSecond: number }; // rocking back on the retro-jets
  burn: { flameScale: number };
  impact: {
    dustPuffs: number; ringMeters: number; dustSpeed: number; dustSize: number; dustSeconds: number;
    shockStartMeters: number; shockEndMeters: number; shockSeconds: number; // the quick shockwave ring
    ringStartMeters: number; ringEndMeters: number; ringSeconds: number; // the slower ring of dust behind it
    debris: number; debrisSpeed: number; debrisLift: number; debrisSize: number; debrisSeconds: number; debrisColors: string[];
    shakeRadiusMeters: number; shakeForce: number;
  };
  wind: { fromSpeed: number; fullSpeed: number };
  // The scrap ball round a mech hanging or falling. hangFlameShare: how long the flame is while it hangs still.
  ball: { radiusMeters: number; centerMeters: number; colors: string[]; flameLength: number; flameWidth: number; hangFlameShare: number; rollPerSecond: number; framesPerSecond: number; capacity: number };
  burst: { plates: number; plateSpeed: number; plateLift: number; plateSize: number; plateSeconds: number; plateColors: string[]; fireballs: number; fireballSize: number; fireballSeconds: number };
  toon: DropSpritesConfig;
  hud: { countdownWords: string; hanging: string; ball: string; burning: string; aimCall: string; aimCallSeconds: number };
}

// Keys that may be below zero: angles that point up or down.
const SIGNED = new Set(["minPitchDegrees", "startPitchDegrees", "burnTiltDegrees"]);
const STRINGS = new Set(["color", "countdownWords", "hanging", "ball", "burning", "aimCall"]);
const GROUPS: Record<string, string[]> = {
  camera: ["minPitchDegrees", "startPitchDegrees", "pitchReturnDegreesPerSecond", "pullBackMeters", "liftMeters", "burnPull", "followPerSecond", "fovWidenDegrees", "fovFromSpeed", "fovFullSpeed", "landingShake"],
  aim: ["rangeMeters", "radiusMeters", "sizePerMeter", "opacity", "color"],
  speedLines: ["count", "radiusMeters", "clearRadiusMeters", "lengthMeters", "widthMeters", "fromSpeed", "fullSpeed"],
  marker: ["stepSeconds", "maxSteps", "everySeconds", "radiusMeters", "sizePerMeter", "pulsePerSecond", "opacity", "color"],
  trail: ["spacingMeters", "seconds", "width", "grow", "rise", "centerMeters"],
  pose: ["burnTiltDegrees", "pivotMeters", "followPerSecond"],
  burn: ["flameScale"],
  impact: ["dustPuffs", "ringMeters", "dustSpeed", "dustSize", "dustSeconds", "shockStartMeters", "shockEndMeters", "shockSeconds", "ringStartMeters", "ringEndMeters", "ringSeconds", "debris", "debrisSpeed", "debrisLift", "debrisSize", "debrisSeconds", "shakeRadiusMeters", "shakeForce"],
  wind: ["fromSpeed", "fullSpeed"],
  ball: ["radiusMeters", "centerMeters", "flameLength", "flameWidth", "hangFlameShare", "rollPerSecond", "framesPerSecond", "capacity"],
  burst: ["plates", "plateSpeed", "plateLift", "plateSize", "plateSeconds", "fireballs", "fireballSize", "fireballSeconds"],
  hud: ["countdownWords", "hanging", "ball", "burning", "aimCall", "aimCallSeconds"],
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
  const names = (group: string, key: string) => {
    const list = (d[group] as Record<string, unknown>)[key];
    if (!Array.isArray(list) || list.length === 0 || !list.every((x) => typeof x === "string")) throw new Error(`dive.json: ${group}.${key} must be a list of colour names`);
  };
  names("ball", "colors");
  names("burst", "plateColors");
  names("impact", "debrisColors");
  parseDropSprites(d.toon);
  const c = d.camera as unknown as DiveConfig["camera"];
  if (c.minPitchDegrees >= 0 || c.minPitchDegrees < -89) throw new Error("dive.json: camera.minPitchDegrees must be between -89 and 0");
  if (c.startPitchDegrees < c.minPitchDegrees || c.startPitchDegrees > 0) throw new Error("dive.json: camera.startPitchDegrees must be between minPitchDegrees and 0");
  if (!(c.fovFullSpeed > c.fovFromSpeed)) throw new Error("dive.json: camera.fovFullSpeed must be above fovFromSpeed");
  if (!Number.isInteger((d.ball as Record<string, number>).capacity)) throw new Error("dive.json: ball.capacity must be a whole number");
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
