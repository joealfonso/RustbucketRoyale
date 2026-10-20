import { parseBotDifficulty, type BotDifficulty } from "@rustbucket/shared";

// The page's own address is how a room is chosen, made and come back to (see main.ts). These build those addresses,
// so the room's settings travel the whole way: title screen, server connection, and the address a reload rejoins.

export interface RoomChoice {
  tier: string;
  bots: string; // "" fills the room to the tier size, otherwise a count
  difficulty: BotDifficulty;
}

// The title screen's Create room link.
export function createRoomSearch(choice: RoomChoice): string {
  const query = new URLSearchParams({ tier: choice.tier });
  if (choice.bots !== "") query.set("bots", choice.bots);
  query.set("difficulty", choice.difficulty);
  return `?create&${query}`;
}

// The title screen's Play: a small yard filled with bots of normal skill, started by the first click into the game.
export function playSearch(): string {
  return `?create&tier=small&difficulty=normal&play`;
}

// What the game server is told when connecting. It reads only these, and ignores them for a room that already exists.
export function serverQuery(params: URLSearchParams): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ["room", "tier", "bots"]) if (params.get(key)) query.set(key, params.get(key)!);
  if (params.has("difficulty")) query.set("difficulty", parseBotDifficulty(params.get("difficulty")));
  return query;
}

// The address once you are in a room: reloading rejoins it, and if the server restarted it comes back the same way.
export function rejoinQuery(params: URLSearchParams, roomCode: string, tier: string): URLSearchParams {
  const again = new URLSearchParams({ room: roomCode, tier });
  for (const key of ["bots", "difficulty", "kit"]) if (params.has(key)) again.set(key, params.get(key)!);
  return again;
}
