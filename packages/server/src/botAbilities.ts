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
  railDodgeChance: number; // share of the lasers aimed at it that a bot notices and runs from, 0 to 1
  railLaserWidth: number; // metres either side of a laser's line that count as being under it
  secondary: BotSecondaryStats; // the "secondaries" block beside it in bots.json
}

// When a bot uses its gun's right-click (gate 18a), from the "secondaries" block of data/bots.json. Read with the
// abilities so it rides the same plumbing and live tuning. One block for every difficulty, like the abilities.
export interface BotSecondaryStats {
  slugMinRange: number; // a scattergun fires slugs at targets at least this far off, pellets nearer
  windupMaxRange: number; // an autocannon spins up on targets this close, in a sustained fight
  windupHeatLimit: number; // ...and lets go of the right button at this much heat, before it overheats...
  windupResumeHeat: number; // ...until it has cooled to this
  chargeMinRange: number; // a spike driver charges up on targets this far off...
  chargeStillSpeed: number; // ...or on any target moving slower than this, in m/s
  chargeChancePerSecond: number; // once one of those holds and the bot is lined up
}

const SECONDARY_KEYS: readonly (keyof BotSecondaryStats)[] = [
  "slugMinRange", "windupMaxRange", "windupHeatLimit", "windupResumeHeat", "chargeMinRange", "chargeStillSpeed", "chargeChancePerSecond",
];

const KEYS: readonly (keyof Omit<BotAbilityStats, "secondary">)[] = [
  "ramChancePerSecond", "ramMaxAngleDegrees", "ramMinRange", "ramMaxRange", "pounceChancePerSecond", "pounceMinRange", "pounceMaxRange",
  "barrageChancePerSecond", "barrageMinRange", "barrageMaxRange", "decoyChancePerSecond", "decoyHurtSeconds", "decoyNearRange",
  "railChancePerSecond", "railMinRange", "railMaxRange", "railDodgeChance", "railLaserWidth",
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
  const secondaryBlock = (rawBots as { secondaries?: unknown })?.secondaries;
  if (typeof secondaryBlock !== "object" || secondaryBlock === null) throw new Error("bots.json: needs a secondaries object");
  const secondary: Record<string, number> = {};
  for (const key of SECONDARY_KEYS) {
    const value = (secondaryBlock as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`bots.json: secondaries.${key} must be 0 or more`);
    secondary[key] = value;
  }
  const stats = { ...out, secondary } as unknown as BotAbilityStats;
  if (stats.secondary.windupResumeHeat > stats.secondary.windupHeatLimit) throw new Error("bots.json: secondaries.windupResumeHeat is past windupHeatLimit");
  if (stats.ramMinRange > stats.ramMaxRange) throw new Error("bots.json: abilities.ramMinRange is past ramMaxRange");
  if (stats.pounceMinRange > stats.pounceMaxRange) throw new Error("bots.json: abilities.pounceMinRange is past pounceMaxRange");
  if (stats.barrageMinRange > stats.barrageMaxRange) throw new Error("bots.json: abilities.barrageMinRange is past barrageMaxRange");
  if (stats.railMinRange > stats.railMaxRange) throw new Error("bots.json: abilities.railMinRange is past railMaxRange");
  return stats;
}
