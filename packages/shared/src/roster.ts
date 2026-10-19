import type { MechStats } from "./stats";
import { ZONE_COUNT } from "./zones";

// The four launch mechs and how each one plays (data/roster.json). Every number is a multiplier on the shared
// values in mech.json and zones.json, so tuning the base still reaches every mech and a mech can never drift
// into its own copy of the rules.
export interface RosterMech {
  id: string; // matches the kit of the same name in data/mechKits.json
  name: string;
  role: string;
  speed: number; // walk and run speed
  jets: number; // fuel tank: how long it can fly
  lift: number; // jet push and climb rate: how fast it gets up
  damageTaken: { legs: number; arms: number; torso: number }; // below 1 is tougher
}

export interface Roster {
  mechs: RosterMech[];
}

// The mech number travels in two spare bits of a flags byte in every snapshot, so four is the most there can be.
export const MAX_ROSTER = 4;
const ZONE_KEYS = ["legs", "arms", "torso"] as const;

const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

// Fails loudly on a bad data file, same as the other tuning files.
export function parseRoster(raw: unknown): Roster {
  const list = (raw as { mechs?: unknown })?.mechs;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_ROSTER) throw new Error(`roster.json: needs 1 to ${MAX_ROSTER} mechs`);
  const mechs = list.map((entry): RosterMech => {
    const m = entry as Record<string, unknown>;
    if (typeof m.id !== "string" || typeof m.name !== "string" || typeof m.role !== "string") throw new Error("roster.json: every mech needs id, name and role");
    for (const key of ["speed", "jets", "lift"]) if (!positive(m[key])) throw new Error(`roster.json: ${m.id} ${key} must be above 0`);
    const taken = m.damageTaken as Record<string, unknown> | undefined;
    for (const zone of ZONE_KEYS) if (!positive(taken?.[zone])) throw new Error(`roster.json: ${m.id} damageTaken.${zone} must be above 0`);
    return m as unknown as RosterMech;
  });
  return { mechs };
}

// A mech number from anywhere (a client, a snapshot) made safe to index the roster with.
export function rosterIndex(roster: Roster | null, mech: number): number {
  const count = roster?.mechs.length ?? 1;
  return Number.isInteger(mech) && mech >= 0 && mech < count ? mech : 0;
}

// Each mech's movement numbers. The objects are made once and read the base and the roster live through getters,
// so a tuned value reaches every mech at once and stepping a mech allocates nothing. Without a roster every mech
// moves the same, which is what the tests are built around.
export function mechStatsFor(base: MechStats, roster: Roster | null): (mech: number) => MechStats {
  if (!roster) return () => base;
  const sets = roster.mechs.map((_, i) => {
    const m = () => roster.mechs[i]!;
    const stats = Object.create(base) as MechStats;
    Object.defineProperties(stats, {
      walkSpeed: { get: () => base.walkSpeed * m().speed },
      runSpeed: { get: () => base.runSpeed * m().speed },
      fuelMax: { get: () => base.fuelMax * m().jets },
      jetLift: { get: () => base.jetLift * m().lift },
      jetMaxRiseSpeed: { get: () => base.jetMaxRiseSpeed * m().lift },
    });
    return stats;
  });
  return (mech) => sets[rosterIndex(roster, mech)]!;
}

// How much of a hit each part of this mech takes, legs, arms, torso.
export function damageTakenFor(roster: Roster | null, mech: number, zone: number): number {
  if (!roster || zone < 0 || zone >= ZONE_COUNT) return 1;
  return roster.mechs[rosterIndex(roster, mech)]!.damageTaken[ZONE_KEYS[zone]!];
}
