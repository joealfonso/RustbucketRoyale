// How hard a room's bots are, chosen on the title screen and carried in the room link as `difficulty=`.
// The three fixed ones name difficulties in data/bots.json; "mixed" deals each bot one by the mix in that file.
export const BOT_DIFFICULTIES = ["easy", "normal", "hard", "mixed"] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

// Anything else in a link (a typo, an old link, someone poking at it) gets the mix, which is what rooms did before.
export function parseBotDifficulty(raw: string | null | undefined): BotDifficulty {
  const wanted = raw?.trim().toLowerCase();
  return BOT_DIFFICULTIES.find((d) => d === wanted) ?? "mixed";
}
