import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Room } from "./Room";
import { RoomManager } from "./RoomManager";
import { lcg } from "./testClient";

const config = loadRoomConfig();
const manager = (max = 3) => new RoomManager((code, tier, bots) => new Room(code, tier, config, bots), ["small", "medium", "large"], "medium", max, lcg(3));
const quiet = (_: ServerMessage) => {};

describe("RoomManager", () => {
  it("makes a room with a fresh code, and the same code finds the same room", () => {
    const m = manager();
    const first = m.join(null, "small", quiet)!;
    expect(first.room.code).toMatch(/^[A-Z2-9]{4}$/);
    const again = m.join(first.room.code.toLowerCase(), null, quiet)!;
    expect(again.room).toBe(first.room);
    expect(first.room.playerCount).toBe(2);
    expect(m.roomCount).toBe(1);
  });

  it("uses the tier of whoever made the room, and falls back to the default for nonsense", () => {
    const m = manager();
    expect(m.join(null, "large", quiet)!.room.tier).toBe("large");
    expect(m.join(null, "huge", quiet)!.room.tier).toBe("medium");
    expect(m.join(null, null, quiet)!.room.tier).toBe("medium");
  });

  it("opens a room under a code someone shares before it exists", () => {
    const m = manager();
    expect(m.join("ABCD", "small", quiet)!.room.code).toBe("ABCD");
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
    const joined = m.join("WXYZ", null, quiet)!;
    m.leave(joined);
    expect(m.roomCount).toBe(0);
    expect(m.join("WXYZ", "small", quiet)!.room.tier).toBe("small");
  });

  it("ticks every room", () => {
    const m = manager();
    const a = m.join(null, "small", quiet)!;
    const received: string[] = [];
    m.join(a.room.code, null, (x) => received.push(x.t));
    for (let i = 0; i < 6; i++) m.tick();
    expect(received).toContain("snapshot");
  });
});
