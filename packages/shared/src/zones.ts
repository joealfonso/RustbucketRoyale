import { boxFromData, createRayHit, raycastBoxes, type Box, type RayHit } from "./world";

export const ZONE_LEGS = 0;
export const ZONE_ARMS = 1;
export const ZONE_TORSO = 2;
export const ZONE_COUNT = 3;
const ZONE_NAMES = ["legs", "arms", "torso"];

export interface ZoneDef {
  name: string;
  hp: number;
  damageMultiplier: number;
}

// The three hit zones of a mech and the boxes that make them up, in the mech's own frame
// (x right, y up, forward is -z), so a mech can turn and the boxes turn with it.
export interface ZoneSet {
  damagedBelowFraction: number; // a zone under this share of its hit points shows as damaged
  brokenArmsSpreadMultiplier: number; // with the arms broken every shot strays this much more
  repairSeconds: number; // F held this long, standing still and unhurt, repairs one part
  repairToFraction: number; // a repaired part comes back to this share of its hit points: running again, not new
  zones: ZoneDef[];
  boxes: Box[];
  boxZone: number[];
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

// Fails loudly on a bad data file, same as the other tuning files.
export function parseZones(raw: unknown): ZoneSet {
  const list = (raw as { zones?: unknown })?.zones;
  if (!Array.isArray(list) || list.length !== ZONE_COUNT) throw new Error("zones.json: expected legs, arms, torso");

  const top = raw as { damagedBelowFraction?: unknown; brokenArmsSpreadMultiplier?: unknown };
  if (typeof top.damagedBelowFraction !== "number" || !(top.damagedBelowFraction > 0 && top.damagedBelowFraction < 1)) throw new Error("zones.json: damagedBelowFraction must be between 0 and 1");
  if (typeof top.brokenArmsSpreadMultiplier !== "number" || !(top.brokenArmsSpreadMultiplier >= 1)) throw new Error("zones.json: brokenArmsSpreadMultiplier must be at least 1");
  const repair = raw as { repairSeconds?: unknown; repairToFraction?: unknown };
  if (typeof repair.repairSeconds !== "number" || !(repair.repairSeconds > 0)) throw new Error("zones.json: repairSeconds must be above 0");
  if (typeof repair.repairToFraction !== "number" || !(repair.repairToFraction > 0 && repair.repairToFraction <= 1)) throw new Error("zones.json: repairToFraction must be between 0 and 1");
  const set: ZoneSet = {
    damagedBelowFraction: top.damagedBelowFraction, brokenArmsSpreadMultiplier: top.brokenArmsSpreadMultiplier,
    repairSeconds: repair.repairSeconds, repairToFraction: repair.repairToFraction, zones: [], boxes: [], boxZone: [],
  };
  list.forEach((entry, zone) => {
    const z = entry as { name: string; hp?: unknown; damageMultiplier?: unknown; boxes?: unknown };
    if (z.name !== ZONE_NAMES[zone]) throw new Error(`zones.json: zone ${zone} must be "${ZONE_NAMES[zone]}"`);
    if (typeof z.hp !== "number" || !(z.hp > 0)) throw new Error(`zones.json: ${z.name} hp must be above 0`);
    if (typeof z.damageMultiplier !== "number" || !(z.damageMultiplier >= 0)) throw new Error(`zones.json: ${z.name} damageMultiplier invalid`);
    if (!Array.isArray(z.boxes) || z.boxes.length === 0) throw new Error(`zones.json: ${z.name} needs at least one box`);
    for (const b of z.boxes as { center?: unknown; size?: unknown }[]) {
      if (!isVec3(b.center) || !isVec3(b.size)) throw new Error(`zones.json: ${z.name} has a bad box`);
      set.boxes.push(boxFromData({ name: z.name, center: b.center, size: b.size, color: "" }));
      set.boxZone.push(zone);
    }
    set.zones.push({ name: z.name, hp: z.hp, damageMultiplier: z.damageMultiplier });
  });
  return set;
}

export function createHealth(set: ZoneSet): number[] {
  return set.zones.map((z) => z.hp);
}

// Applies damage to one zone and returns how much was actually taken off. Armor plates on that zone soak it up
// first, and only what gets past them reaches the zone's hit points.
export function applyDamage(hp: number[], set: ZoneSet, zone: number, amount: number, armor?: number[]): number {
  let wanted = amount * set.zones[zone]!.damageMultiplier;
  let soaked = 0;
  if (armor && armor[zone]! > 0) {
    soaked = Math.min(armor[zone]!, wanted);
    armor[zone] = armor[zone]! - soaked;
    wanted -= soaked;
  }
  const taken = Math.min(hp[zone]!, wanted);
  hp[zone] = hp[zone]! - taken;
  return soaked + taken;
}

export const ZONE_INTACT = 0;
export const ZONE_DAMAGED = 1;
export const ZONE_BROKEN = 2;

// Intact, damaged or broken, from what is left of the zone's hit points.
export function zoneState(hp: readonly number[], set: ZoneSet, zone: number): number {
  const left = hp[zone]!;
  if (left <= 0) return ZONE_BROKEN;
  return left < set.zones[zone]!.hp * set.damagedBelowFraction ? ZONE_DAMAGED : ZONE_INTACT;
}

// The part a repair works on: the one with the smallest share of its hit points left, as long as that is under what
// a repair brings it back to. -1 when nothing needs it.
export function partToRepair(hp: readonly number[], set: ZoneSet): number {
  let worst = -1;
  let worstShare = set.repairToFraction;
  for (let zone = 0; zone < set.zones.length; zone++) {
    const share = hp[zone]! / set.zones[zone]!.hp;
    if (share < worstShare) { worst = zone; worstShare = share; }
  }
  return worst;
}

export function isDestroyed(hp: readonly number[]): boolean {
  return hp[ZONE_TORSO]! <= 0;
}

export interface ZoneHit {
  distance: number;
  zone: number;
}

export function createZoneHit(): ZoneHit {
  return { distance: 0, zone: -1 };
}

const scratch: RayHit = createRayHit();

// Ray against one mech standing at (mx, my, mz) facing `yaw`. Writes the nearest zone hit into `out`. Only the boxes are
// read, so the Junk Titan's hit boxes go through it too.
export function raycastMech(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number,
  mx: number, my: number, mz: number, yaw: number, set: Pick<ZoneSet, "boxes" | "boxZone">, out: ZoneHit,
): boolean {
  // Move the ray into the mech's own frame (inverse of the yaw turn) so the zone boxes stay axis aligned.
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const rx = ox - mx, rz = oz - mz;
  const lox = cos * rx - sin * rz, loy = oy - my, loz = sin * rx + cos * rz;
  const ldx = cos * dx - sin * dz, ldz = sin * dx + cos * dz;

  if (!raycastBoxes(lox, loy, loz, ldx, dy, ldz, maxDistance, set.boxes, scratch)) return false;
  out.distance = scratch.distance;
  out.zone = set.boxZone[scratch.index]!;
  return true;
}
