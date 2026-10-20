import type { GrenadeState } from "./grenade";
import type { GrenadeStats } from "./stats";
import type { TitanAction } from "./protocol";
import { boxFromData, type Box } from "./world";
import type { ZoneSet } from "./zones";

// The Junk Titan (gate 13c): a huge scrap boss that roams medium and large maps. The server runs it; this file holds
// what both sides need: its numbers (data/titan.json), its hit boxes, and how a thrown car is aimed, so a client flies
// a car with the shared grenade step and it lands exactly where the server's does.

export const TITAN_ACTIONS: readonly TitanAction[] = ["walk", "stomp", "throw", "roar", "down"];
const ZONE_NAMES = ["legs", "arms", "core"];
export const TITAN_CORE = 2;

// What a thrown car needs for the grenade step: it is flown exactly like a grenade, just heavier and slower.
export type CarStats = Pick<GrenadeStats, "gravity" | "bounce" | "friction" | "radius">;

export interface TitanConfig {
  tiers: string[]; // the tiers that get one. The server's TITAN_TIERS can swap this list for testing
  kit: string | null; // the model kit in data/mechKits.json whose measured hit boxes it uses, when it has them
  appearSeconds: number; // seconds into the match it wakes up
  announce: string; // the feed line when it wakes
  fallNotice: string; // the feed line when it goes down
  height: number;
  radius: number; // mechs are pushed out of this circle round it
  aimHeight: number; // how high up bots aim at it
  hp: number;
  zoneMultipliers: number[]; // legs, arms, core: share of a hit that counts
  blastMultiplier: number; // grenades and blasts count this much against it
  boxes: Box[]; // hit boxes in its own frame (x right, y up, forward is -z), like a mech's, for when the kit has none
  boxZone: number[];
  walkSpeed: number;
  turnDegreesPerSecond: number;
  walkingAngleDegrees: number; // it only steps forward once it faces within this much of where it is going
  aggroRange: number; // goes for the nearest mech this close
  grudgeSeconds: number; // whoever hurt it last is its target for this long, from up to grudgeRange away
  grudgeRange: number;
  ringMargin: number; // stays this far inside the ring
  placeShareOfRing: number; // wakes up at most this share of the ring's radius from its centre
  clearOfMechsMeters: number; // and at least this far from every mech
  pushSpeed: number; // a mech inside its circle is shoved out at this speed
  botKeepOutMeters: number; // bots stay at least this far from it, clear of its stomp
  walkNoiseSeconds: number; // a thud on the radar this often while it walks
  stomp: {
    triggerRadius: number; // a mech this near its feet starts a stomp
    radius: number; // and the stomp lands on everything this near
    reachHeight: number; // a mech more than this far above the ground it stands on is jumping over it
    windupSeconds: number;
    recoverSeconds: number;
    cooldownSeconds: number;
    zoneDamage: number[]; // legs, arms, torso
    knockback: number; // speed outwards
    pop: number; // speed upwards
    propHeight: number; // props up to this high in the radius are smashed
  };
  throw: {
    minRange: number;
    range: number;
    windupSeconds: number;
    recoverSeconds: number;
    cooldownSeconds: number;
    flightSeconds: number;
    handHeight: number; // where the car leaves its hand: this high, this far in front
    handForward: number;
    damage: number;
    blastRadius: number;
  };
  car: CarStats;
  roar: { seconds: number; cooldownSeconds: number };
  fall: { seconds: number; damage: number; radius: number; spillMeters: number; contents: string[] };
}

const CONTENTS = ["upgrade", "weapon", "armor", "grenade"];

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

function positive(where: string, raw: Record<string, unknown> | undefined, keys: readonly string[], zeroOk = false): void {
  for (const key of keys) {
    const v = raw?.[key];
    if (typeof v !== "number" || !Number.isFinite(v) || (zeroOk ? v < 0 : v <= 0)) throw new Error(`titan.json: ${where}${key} must be a number ${zeroOk ? "0 or more" : "above 0"}`);
  }
}

