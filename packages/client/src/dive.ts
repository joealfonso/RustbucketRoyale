import { parseDropSprites, type DropSpritesConfig } from "./fx/dropSprites";

// How the drop-in looks and sounds on this client (gates 16a and 16b), from data/dive.json: the ship and its cannon,
// the shell, the dive and the landing. The drop itself is the shared simulation (packages/shared/src/drop.ts);
// everything here is camera, HUD and effects.

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
  speedLines: { count: number; radiusMeters: number; clearRadiusMeters: number; lengthMeters: number; widthMeters: number; fromSpeed: number; fullSpeed: number };
  marker: { stepSeconds: number; maxSteps: number; everySeconds: number; radiusMeters: number; sizePerMeter: number; pulsePerSecond: number; opacity: number; color: string };
  trail: { spacingMeters: number; seconds: number; width: number; grow: number; rise: number; centerMeters: number };
  pose: {
    levelTiltDegrees: number; steepTiltDegrees: number; burnTiltDegrees: number; // how far the body tips nose down
    levelFallDegrees: number; steepFallDegrees: number; // the angle of travel below level that counts as each end
    pivotMeters: number; followPerSecond: number; wobbleDegrees: number; wobblePerSecond: number;
  };
  burn: { flameScale: number };
  impact: {
    dustPuffs: number; ringMeters: number; dustSpeed: number; dustSize: number; dustSeconds: number;
    shockStartMeters: number; shockEndMeters: number; shockSeconds: number; // the quick shockwave ring
    ringStartMeters: number; ringEndMeters: number; ringSeconds: number; // the slower ring of dust behind it
    debris: number; debrisSpeed: number; debrisLift: number; debrisSize: number; debrisSeconds: number; debrisColors: string[];
    shakeRadiusMeters: number; shakeForce: number;
  };
  wind: { fromSpeed: number; fullSpeed: number };
  ship: {
    kit: string; // the Rustbucket's model, paint and levels of detail in data/shipKit.json; a grey-box stand-in of standIn's size is drawn until it loads
    offlineCircleShare: number; // offline has no ring: the line passes through a circle this share of the map wide
    turnDegrees: number; // turns the model so its nose is +z (it is built nose to -z, like the mechs)
    standIn: { lengthMeters: number; widthMeters: number; heightMeters: number; hull: string; trim: string; patch: string; barrel: string };
    // Where the camera sits from that mount, in the ship's frame, and how long it stays there after you are fired out.
    bayCamera: { mount: string; back: number; up: number; side: number; holdSeconds: number };
    exhaust: { every: number; width: number; grow: number; seconds: number; backSpeed: number };
  };
  cannon: { flashSize: number; flashSeconds: number; flashPuffs: number; smokePuffs: number; smokeSize: number; smokeSpeed: number; smokeSeconds: number; shake: number; bayKickDegrees: number; nearShakeMeters: number };
  shell: { radiusMeters: number; centerMeters: number; colors: string[]; flameLength: number; flameWidth: number; framesPerSecond: number; smokeEvery: number; capacity: number };
  burst: { plates: number; plateSpeed: number; plateLift: number; plateSize: number; plateSeconds: number; plateColors: string[]; fireballs: number; fireballSize: number; fireballSeconds: number };
  toon: DropSpritesConfig;
  hud: { countdownWords: string; riding: string; launch: string; ejectIn: string; shell: string; diving: string; burning: string };
}

