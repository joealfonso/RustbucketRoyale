export type MatchState = "lobby" | "countdown" | "active" | "results";

export interface MatchConfig {
  countdownSeconds: number;
  resultsSeconds: number;
  matchSeconds: number;
  autoNextMatch: number; // 1: a new match starts after the results with no clicks, 0: back to the lobby
}

export function parseMatchConfig(raw: unknown): MatchConfig {
  const d = raw as Record<string, unknown>;
  for (const key of ["countdownSeconds", "resultsSeconds", "matchSeconds", "autoNextMatch"]) {
    if (typeof d?.[key] !== "number" || !Number.isFinite(d[key])) throw new Error(`match.json: ${key} must be a number`);
  }
  return d as unknown as MatchConfig;
}
