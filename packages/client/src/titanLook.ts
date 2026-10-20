import type { DeathFxConfig } from "./deathFx";
import { parseGait, type MechGait } from "./gait";

// How the Junk Titan (gate 13c) is drawn: its model, its heavy walk, the shape of its stomp, throw and roar, its fall,
// and the HUD's boss bar and radar mark (data/titanLook.json). Looks only: where it goes, when it acts, how long each
// move lasts and what it hurts are the server's (data/titan.json, read by both).
export interface TitanLook {
  kit: string; // its kit in data/mechKits.json
  kitScale: number; // the kit drawn this many times its modelled size
  lodScale: number; // its simpler levels take over this many times further out than a mech's
  standInScale: number; // the grey-box mech drawn this many times its size while the kit is missing
  colors: { body: string; accent: string; trim: string };
  maxSamples: number; // snapshots kept for drawing it a little in the past, as other mechs are
  walk: {
    walkSpeed: number; runSpeed: number; // for the gait's walk-to-run blend; the Titan only ever walks
    farMeters: number; // further than this from the camera it stands still: nobody can see its feet
    dustMeters: number; dustSeconds: number; dustPuffs: number; // per footfall
    shakeRadius: number; shakeForce: number; // each footfall shakes the camera this close
    loudness: number; pitch: number;
    standInFeetMeters: number; // the stand-in has no legs: its thuds land this far either side of it
    gait: MechGait;
  };
  stomp: {
    slamSeconds: number; // the foot comes down this long before the server's stomp lands
    footLiftMeters: number; footForwardMeters: number; rearDegrees: number; slamDegrees: number;
    puffs: number; puffMeters: number; puffSeconds: number; ringSeconds: number; debris: number; debrisSpeed: number;
    crackSeconds: number; crackFadeSeconds: number; crackLift: number;
    shakeRadius: number; shakeForce: number;
  };
  throw: {
    swingSeconds: number; // the arms swing through in the last of the wind-up before the car leaves
    pickupShare: number; // of the wind-up, when the car appears in its hands
    raisedDegrees: number; releaseDegrees: number; // arms hauled up behind the head, then overhead where they let go
    leanBackDegrees: number; leanForwardDegrees: number;
    handMeters: number; // from the shoulders to where the car is held
    carMeters: number[]; carColors: string[];
    spinPerSecond: number; trailEverySeconds: number; trailMeters: number; maxCars: number;
    shakeRadius: number; shakeForce: number;
  };
  roar: { rearDegrees: number; armDegrees: number; shudderDegrees: number; shudderHz: number; shakeRadius: number; shakeForce: number };
  // It tips forward `toppleDegrees` while it falls, then blows apart as it hits the ground: the mech blow-apart
  // (data/deathFx.json) grown `scale` times, the torso tumbling `tumbleDegrees` and sliding `slideMeters` on, pouring
  // smoke for `pourSeconds`.
  fall: { scale: number; toppleDegrees: number; tumbleDegrees: number; slideMeters: number; pourSeconds: number; shakeRadius: number; shakeForce: number };
  // The core glow dims to `glowLeast` of full as it is worn down. Each zone (legs, arms, torso) rusts `zoneWear`
  // times as fast as its hit points go, so its legs and arms look beaten before its core does.
  damage: { glowLeast: number; zoneWear: number[] };
  hud: { name: string; bossBarMeters: number; radarMarkSize: number };
  replay: { sampleHz: number; keepSeconds: number };
}

const GROUPS: Record<string, string[]> = {
  walk: ["walkSpeed", "runSpeed", "farMeters", "dustMeters", "dustSeconds", "dustPuffs", "shakeRadius", "shakeForce", "loudness", "pitch", "standInFeetMeters"],
  stomp: ["slamSeconds", "footLiftMeters", "footForwardMeters", "rearDegrees", "slamDegrees", "puffs", "puffMeters", "puffSeconds", "ringSeconds", "debris", "debrisSpeed", "crackSeconds", "crackFadeSeconds", "crackLift", "shakeRadius", "shakeForce"],
  throw: ["swingSeconds", "pickupShare", "raisedDegrees", "releaseDegrees", "leanBackDegrees", "leanForwardDegrees", "handMeters", "spinPerSecond", "trailEverySeconds", "trailMeters", "maxCars", "shakeRadius", "shakeForce"],
  roar: ["rearDegrees", "armDegrees", "shudderDegrees", "shudderHz", "shakeRadius", "shakeForce"],
  fall: ["scale", "toppleDegrees", "tumbleDegrees", "slideMeters", "pourSeconds", "shakeRadius", "shakeForce"],
  damage: ["glowLeast"],
  hud: ["bossBarMeters", "radarMarkSize"],
  replay: ["sampleHz", "keepSeconds"],
};

