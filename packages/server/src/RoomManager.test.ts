import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Room, type MapForRoom, type RoomConfig } from "./Room";
import { RoomManager, type Ticket } from "./RoomManager";
import { lcg } from "./testClient";

const config = loadRoomConfig();
const manager = (max = 3) => new RoomManager((code, tier, bots) => new Room(code, tier, config, bots), ["small", "medium", "large"], "medium", max, lcg(3));
const quiet = (_: ServerMessage) => {};
const seat = (ticket: Ticket | null) => ticket!.joined!;

describe("RoomManager", () => {
  it("makes a room with a fresh code, and the same code finds the same room", () => {
    const m = manager();
    const first = seat(m.join(null, "small", quiet));
    expect(first.room.code).toMatch(/^[A-Z2-9]{4}$/);
    const again = seat(m.join(first.room.code.toLowerCase(), null, quiet));
    expect(again.room).toBe(first.room);
    expect(first.room.playerCount).toBe(2);
    expect(m.roomCount).toBe(1);
  });

  it("uses the tier of whoever made the room, and falls back to the default for nonsense", () => {
    const m = manager();
    expect(seat(m.join(null, "large", quiet)).room.tier).toBe("large");
    expect(seat(m.join(null, "huge", quiet)).room.tier).toBe("medium");
    expect(seat(m.join(null, null, quiet)).room.tier).toBe("medium");
  });

  it("opens a room under a code someone shares before it exists", () => {
    const m = manager();
    expect(seat(m.join("ABCD", "small", quiet)).room.code).toBe("ABCD");
  });

  it("refuses a bad code and a full server, with a reason", () => {
    const m = manager(1);
    const refused: ServerMessage[] = [];
    expect(m.join("no!", null, (x) => refused.push(x))).toBeNull();
    m.join(null, null, quiet);
    expect(m.join(null, null, (x) => refused.push(x))).toBeNull();
    expect(refused.map((r) => r.t)).toEqual(["refused", "refused"]);
  });

  it("removes a room when the last player leaves, so its code can be used again", () => {
    const m = manager();
    const ticket = m.join("WXYZ", null, quiet)!;
    m.leave(ticket);
    expect(m.roomCount).toBe(0);
    expect(seat(m.join("WXYZ", "small", quiet)).room.tier).toBe("small");
  });

  it("ticks every room", () => {
    const m = manager();
    const a = seat(m.join(null, "small", quiet));
    const received: string[] = [];
    m.join(a.room.code, null, (x) => received.push(x.t));
    for (let i = 0; i < 6; i++) m.tick();
    expect(received).toContain("snapshot");
  });
});

