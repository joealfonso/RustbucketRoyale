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

export interface BarrageStats {
  kind: "barrage";
  name: string;
  cooldownSeconds: number;
  braceSeconds: number; // how long the mech stands planted after calling the strike in: no walking, jets or dash
  minRange: number; // an aim point nearer than this is pushed out to it, so the shells never land on your own feet
  maxRange: number; // and one farther away is pulled in to this
  delaySeconds: number; // how long the warning shows on the ground before the first shell lands
  shells: number; // a whole number
  shellSeconds: number; // between one shell and the next
  spreadMeters: number; // each shell lands within this distance of the target
  damage: number; // per shell
  blastRadius: number; // per shell
}

export interface DecoyStats {
  kind: "decoy";
  name: string;
  cooldownSeconds: number;
  count: number; // decoys sent out, a whole number
  lifeSeconds: number; // how long each runs before it fades
  spreadDegrees: number; // the decoys fan out up to this far either side of where the Arbiter aims
  stuckSpeed: number; // a decoy slower than this (m/s) is up against something; well under walking pace
  stuckSeconds: number; // that long stuck and it turns a quarter turn off the wall
}

export type AbilityStats = RamStats | PounceStats | BarrageStats | DecoyStats;

export interface AbilitySet {
  mechs: Record<string, AbilityStats>;
}

const POSITIVE: Record<AbilityStats["kind"], readonly string[]> = {
  ram: ["cooldownSeconds", "activeSeconds", "speed", "hitRadius"],
  pounce: ["cooldownSeconds", "speed", "lift", "maxRange", "slamRadius"],
  barrage: ["cooldownSeconds", "braceSeconds", "maxRange", "shells", "blastRadius"],
  decoy: ["cooldownSeconds", "count", "lifeSeconds", "stuckSpeed", "stuckSeconds"],
};
const NOT_NEGATIVE: Record<AbilityStats["kind"], readonly string[]> = {
  ram: ["damage", "knockback", "pop", "shieldFrontCosine", "frontDamageMultiplier"],
  pounce: ["damage"],
  barrage: ["minRange", "delaySeconds", "shellSeconds", "spreadMeters", "damage"],
  decoy: ["spreadDegrees"],
};
// Counts of things the server spawns, which a fraction of a thing cannot be.
const WHOLE: Partial<Record<AbilityStats["kind"], readonly string[]>> = {
  barrage: ["shells"],
  decoy: ["count"],
};
const KINDS = Object.keys(POSITIVE) as AbilityStats["kind"][];

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Fails loudly on a bad data file, same as the other tuning files. Builds fresh objects, so the result never
// shares anything with the raw file being tuned.
export function parseAbilities(raw: unknown): AbilitySet {
  const list = (raw as { mechs?: unknown })?.mechs;
  if (typeof list !== "object" || list === null || Array.isArray(list)) throw new Error("abilities.json: needs a mechs object keyed by roster id");
  const mechs: Record<string, AbilityStats> = {};
  for (const [id, entry] of Object.entries(list as Record<string, unknown>)) {
    const a = entry as Record<string, unknown> | null;
    const kind = a?.kind as AbilityStats["kind"];
    if (!a || !KINDS.includes(kind)) throw new Error(`abilities.json: ${id} kind must be one of ${KINDS.join(", ")}`);
    if (typeof a.name !== "string") throw new Error(`abilities.json: ${id} needs a name`);
    const stats: Record<string, unknown> = { kind, name: a.name };
    for (const key of POSITIVE[kind]) {
      if (!finite(a[key]) || a[key] <= 0) throw new Error(`abilities.json: ${id} ${key} must be above 0`);
      stats[key] = a[key];
    }
    for (const key of NOT_NEGATIVE[kind]) {
      if (!finite(a[key]) || a[key] < 0) throw new Error(`abilities.json: ${id} ${key} must be 0 or more`);
      stats[key] = a[key];
    }
    for (const key of WHOLE[kind] ?? []) {
      if (!Number.isInteger(a[key])) throw new Error(`abilities.json: ${id} ${key} must be a whole number`);
    }
    if (kind === "barrage" && (stats.minRange as number) >= (stats.maxRange as number)) throw new Error(`abilities.json: ${id} minRange must be below maxRange`);
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

// Where a mortar strike lands for an aim point, so the server's shells and the client's warning agree. Too near (or
// not a number, or right at the mech's feet, where there is no direction to speak of) goes out to minRange straight
// ahead; too far comes in to maxRange along the line to the aim point. Forward is the aim direction, unit length.
// Writes into `out` rather than returning a new object, since the server calls it in its step.
export function barrageTarget(
  x: number, z: number, targetX: number, targetZ: number, forwardX: number, forwardZ: number,
  stats: BarrageStats, out: { x: number; z: number },
): void {
  const toX = targetX - x, toZ = targetZ - z;
  const distance = Math.hypot(toX, toZ);
  if (!Number.isFinite(distance) || distance < stats.minRange) {
    out.x = x + forwardX * stats.minRange;
    out.z = z + forwardZ * stats.minRange;
  } else if (distance > stats.maxRange) {
    out.x = x + (toX / distance) * stats.maxRange;
    out.z = z + (toZ / distance) * stats.maxRange;
  } else {
    out.x = targetX;
    out.z = targetZ;
  }
}