// Fails loudly on a bad data file, like the rest of data/.
export function parseTitanLook(raw: unknown): TitanLook {
  const d = raw as Record<string, Record<string, unknown>>;
  const number = (v: unknown, what: string) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`titanLook.json: ${what} must be a number, 0 or more`);
  };
  if (typeof d?.kit !== "string" || d.kit === "") throw new Error("titanLook.json: kit must name a kit in mechKits.json");
  for (const key of ["kitScale", "lodScale", "standInScale", "maxSamples"]) number(d[key], key);
  for (const key of ["kitScale", "lodScale", "standInScale"]) if (!((d[key] as unknown as number) > 0)) throw new Error(`titanLook.json: ${key} must be above 0`);
  if (!Number.isInteger(d.maxSamples) || (d.maxSamples as unknown as number) < 2) throw new Error("titanLook.json: maxSamples must be a whole number, 2 or more");
  for (const key of ["body", "accent", "trim"]) if (typeof d.colors?.[key] !== "string") throw new Error(`titanLook.json: colors.${key} must be a colour`);
  for (const [group, keys] of Object.entries(GROUPS)) for (const key of keys) number(d[group]?.[key], `${group}.${key}`);
  // The gait is checked by the same rules as every mech's (gait.ts), as the only mech in a gait file.
  parseGait({ farMeters: 0, smoothing: 0, stepLoudness: 0, runStepLoudness: 0, hearWalkMeters: 0, footInward: 0, dustSeconds: 0, dustMeters: 0, mechs: { titan: d.walk!.gait } });
  const look = raw as TitanLook;
  if (look.throw.pickupShare > 1) throw new Error("titanLook.json: throw.pickupShare is a share, 0 to 1");
  if (!Number.isInteger(look.throw.maxCars) || look.throw.maxCars < 1) throw new Error("titanLook.json: throw.maxCars must be a whole number, 1 or more");
  if (!Array.isArray(look.throw.carMeters) || look.throw.carMeters.length !== 3 || !look.throw.carMeters.every((v) => v > 0)) throw new Error("titanLook.json: throw.carMeters is length, height and width, each above 0");
  if (!Array.isArray(look.throw.carColors) || look.throw.carColors.length === 0 || !look.throw.carColors.every((c) => typeof c === "string")) throw new Error("titanLook.json: throw.carColors needs one colour or more");
  if (!Array.isArray(look.damage.zoneWear) || look.damage.zoneWear.length !== 3 || !look.damage.zoneWear.every((v) => typeof v === "number" && v >= 0)) throw new Error("titanLook.json: damage.zoneWear is three numbers, legs, arms, torso");
  if (look.damage.glowLeast > 1) throw new Error("titanLook.json: damage.glowLeast is a share, 0 to 1");
  if (look.walk.walkSpeed <= 0 || look.walk.runSpeed <= look.walk.walkSpeed) throw new Error("titanLook.json: walk.runSpeed must be above walk.walkSpeed, above 0");
  if (look.replay.sampleHz <= 0) throw new Error("titanLook.json: replay.sampleHz must be above 0");
  if (typeof look.hud.name !== "string" || look.hud.name === "") throw new Error("titanLook.json: hud.name must be a name");
  return look;
}

// The mech blow-apart grown to the Titan's size: lengths by `scale`, speeds and times by its square root (a thing
// four times the size falls about twice as long under the same gravity), the pouring smoke as long as the look says.
// The blast stays mech-sized: the big one is the server's, sent as an explosion as the body lands.
export function titanDeathFx(base: DeathFxConfig, fall: TitanLook["fall"]): DeathFxConfig {
  const s = fall.scale, root = Math.sqrt(s);
  return {
    ...base,
    maxWrecks: 1,
    middleMeters: base.middleMeters * s,
    blast: { ...base.blast, popSize: base.blast.popSize * s, sparks: base.blast.sparks * 2 },
    torso: { ...base.torso, seconds: base.torso.seconds * root, meters: fall.slideMeters, degrees: fall.tumbleDegrees, rollDegrees: base.torso.rollDegrees * 0.5, hopMeters: base.torso.hopMeters * root },
    pieces: { ...base.pieces, speed: base.pieces.speed * root, lift: base.pieces.lift * root, settleSpeed: base.pieces.settleSpeed * root, landDustMeters: base.pieces.landDustMeters * s },
    smoke: {
      ...base.smoke, pourSeconds: fall.pourSeconds, riseSpeed: base.smoke.riseSpeed * root, lifeSeconds: base.smoke.lifeSeconds * root,
      startSize: base.smoke.startSize * s, endSize: base.smoke.endSize * s, sparkSpeed: base.smoke.sparkSpeed * root,
    },
  };
}