// Lobby maps that arrive when the test says so, standing in for the worker pool. `built` counts maps built on the
// calling thread by the rooms themselves.
function preparedRooms(max = 3) {
  const asked: { tier: string; seed: number; resolve: () => void; reject: (error: Error) => void }[] = [];
  let built = 0, made = 0;
  const counted: RoomConfig = { ...config, mapFor: (tier, seed) => { built++; return config.mapFor(tier, seed); } };
  const m = new RoomManager(
    (code, tier, bots, difficulty, lobby) => { made++; return new Room(code, tier, counted, bots, difficulty, lobby); },
    ["small", "medium", "large"], "medium", max, lcg(3),
    (tier, seed) => new Promise<MapForRoom>((resolve, reject) => {
      asked.push({ tier, seed, resolve: () => resolve(config.mapFor(tier, seed)), reject });
    }),
  );
  return { m, asked, built: () => built, made: () => made };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function listener() {
  const messages: ServerMessage[] = [];
  let refused = 0;
  return { messages, send: (x: ServerMessage) => messages.push(x), refusedLater: () => { refused++; }, refused: () => refused };
}

describe("RoomManager with lobby maps built elsewhere", () => {
  it("does not build a new room's map on the calling thread: the first player waits, then is welcomed", async () => {
    const { m, asked, built, made } = preparedRooms();
    const a = listener();
    const ticket = m.join("ROOM", "large", a.send, 0, "mixed", a.refusedLater)!;
    expect(ticket.joined).toBeNull();
    expect(a.messages).toHaveLength(0);
    expect(asked).toEqual([expect.objectContaining({ tier: "large" })]);
    expect(m.roomCount).toBe(1);
    m.tick(); // a preparing room has nothing to tick
    expect(built()).toBe(0);
    expect(made()).toBe(0);

    asked[0]!.resolve();
    await settle();
    expect(built()).toBe(0);
    expect(ticket.joined!.room.code).toBe("ROOM");
    expect(a.messages[0]).toMatchObject({ t: "welcome", code: "ROOM", tier: "large", seed: asked[0]!.seed });
  });

  it("seats everyone who asked for the code while it was being prepared, in order, in one room", async () => {
    const { m, asked } = preparedRooms();
    const people = [listener(), listener(), listener()];
    const tickets = people.map((p, i) => m.join(i === 0 ? "LINE" : "line", "small", p.send)!);
    expect(asked).toHaveLength(1);
    expect(m.roomCount).toBe(1);
    asked[0]!.resolve();
    await settle();
    const room = tickets[0]!.joined!.room;
    expect(tickets.map((t) => t.joined!.room)).toEqual([room, room, room]);
    expect(tickets.map((t) => t.joined!.id)).toEqual([...tickets.map((t) => t.joined!.id)].sort((x, y) => x - y));
    expect(room.playerCount).toBe(3);
    for (const p of people) expect(p.messages.some((x) => x.t === "welcome")).toBe(true);
    // Joining once it is open is immediate again.
    expect(m.join("LINE", null, quiet)!.joined!.room).toBe(room);
  });

  it("tries a new seed when a map fails, and refuses everyone waiting after a few failures", async () => {
    const { m, asked } = preparedRooms();
    const a = listener();
    const ticket = m.join("FAIL", "small", a.send, 0, "mixed", a.refusedLater)!;
    asked[0]!.reject(new Error("no valid map"));
    await settle();
    expect(asked).toHaveLength(2);
    expect(asked[1]!.seed).not.toBe(asked[0]!.seed);
    asked[1]!.resolve();
    await settle();
    expect(ticket.joined).not.toBeNull();

    const b = listener(), c = listener();
    m.join("GONE", "small", b.send, 0, "mixed", b.refusedLater);
    m.join("GONE", "small", c.send, 0, "mixed", c.refusedLater);
    for (let i = 2; i < 5; i++) {
      asked[i]!.reject(new Error("no valid map"));
      await settle();
    }
    expect(asked).toHaveLength(5);
    for (const p of [b, c]) {
      expect(p.messages).toEqual([expect.objectContaining({ t: "refused" })]);
      expect(p.refused()).toBe(1);
    }
    expect(m.roomCount).toBe(1); // FAIL is still open, GONE is gone
  });

  it("drops a room everyone left while it was being prepared, and throws its map away", async () => {
    const { m, asked, made } = preparedRooms();
    const a = m.join("EMPT", "small", quiet)!;
    const b = m.join("EMPT", "small", quiet)!;
    m.leave(a);
    expect(m.roomCount).toBe(1); // b still waits
    m.leave(b);
    expect(m.roomCount).toBe(0);
    asked[0]!.resolve();
    await settle();
    expect(made()).toBe(0);
    expect(m.roomCount).toBe(0);

    // The code is free again, and a new room under it prepares from scratch.
    const again = m.join("EMPT", "large", quiet)!;
    expect(asked).toHaveLength(2);
    asked[1]!.resolve();
    await settle();
    expect(again.joined!.room.tier).toBe("large");
  });

  it("counts rooms being prepared towards the limit", () => {
    const { m } = preparedRooms(1);
    m.join(null, "small", quiet);
    const refused: ServerMessage[] = [];
    expect(m.join(null, "small", (x) => refused.push(x))).toBeNull();
    expect(refused).toEqual([expect.objectContaining({ t: "refused" })]);
  });

  it("refuses waiters the room has no place for when it opens", async () => {
    const { m, asked } = preparedRooms();
    const people = Array.from({ length: config.net.maxPlayers + 1 }, () => listener());
    const tickets = people.map((p) => m.join("FULL", "small", p.send, 0, "mixed", p.refusedLater)!);
    asked[0]!.resolve();
    await settle();
    const last = people.at(-1)!;
    expect(tickets.at(-1)!.joined).toBeNull();
    expect(last.refused()).toBe(1);
    expect(last.messages).toEqual([expect.objectContaining({ t: "refused" })]);
    expect(tickets.filter((t) => t.joined).length).toBe(config.net.maxPlayers);
  });
});
