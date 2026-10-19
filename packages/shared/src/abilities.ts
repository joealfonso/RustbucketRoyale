import { rosterIndex, type Roster } from "./roster";

// The Q ability of each roster mech (data/abilities.json), keyed by roster id. A mech with no entry has no ability.
// Movement numbers are read by the shared mech step so the client predicts a ram or a leap exactly like the
// server; damage and knockback are the server's.
export interface RamStats {
  kind: "ram";
  name: string;
  cooldownSeconds: number;
  activeSeconds: number; // how long the charge lasts
  speed: number; // charge speed, metres a second
  hitRadius: number; // how close in front another mech has to be to get rammed
  damage: number;
  knockback: number; // metres a second the rammed mech is shoved
  pop: number; // metres a second the rammed mech is thrown upward too
  shieldFrontCosine: number; // a shot counts as from the front when it comes within acos(this) of head on
  frontDamageMultiplier: number; // share of incoming damage the ramming mech takes from the front while charging
}

export interface PounceStats {
  kind: "pounce";
  name: string;
  cooldownSeconds: number;
  speed: number; // the fastest the leap may travel sideways, which caps how far it reaches
  lift: number; // upward launch speed: higher is a taller, longer leap
  maxRange: number; // the aim point is pulled in to this distance
  slamRadius: number; // landing damage reaches this far
  damage: number;
}

export type AbilityStats = RamStats | PounceStats;

export interface AbilitySet {
  mechs: Record<string, AbilityStats>;
}

const POSITIVE: Record<AbilityStats["kind"], readonly string[]> = {
  ram: ["cooldownSeconds", "activeSeconds", "speed", "hitRadius"],
  pounce: ["cooldownSeconds", "speed", "lift", "maxRange", "slamRadius"],
};
const NOT_NEGATIVE: Record<AbilityStats["kind"], readonly string[]> = {
  ram: ["damage", "knockback", "pop", "shieldFrontCosine", "frontDamageMultiplier"],
  pounce: ["damage"],
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Fails loudly on a bad data file, same as the other tuning files. Builds fresh objects, so the result never
// shares anything with the raw file being tuned.
export function parseAbilities(raw: unknown): AbilitySet {
  const list = (raw as { mechs?: unknown })?.mechs;
  if (typeof list !== "object" || list === null || Array.isArray(list)) throw new Error("abilities.json: needs a mechs object keyed by roster id");
  const mechs: Record<string, AbilityStats> = {};
  for (const [id, entry] of Object.entries(list as Record<string, unknown>)) {
    const a = entry as Record<string, unknown> | null;
    if (a?.kind !== "ram" && a?.kind !== "pounce") throw new Error(`abilities.json: ${id} kind must be "ram" or "pounce"`);
    if (typeof a.name !== "string") throw new Error(`abilities.json: ${id} needs a name`);
    const stats: Record<string, unknown> = { kind: a.kind, name: a.name };
    for (const key of POSITIVE[a.kind]) {
      if (!finite(a[key]) || a[key] <= 0) throw new Error(`abilities.json: ${id} ${key} must be above 0`);
      stats[key] = a[key];
    }
    for (const key of NOT_NEGATIVE[a.kind]) {
      if (!finite(a[key]) || a[key] < 0) throw new Error(`abilities.json: ${id} ${key} must be 0 or more`);
      stats[key] = a[key];
    }
    mechs[id] = stats as unknown as AbilityStats;
  }
  return { mechs };
}

// Each roster mech's ability, or null. Looked up on every call rather than copied, so a tuned number (assigned
// into the set in place) reaches the next step at once.
export function abilityFor(set: AbilitySet, roster: Roster | null): (mech: number) => AbilityStats | null {
  if (!roster) return () => null;
  return (mech) => set.mechs[roster.mechs[rosterIndex(roster, mech)]!.id] ?? null;
}
