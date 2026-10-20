import type { MatchStat, MatchStatKind } from "@rustbucket/shared";

// One player's fun numbers for the current match, one per stat the results screen can show. Counts, except the two
// longest ones, which are metres. `mostDamage` is the damage this player dealt to other mechs,
// `titanDamage` the damage they dealt to the Junk Titan.
export type Tally = Record<MatchStatKind, number>;

// Most fun first: long shots and leaps make the best clips, then fighting the Junk Titan, then the mess left behind,
// then plain damage.
const ORDER: readonly MatchStatKind[] = ["longestRailShot", "longestPounce", "titanDamage", "treesFelled", "barrelsSetOff", "propsSmashed", "mostDamage"];
const DISTANCES: ReadonlySet<MatchStatKind> = new Set(["longestRailShot", "longestPounce"]);
// Joseph asked for two or three on the results screen, so a fourth would only be cut by the client.
const MAX_STATS = 3;

export function createTally(): Tally {
  return { longestRailShot: 0, longestPounce: 0, treesFelled: 0, barrelsSetOff: 0, propsSmashed: 0, mostDamage: 0, titanDamage: 0 };
}

export function clearTally(tally: Tally): void {
  for (const kind of ORDER) tally[kind] = 0;
}

export function noteLongest(tally: Tally, kind: "longestRailShot" | "longestPounce", meters: number): void {
  if (meters > tally[kind]) tally[kind] = meters;
}

// The best player at each stat someone actually scored, in the order above, up to MAX_STATS. A tie goes to whoever
// comes first in the list.
export function topStats(players: readonly { id: number; tally: Tally }[]): MatchStat[] {
  const stats: MatchStat[] = [];
  for (const kind of ORDER) {
    if (stats.length >= MAX_STATS) break;
    let best: { id: number; tally: Tally } | null = null;
    for (const p of players) if (p.tally[kind] > 0 && (!best || p.tally[kind] > best.tally[kind])) best = p;
    if (!best) continue;
    const value = best.tally[kind];
    stats.push({ kind, playerId: best.id, value: DISTANCES.has(kind) ? Math.round(value * 10) / 10 : Math.round(value) });
  }
  return stats;
}
