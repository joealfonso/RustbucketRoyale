// When a bot uses its mech's Q ability in a fight (the "abilities" block of data/bots.json). One block for every
// difficulty: how often a bot uses it is not what makes a hard bot hard, its aim is. Read here rather than with the
// rest of bots.json because the shared bot parser only knows the blocks the client needs too.
export interface BotAbilityStats {
  ramChancePerSecond: number; // once a target is lined up and in range
  ramMaxAngleDegrees: number; // how far off straight ahead the target may be
  ramMinRange: number;
  ramMaxRange: number;
  pounceChancePerSecond: number;
  pounceMinRange: number;
  pounceMaxRange: number;
  barrageChancePerSecond: number; // once a target is between the two ranges below
  barrageMinRange: number;
  barrageMaxRange: number;
  decoyChancePerSecond: number; // while hurt lately, or with a target within decoyNearRange
  decoyHurtSeconds: number; // how long after a hit a bot still feels under fire
  decoyNearRange: number;
  railChancePerSecond: number; // a Longshot with a target between the two ranges below starts a Rail Shot
  railMinRange: number;
  railMaxRange: number;
}

const KEYS: readonly (keyof BotAbilityStats)[] = [
  "ramChancePerSecond", "ramMaxAngleDegrees", "ramMinRange", "ramMaxRange", "pounceChancePerSecond", "pounceMinRange", "pounceMaxRange",
  "barrageChancePerSecond", "barrageMinRange", "barrageMaxRange", "decoyChancePerSecond", "decoyHurtSeconds", "decoyNearRange",
  "railChancePerSecond", "railMinRange", "railMaxRange",
];

// Fails loudly on a bad data file, same as the other tuning files.
export function parseBotAbilities(rawBots: unknown): BotAbilityStats {
  const block = (rawBots as { abilities?: unknown })?.abilities;
  if (typeof block !== "object" || block === null) throw new Error("bots.json: needs an abilities object");
  const record = block as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of KEYS) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`bots.json: abilities.${key} must be 0 or more`);
    out[key] = value;
  }
  const stats = out as unknown as BotAbilityStats;
  if (stats.ramMinRange > stats.ramMaxRange) throw new Error("bots.json: abilities.ramMinRange is past ramMaxRange");
  if (stats.pounceMinRange > stats.pounceMaxRange) throw new Error("bots.json: abilities.pounceMinRange is past pounceMaxRange");
  if (stats.barrageMinRange > stats.barrageMaxRange) throw new Error("bots.json: abilities.barrageMinRange is past barrageMaxRange");
  if (stats.railMinRange > stats.railMaxRange) throw new Error("bots.json: abilities.railMinRange is past railMaxRange");
  return stats;
}
