import { parseBotDifficulty, type BotDifficulty } from "@rustbucket/shared";

const STORE_KEY = "rustbucket.difficulty";

// The bot difficulty last picked on the title screen, remembered in this browser. Normal when nothing is saved,
// because that is what Play used before there was a choice.
export function savedDifficulty(): BotDifficulty {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch { /* storage can be blocked */ }
  return raw === null ? "normal" : parseBotDifficulty(raw);
}

export function rememberDifficulty(difficulty: BotDifficulty): void {
  try { localStorage.setItem(STORE_KEY, difficulty); } catch { /* blocked storage only costs the memory */ }
}
