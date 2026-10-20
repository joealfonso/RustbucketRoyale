import type { AbilityStats, KnockoutHow, WeaponSet } from "@rustbucket/shared";

// What hurt a mech, kept on the player as a plain number so noting a hit costs nothing. It is spelled out as the
// shared cause id (see KnockoutHow in protocol.ts) only when a knockout is told, which is rare.
export const CAUSE_NONE = 0;
export const CAUSE_GRENADE = 1;
export const CAUSE_BARREL = 2;
export const CAUSE_RING = 3;
export const CAUSE_DROP = 4;
const FIXED_NAMES = ["", "grenade", "barrel", "ring", "drop"];
const ABILITY_KINDS: readonly AbilityStats["kind"][] = ["ram", "pounce", "barrage", "decoy", "rail"];
const ABILITY_FIRST = 10;
const WEAPON_FIRST = 100;

export const abilityCause = (kind: AbilityStats["kind"]): number => ABILITY_FIRST + ABILITY_KINDS.indexOf(kind);
export const weaponCause = (weaponIndex: number): number => WEAPON_FIRST + weaponIndex;

export interface CauseTrail {
  cause: number;
  causeBefore: number;
}

// Keeps the last two different causes: the same gun hitting again and again is one cause, not a list of it.
export function noteCause(trail: CauseTrail, code: number): void {
  if (trail.cause === code) return;
  trail.causeBefore = trail.cause;
  trail.cause = code;
}

export function clearCauses(trail: CauseTrail): void {
  trail.cause = CAUSE_NONE;
  trail.causeBefore = CAUSE_NONE;
}

export function causeName(code: number, weapons: WeaponSet): string {
  if (code >= WEAPON_FIRST) return `weapon:${weapons.weapons[code - WEAPON_FIRST]?.id ?? "unknown"}`;
  if (code >= ABILITY_FIRST) return `ability:${ABILITY_KINDS[code - ABILITY_FIRST] ?? "unknown"}`;
  return FIXED_NAMES[code] ?? "unknown";
}

// Who knocked a mech out and how, oldest cause first. The killer is whoever the room credits with the knockout, so
// a mech shot and then finished by the ring has the gun and the ring as causes but no killer.
export function knockoutHow(victim: CauseTrail, killer: { state: { mech: number }; bot: unknown } | null, weapons: WeaponSet): KnockoutHow {
  const causes: string[] = [];
  if (victim.causeBefore !== CAUSE_NONE) causes.push(causeName(victim.causeBefore, weapons));
  if (victim.cause !== CAUSE_NONE) causes.push(causeName(victim.cause, weapons));
  return { killerMech: killer ? killer.state.mech : -1, killerBot: killer !== null && killer.bot !== null, causes };
}
