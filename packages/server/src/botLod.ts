import type { BotConfig, BotLodStats } from "@rustbucket/shared";

// Which difficulty a new bot gets, by the mix in the data file. `roll` is a number from 0 up to but not including 1.
export function pickDifficulty(config: BotConfig, roll: number): string {
  const names = Object.keys(config.mix);
  const total = names.reduce((sum, n) => sum + config.mix[n]!, 0);
  let left = roll * total;
  for (const name of names) {
    left -= config.mix[name]!;
    if (left < 0) return name;
  }
  return names[names.length - 1] ?? "normal";
}

export const RATINGS: Record<string, number> = { easy: 1, normal: 2, hard: 3 };

// How many bots a room needs to be topped up to its target size. People count towards the target,
// and the map only has so many spawns to go round.
export function botsNeeded(target: number, humans: number, spawnCount: number): number {
  return Math.max(0, Math.min(target - humans, spawnCount - humans));
}

export interface FarBot {
  id: number;
  x: number;
  z: number;
  rating: number;
}

export interface FightResult {
  winnerId: number;
  loserId: number;
}

// Fights between two bots that are too far from anyone to be worth simulating shot by shot.
// Two bots close together for long enough fight on paper: the stronger tends to win, but not always.
export class AbstractFights {
  private clocks = new Map<number, number>();

  update(bots: readonly FarBot[], dtSeconds: number, lod: BotLodStats, random: () => number): FightResult[] {
    const results: FightResult[] = [];
    const seen = new Set<number>();

    for (let i = 0; i < bots.length; i++) {
      for (let j = i + 1; j < bots.length; j++) {
        const a = bots[i]!, b = bots[j]!;
        if (Math.hypot(a.x - b.x, a.z - b.z) > lod.abstractFightRange) continue;
        const key = Math.min(a.id, b.id) * 65536 + Math.max(a.id, b.id);
        seen.add(key);
        const time = (this.clocks.get(key) ?? 0) + dtSeconds;
        if (time < lod.abstractFightSeconds) { this.clocks.set(key, time); continue; }
        this.clocks.set(key, 0);
        const aWins = random() * (a.rating + b.rating) < a.rating;
        results.push(aWins ? { winnerId: a.id, loserId: b.id } : { winnerId: b.id, loserId: a.id });
      }
    }
    // A pair that came apart starts from nothing next time.
    for (const key of this.clocks.keys()) if (!seen.has(key)) this.clocks.delete(key);
    return results;
  }
}
