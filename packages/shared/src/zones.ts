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

  const set: ZoneSet = { zones: [], boxes: [], boxZone: [] };
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

// Applies damage to one zone and returns how much was actually taken off (after armor, capped by what was left).
export function applyDamage(hp: number[], set: ZoneSet, zone: number, amount: number): number {
  const wanted = amount * set.zones[zone]!.damageMultiplier;
  const taken = Math.min(hp[zone]!, wanted);
  hp[zone] = hp[zone]! - taken;
  return taken;
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

// Ray against one mech standing at (mx, my, mz) facing `yaw`. Writes the nearest zone hit into `out`.
export function raycastMech(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number,
  mx: number, my: number, mz: number, yaw: number, set: ZoneSet, out: ZoneHit,
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