// Fails loudly on a bad file, like the other data files. Hit zones arrive as boxes per zone and leave as one flat list.
export function parseTitanConfig(raw: unknown): TitanConfig {
  const r = raw as Record<string, unknown> & { zones?: unknown; stomp?: Record<string, unknown>; throw?: Record<string, unknown>; car?: Record<string, unknown>; roar?: Record<string, unknown>; fall?: Record<string, unknown> };
  if (!Array.isArray(r?.tiers) || r.tiers.some((t) => typeof t !== "string")) throw new Error("titan.json: tiers is a list of tier names");
  if (typeof r.announce !== "string" || typeof r.fallNotice !== "string") throw new Error("titan.json: announce and fallNotice are lines of text");
  if (r.kit !== null && typeof r.kit !== "string") throw new Error("titan.json: kit is a kit name in mechKits.json, or null");
  positive("", r, ["height", "radius", "aimHeight", "hp", "blastMultiplier", "walkSpeed", "turnDegreesPerSecond", "walkingAngleDegrees", "aggroRange", "grudgeRange", "pushSpeed", "botKeepOutMeters", "walkNoiseSeconds"]);
  positive("", r, ["appearSeconds", "grudgeSeconds", "ringMargin", "clearOfMechsMeters", "placeShareOfRing"], true);
  if (!((r.placeShareOfRing as number) <= 1)) throw new Error("titan.json: placeShareOfRing is a share, 0 to 1");
  positive("stomp.", r.stomp, ["triggerRadius", "radius", "reachHeight", "windupSeconds", "recoverSeconds", "propHeight"]);
  positive("stomp.", r.stomp, ["cooldownSeconds", "knockback", "pop"], true);
  if (!Array.isArray(r.stomp!.zoneDamage) || r.stomp!.zoneDamage.length !== 3 || r.stomp!.zoneDamage.some((n) => typeof n !== "number" || !(n >= 0))) throw new Error("titan.json: stomp.zoneDamage is legs, arms, torso");
  positive("throw.", r.throw, ["range", "windupSeconds", "recoverSeconds", "flightSeconds", "handHeight", "blastRadius"]);
  positive("throw.", r.throw, ["minRange", "cooldownSeconds", "handForward", "damage"], true);
  if (!((r.throw!.minRange as number) < (r.throw!.range as number))) throw new Error("titan.json: throw.minRange must be under throw.range");
  positive("car.", r.car, ["gravity", "radius"]);
  positive("car.", r.car, ["bounce", "friction"], true);
  positive("roar.", r.roar, ["seconds"]);
  positive("roar.", r.roar, ["cooldownSeconds"], true);
  positive("fall.", r.fall, ["seconds", "radius", "spillMeters"]);
  positive("fall.", r.fall, ["damage"], true);
  if (!Array.isArray(r.fall!.contents) || r.fall!.contents.some((c) => !CONTENTS.includes(c as string))) throw new Error(`titan.json: fall.contents is a list of ${CONTENTS.join(", ")}`);

  const zones = r.zones;
  if (!Array.isArray(zones) || zones.length !== ZONE_NAMES.length) throw new Error("titan.json: expected zones legs, arms, core");
  const boxes: Box[] = [], boxZone: number[] = [], zoneMultipliers: number[] = [];
  zones.forEach((entry, zone) => {
    const z = entry as { name?: unknown; damageMultiplier?: unknown; boxes?: unknown };
    if (z.name !== ZONE_NAMES[zone]) throw new Error(`titan.json: zone ${zone} must be "${ZONE_NAMES[zone]}"`);
    if (typeof z.damageMultiplier !== "number" || !(z.damageMultiplier >= 0)) throw new Error(`titan.json: ${z.name} damageMultiplier invalid`);
    if (!Array.isArray(z.boxes) || z.boxes.length === 0) throw new Error(`titan.json: ${z.name} needs at least one box`);
    for (const b of z.boxes as { center?: unknown; size?: unknown }[]) {
      if (!isVec3(b.center) || !isVec3(b.size)) throw new Error(`titan.json: ${z.name} has a bad box`);
      boxes.push(boxFromData({ name: ZONE_NAMES[zone]!, center: b.center, size: b.size, color: "" }));
      boxZone.push(zone);
    }
    zoneMultipliers.push(z.damageMultiplier);
  });
  const rest: Record<string, unknown> = { ...r };
  delete rest.zones;
  return { ...(rest as unknown as Omit<TitanConfig, "boxes" | "boxZone" | "zoneMultipliers">), boxes, boxZone, zoneMultipliers };
}

interface KitsHitboxData {
  kits?: Record<string, { hitboxes?: Record<string, { center: number[]; size: number[] }[]> }>;
}

// The boxes shots are checked against: the ones scripts/make-hitboxes.ts measured from its model (data/mechKits.json,
// where its torso is the core), so a shot hits what is drawn; or the boxes in titan.json while it has no model.
export function titanHitBoxes(config: TitanConfig, kitsRaw: unknown): Pick<ZoneSet, "boxes" | "boxZone"> {
  const measured = config.kit ? (kitsRaw as KitsHitboxData | null)?.kits?.[config.kit]?.hitboxes : undefined;
  if (!measured) return config;
  const boxes: Box[] = [], boxZone: number[] = [];
  ["legs", "arms", "torso"].forEach((name, zone) => {
    for (const b of measured[name] ?? []) {
      if (!isVec3(b.center) || !isVec3(b.size)) continue;
      boxes.push(boxFromData({ name, center: b.center, size: b.size, color: "" }));
      boxZone.push(zone);
    }
  });
  return boxes.length > 0 ? { boxes, boxZone } : config;
}

// Aims a thrown car from one spot to land on another after `flightSeconds`, for the grenade step at `dt`. Worked out for
// the step itself (speed changes, then position), not the smooth curve, so the car is exactly on the target on the
// step its fuse runs out, unless something is in the way. The fuse is half a step short of the flight so it cannot
// miss that step by a rounding.
export function aimCar(fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number, flightSeconds: number, car: CarStats, dt: number, out: GrenadeState): void {
  const steps = Math.max(1, Math.round(flightSeconds / dt));
  const time = steps * dt;
  out.x = fromX; out.y = fromY; out.z = fromZ;
  out.vx = (toX - fromX) / time;
  out.vz = (toZ - fromZ) / time;
  out.vy = (toY - fromY) / time + (car.gravity * dt * (steps + 1)) / 2;
  out.timeLeft = (steps - 0.5) * dt;
}
