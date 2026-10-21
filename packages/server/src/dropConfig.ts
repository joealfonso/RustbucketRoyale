import { parseShipStats, type ShipStats } from "@rustbucket/shared";

// data/drop.json: how high each tier's drop-in starts, the Rustbucket's line, and how bots choose where to come down
// (botDrop.ts).
export interface DropBotStats {
  ringMarginMeters: number; // landing spots stay this far inside the first ring circle
  reachShare: number; // share of the level-glide reach a bot trusts itself to cover, so it does not fall short
  tries: number; // spots tried before taking the best
  hotDropChance: number; // chance a bot dives on purpose at a spot another mech chose
  hotDropMeters: number; // how close to that spot it aims
  spreadMeters: number; // further than this from every other chosen spot counts as fully spread out
  lootWeight: number; // what being near a building or crate is worth against being spread out (which is worth up to 1)
  nearMeters: number; // a building, crate or barrel this close makes a spot worth landing at
  clearMeters: number; // nothing standing this close, so the spot is open ground
  holdBackMeters: number; // nearer than this the bot holds back (S) to stop overshooting
  lastChanceSeconds: number; // a bot still aboard this long before the end of the line fires itself out anyway
}

export interface DropConfig {
  altitudeMeters: Record<string, number>; // per tier, above the ground at the spawn
  bots: DropBotStats;
  ship: ShipStats; // the Rustbucket's line (shared shipPath.ts)
}

const BOT_KEYS: (keyof DropBotStats)[] = [
  "ringMarginMeters", "reachShare", "tries", "hotDropChance", "hotDropMeters", "spreadMeters", "lootWeight", "nearMeters", "clearMeters", "holdBackMeters", "lastChanceSeconds",
];

export function parseDropConfig(raw: unknown): DropConfig {
  const d = raw as Record<string, unknown>;
  const altitudes = d?.altitudeMeters as Record<string, unknown> | undefined;
  if (!altitudes || typeof altitudes !== "object") throw new Error("drop.json: needs altitudeMeters");
  for (const [tier, value] of Object.entries(altitudes)) {
    if (typeof value !== "number" || !(value > 0)) throw new Error(`drop.json: altitudeMeters.${tier} must be a number above 0`);
  }
  const bots = d.bots as Record<string, unknown> | undefined;
  for (const key of BOT_KEYS) {
    const value = bots?.[key];
    if (typeof value !== "number" || !(value >= 0)) throw new Error(`drop.json: bots.${key} must be a number, 0 or more`);
  }
  for (const key of ["reachShare", "hotDropChance"] as const) {
    if ((bots![key] as number) > 1) throw new Error(`drop.json: bots.${key} must be from 0 to 1`);
  }
  if (!Number.isInteger(bots!.tries) || (bots!.tries as number) < 1) throw new Error("drop.json: bots.tries must be a whole number, 1 or more");
  return { altitudeMeters: altitudes as Record<string, number>, bots: bots as unknown as DropBotStats, ship: parseShipStats(d.ship, Object.keys(altitudes)) };
}
