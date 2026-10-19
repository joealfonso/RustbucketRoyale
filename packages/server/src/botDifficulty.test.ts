import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { BotDifficulty, ServerMessage } from "@rustbucket/shared";
import { RATINGS } from "./botLod";
import { loadRoomConfig } from "./config";
import { Room } from "./Room";
import { RoomManager } from "./RoomManager";
import { lcg } from "./testClient";
import { startServer, type RunningServer } from "./transport";

const config = loadRoomConfig();
const quiet = (_: ServerMessage) => {};
const ratings = (room: Room) => room.inspect().filter((p) => p.bot).map((p) => p.rating);
const roomWith = (difficulty: BotDifficulty) => new Room("TEST", "small", { ...config, random: lcg(7) }, 10, difficulty);

describe("a room's bot difficulty", () => {
  it("makes every bot hard in a hard room, and keeps doing so as bots are added", () => {
    const room = roomWith("hard");
    expect(ratings(room)).toHaveLength(10);
    expect(ratings(room).every((r) => r === RATINGS.hard)).toBe(true);
    const person = room.join(quiet)!;
    room.leave(person); // a bot comes back to fill the place
    expect(ratings(room).every((r) => r === RATINGS.hard)).toBe(true);
  });

  it("makes every bot easy in an easy room", () => {
    expect(ratings(roomWith("easy")).every((r) => r === RATINGS.easy)).toBe(true);
  });

  it("deals a mix by the data file in a mixed room", () => {
    expect(new Set(ratings(roomWith("mixed"))).size).toBeGreaterThan(1);
  });

  it("is mixed for a room made without saying", () => {
    expect(new Room("TEST", "small", config, 0).difficulty).toBe("mixed");
  });

  it("is set by whoever makes the room, and joining by code never changes it", () => {
    const manager = new RoomManager((code, tier, bots, difficulty) => new Room(code, tier, config, bots, difficulty), ["small"], "small", 3, lcg(3));
    const made = manager.join(null, "small", quiet, 0, "hard")!.joined!;
    expect(made.room.difficulty).toBe("hard");
    const joined = manager.join(made.room.code, null, quiet, 0, "easy")!.joined!;
    expect(joined.room).toBe(made.room);
    expect(made.room.difficulty).toBe("hard");
  });
});

describe("bot difficulty in the room link", () => {
  let server: RunningServer | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });

  // Connects with `query` and returns the first room message, which carries the difficulty to everyone in the room.
  async function roomMessage(query: string): Promise<{ message: Extract<ServerMessage, { t: "room" }>; room: Room }> {
    let made: Room | null = null;
    const manager = new RoomManager((code, tier, bots, difficulty) => (made = new Room(code, tier, config, bots, difficulty)), ["small"], "small", 5);
    server = await startServer(manager, 0);
    const socket = new WebSocket(`ws://localhost:${server.port}/${query}`);
    const message = await new Promise<Extract<ServerMessage, { t: "room" }>>((resolve) => {
      socket.on("message", (data, isBinary) => {
        if (isBinary) return; // room messages are text
        const m = JSON.parse(data.toString()) as ServerMessage;
        if (m.t === "room") resolve(m);
      });
    });
    socket.close();
    return { message, room: made! };
  }

  it("makes a hard room from difficulty=hard and tells the players", async () => {
    const { message, room } = await roomMessage("?tier=small&bots=6&difficulty=hard");
    expect(message.difficulty).toBe("hard");
    expect(ratings(room).every((r) => r === RATINGS.hard)).toBe(true);
  });

  it("makes a mixed room from a value it does not know", async () => {
    const { message, room } = await roomMessage("?tier=small&bots=6&difficulty=insane");
    expect(message.difficulty).toBe("mixed");
    expect(room.difficulty).toBe("mixed");
  });
});