// Keys that may be below zero: angles that point up or down.
const SIGNED = new Set(["minPitchDegrees", "burnTiltDegrees", "turnDegrees"]);
const STRINGS = new Set(["mount", "color", "countdownWords", "riding", "launch", "ejectIn", "shell", "diving", "burning", "kit", "hull", "trim", "patch", "barrel"]);
const GROUPS: Record<string, string[]> = {
  camera: ["minPitchDegrees", "pitchReturnDegreesPerSecond", "pullBackMeters", "liftMeters", "burnPull", "followPerSecond", "fovWidenDegrees", "fovFromSpeed", "fovFullSpeed", "landingShake"],
  speedLines: ["count", "radiusMeters", "clearRadiusMeters", "lengthMeters", "widthMeters", "fromSpeed", "fullSpeed"],
  marker: ["stepSeconds", "maxSteps", "everySeconds", "radiusMeters", "sizePerMeter", "pulsePerSecond", "opacity", "color"],
  trail: ["spacingMeters", "seconds", "width", "grow", "rise", "centerMeters"],
  pose: ["levelTiltDegrees", "steepTiltDegrees", "burnTiltDegrees", "levelFallDegrees", "steepFallDegrees", "pivotMeters", "followPerSecond", "wobbleDegrees", "wobblePerSecond"],
  burn: ["flameScale"],
  impact: ["dustPuffs", "ringMeters", "dustSpeed", "dustSize", "dustSeconds", "shockStartMeters", "shockEndMeters", "shockSeconds", "ringStartMeters", "ringEndMeters", "ringSeconds", "debris", "debrisSpeed", "debrisLift", "debrisSize", "debrisSeconds", "shakeRadiusMeters", "shakeForce"],
  wind: ["fromSpeed", "fullSpeed"],
  ship: ["kit", "offlineCircleShare", "turnDegrees"],
  cannon: ["flashSize", "flashSeconds", "flashPuffs", "smokePuffs", "smokeSize", "smokeSpeed", "smokeSeconds", "shake", "bayKickDegrees", "nearShakeMeters"],
  shell: ["radiusMeters", "centerMeters", "flameLength", "flameWidth", "framesPerSecond", "smokeEvery", "capacity"],
  burst: ["plates", "plateSpeed", "plateLift", "plateSize", "plateSeconds", "fireballs", "fireballSize", "fireballSeconds"],
  hud: ["countdownWords", "riding", "launch", "ejectIn", "shell", "diving", "burning"],
};
// Groups inside the ship's settings, checked the same way.
const SHIP_GROUPS: Record<string, string[]> = {
  standIn: ["lengthMeters", "widthMeters", "heightMeters", "hull", "trim", "patch", "barrel"],
  bayCamera: ["mount", "back", "up", "side", "holdSeconds"],
  exhaust: ["every", "width", "grow", "seconds", "backSpeed"],
};
const SIGNED_SHIP = new Set(["back", "up", "side"]);

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
  for (const [group, keys] of Object.entries(SHIP_GROUPS)) {
    for (const key of keys) {
      const v = (d.ship as Record<string, Record<string, unknown> | undefined>)?.[group]?.[key];
      if (STRINGS.has(key) ? typeof v !== "string" || v.length === 0 : typeof v !== "number" || !Number.isFinite(v) || (!SIGNED_SHIP.has(key) && v < 0)) {
        throw new Error(`dive.json: ship.${group}.${key} must be ${STRINGS.has(key) ? "some text" : "a number"}`);
      }
    }
  }
  const names = (group: string, key: string) => {
    const list = (d[group] as Record<string, unknown>)[key];
    if (!Array.isArray(list) || list.length === 0 || !list.every((x) => typeof x === "string")) throw new Error(`dive.json: ${group}.${key} must be a list of colour names`);
  };
  names("shell", "colors");
  names("burst", "plateColors");
  parseDropSprites(d.toon);
  const c = d.camera as unknown as DiveConfig["camera"];
  if (c.minPitchDegrees >= 0 || c.minPitchDegrees < -89) throw new Error("dive.json: camera.minPitchDegrees must be between -89 and 0");
  if (!(c.fovFullSpeed > c.fovFromSpeed)) throw new Error("dive.json: camera.fovFullSpeed must be above fovFromSpeed");
  const p = d.pose as unknown as DiveConfig["pose"];
  if (!(p.steepFallDegrees > p.levelFallDegrees)) throw new Error("dive.json: pose.steepFallDegrees must be above levelFallDegrees");
  names("impact", "debrisColors");
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
