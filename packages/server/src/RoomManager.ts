import type { ServerMessage } from "@rustbucket/shared";
import { Room } from "./Room";

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1: they are easy to misread out loud
const CODE_PATTERN = /^[A-Z0-9]{4}$/;

export interface Joined {
  room: Room;
  id: number;
}

// Many rooms in one server process. A room is made the first time its code is used, and goes away when the
// last player leaves. Scaling means more rooms and more processes, never a bigger room.
export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private makeRoom: (code: string, tier: string, bots: number | null) => Room,
    private tiers: readonly string[],
    private defaultTier: string,
    private maxRooms: number,
    private random: () => number = Math.random,
  ) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  // `code` null means make a new room with a fresh code. The tier and bot count only matter for a room that does not exist yet.
  join(code: string | null, tier: string | null, send: (message: ServerMessage) => void, bots: number | null = 0): Joined | null {
    const wanted = code?.toUpperCase() ?? null;
    if (wanted !== null && !CODE_PATTERN.test(wanted)) {
      send({ t: "refused", reason: "That room code does not look right." });
      return null;
    }

    let room = wanted ? this.rooms.get(wanted) : undefined;
    if (!room) {
      if (this.rooms.size >= this.maxRooms) {
        send({ t: "refused", reason: "The server is full right now. Try again in a minute." });
        return null;
      }
      const chosenTier = tier && this.tiers.includes(tier) ? tier : this.defaultTier;
      const newCode = wanted ?? this.freshCode();
      room = this.makeRoom(newCode, chosenTier, bots);
      this.rooms.set(newCode, room);
    }

    const id = room.join(send);
    if (id === null) return null; // the room refused and said why
    return { room, id };
  }

  leave(joined: Joined): void {
    joined.room.leave(joined.id);
    if (joined.room.playerCount === 0) this.rooms.delete(joined.room.code);
  }

  tick(): void {
    for (const room of this.rooms.values()) room.tick();
  }

  private freshCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(this.random() * CODE_LETTERS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}
