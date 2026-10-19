import type { BotDifficulty, ServerMessage } from "@rustbucket/shared";
import type { MapForRoom, Room, SeededMap } from "./Room";

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1: they are easy to misread out loud
const CODE_PATTERN = /^[A-Z0-9]{4}$/;
const MAP_TRIES = 3; // a seed with no valid map is rare, so three in a row means something is wrong, not unlucky

export interface Joined {
  room: Room;
  id: number;
}

// A place in a room. `joined` stays null while the room's lobby map is being built, and is filled in when it opens.
export interface Ticket {
  code: string;
  joined: Joined | null;
}

interface Waiter {
  ticket: Ticket;
  send: (message: ServerMessage) => void;
  refusedLater: () => void;
}

// A room whose lobby map is being built on a worker. It counts as a room (its code is taken, it counts towards the
// limit), and everyone who asks for its code waits in its line until it opens.
interface Preparing {
  tier: string;
  bots: number | null;
  difficulty: BotDifficulty;
  tries: number;
  line: Waiter[];
}

// Many rooms in one server process. A room is made the first time its code is used, and goes away when the
// last player leaves. Scaling means more rooms and more processes, never a bigger room.
// With `lobbyMap` (the real server's map workers) a new room is prepared off the main thread: building a large map
// takes about 200 ms, which would stall every other room in the process. Without it (tests, MAP_WORKERS=0) the room
// is made on the spot and its first player joins at once.
export class RoomManager {
  private rooms = new Map<string, Room>();
  private preparing = new Map<string, Preparing>();

  constructor(
    private makeRoom: (code: string, tier: string, bots: number | null, difficulty: BotDifficulty, lobby?: SeededMap) => Room,
    private tiers: readonly string[],
    private defaultTier: string,
    private maxRooms: number,
    private random: () => number = Math.random,
    private lobbyMap?: (tier: string, seed: number) => Promise<MapForRoom>,
  ) {}

  get roomCount(): number {
    return this.rooms.size + this.preparing.size;
  }

  // `code` null means make a new room with a fresh code. The tier, bot count and difficulty only matter for a room
  // that does not exist yet: joining someone's room never changes it.
  // Returns null when refused at once (after sending why). A ticket whose room is still being prepared may be refused
  // later: it is sent why, then `refusedLater` is called.
  join(
    code: string | null, tier: string | null, send: (message: ServerMessage) => void, bots: number | null = 0, difficulty: BotDifficulty = "mixed",
    refusedLater: () => void = () => {},
  ): Ticket | null {
    const wanted = code?.toUpperCase() ?? null;
    if (wanted !== null && !CODE_PATTERN.test(wanted)) {
      send({ t: "refused", reason: "That room code does not look right." });
      return null;
    }

    let room = wanted ? this.rooms.get(wanted) : undefined;
    if (!room) {
      const preparing = wanted ? this.preparing.get(wanted) : undefined;
      if (preparing) return this.queue(wanted!, preparing, send, refusedLater);
      if (this.roomCount >= this.maxRooms) {
        send({ t: "refused", reason: "The server is full right now. Try again in a minute." });
        return null;
      }
      const chosenTier = tier && this.tiers.includes(tier) ? tier : this.defaultTier;
      const newCode = wanted ?? this.freshCode();
      if (this.lobbyMap) {
        const entry: Preparing = { tier: chosenTier, bots, difficulty, tries: 0, line: [] };
        this.preparing.set(newCode, entry);
        this.prepare(newCode, entry);
        return this.queue(newCode, entry, send, refusedLater);
      }
      room = this.makeRoom(newCode, chosenTier, bots, difficulty);
      this.rooms.set(newCode, room);
    }

    const id = room.join(send);
    if (id === null) return null; // the room refused and said why
    return { code: room.code, joined: { room, id } };
  }

  leave(ticket: Ticket): void {
    const { joined } = ticket;
    if (joined) {
      joined.room.leave(joined.id);
      if (joined.room.playerCount === 0) this.rooms.delete(joined.room.code);
      return;
    }
    // Gave up waiting. A room nobody is waiting for is dropped, and its map is thrown away when it arrives.
    const entry = this.preparing.get(ticket.code);
    if (!entry) return;
    entry.line = entry.line.filter((w) => w.ticket !== ticket);
    if (entry.line.length === 0) this.preparing.delete(ticket.code);
  }

  tick(): void {
    for (const room of this.rooms.values()) room.tick();
  }

  private queue(code: string, entry: Preparing, send: (message: ServerMessage) => void, refusedLater: () => void): Ticket {
    const ticket: Ticket = { code, joined: null };
    entry.line.push({ ticket, send, refusedLater });
    return ticket;
  }

  private prepare(code: string, entry: Preparing): void {
    const seed = Math.floor(this.random() * 0x100000000);
    this.lobbyMap!(entry.tier, seed).then(
      (map) => this.open(code, entry, { seed, map }),
      (error: unknown) => this.failed(code, entry, seed, error),
    );
  }

  // The map is here: make the room and seat everyone waiting, in the order they arrived.
  private open(code: string, entry: Preparing, lobby: SeededMap): void {
    if (this.preparing.get(code) !== entry) return; // everyone left while it was being built
    this.preparing.delete(code);
    const room = this.makeRoom(code, entry.tier, entry.bots, entry.difficulty, lobby);
    this.rooms.set(code, room);
    for (const waiter of entry.line) {
      const id = room.join(waiter.send);
      if (id === null) waiter.refusedLater(); // the room is full, and said so
      else waiter.ticket.joined = { room, id };
    }
    if (room.playerCount === 0) this.rooms.delete(code);
  }

  // A seed with no valid map, or a crashed worker: try another seed, and give up after a few.
  private failed(code: string, entry: Preparing, seed: number, error: unknown): void {
    console.error(`Room ${code}: lobby map for seed ${seed} failed: ${error instanceof Error ? error.message : String(error)}`);
    if (this.preparing.get(code) !== entry) return;
    entry.tries++;
    if (entry.tries < MAP_TRIES) {
      this.prepare(code, entry);
      return;
    }
    this.preparing.delete(code);
    for (const waiter of entry.line) {
      waiter.send({ t: "refused", reason: "This room's map could not be built. Try again." });
      waiter.refusedLater();
    }
  }

  private freshCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(this.random() * CODE_LETTERS.length)];
      if (!this.rooms.has(code) && !this.preparing.has(code)) return code;
    }
  }
}
