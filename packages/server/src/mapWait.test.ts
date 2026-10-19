import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@rustbucket/shared";
import type { MapForRoom, RoomConfig } from "./Room";
import { Client, makeRoom, tickRoom } from "./testClient";

// Maps that arrive when the test says so, standing in for the worker pool.
function laterMaps() {
  const asked: { seed: number; resolve: () => void; reject: (error: Error) => void }[] = [];
  let builtOnTheSpot = 0;
  const patch = (c: RoomConfig): RoomConfig => ({
    ...c,
    mapFor: (tier, seed) => { builtOnTheSpot++; return c.mapFor(tier, seed); },
    mapLater: (tier, seed) => new Promise<MapForRoom>((resolve, reject) => {
      asked.push({ seed, resolve: () => resolve(c.mapFor(tier, seed)), reject });
    }),
  });
  return { asked, patch, builtOnTheSpot: () => builtOnTheSpot };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastRoom = (c: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "room" }> => m.t === "room").at(-1)!;
const start = (c: Client) => c.room.receive(c.id, JSON.stringify({ t: "start" }));

describe("a room waiting for its next map", () => {
  it("asks for the first match's map when it opens, and starts at once when it is there", async () => {
    const maps = laterMaps();
    const { room } = makeRoom(maps.patch);
    expect(maps.asked).toHaveLength(1);
    maps.asked[0]!.resolve();
    await settle();
    expect(room.nextMapReady).toBe(true);

    const host = new Client(room);
    start(host);
    expect(room.matchState).toBe("countdown");
    expect(lastRoom(host).seed).toBe(maps.asked[0]!.seed);
    expect(room.nextMapReady).toBe(false);
  });

  it("holds the start until the map arrives, and never builds one on the tick", async () => {
    const maps = laterMaps();
    const { room } = makeRoom(maps.patch);
    const builtAtOpening = maps.builtOnTheSpot();
    const host = new Client(room);
    start(host);
    tickRoom(room, 30);
    expect(room.matchState).toBe("lobby");

    maps.asked[0]!.resolve();
    await settle();
    tickRoom(room, 1);
    expect(room.matchState).toBe("countdown");
    expect(maps.builtOnTheSpot()).toBe(builtAtOpening);
  });

  it("asks for the next map when results begin, and keeps showing results until it is there", async () => {
    const maps = laterMaps();
    const { room } = makeRoom(maps.patch);
    maps.asked[0]!.resolve();
    await settle();
    const host = new Client(room);
    const guest = new Client(room);
    start(host);
    tickRoom(room, 20);
    expect(room.matchState).toBe("active");

    room.leave(guest.id); // the host is the last one standing
    expect(room.matchState).toBe("results");
    expect(maps.asked).toHaveLength(2);
    tickRoom(room, 120); // well past the short test results
    expect(room.matchState).toBe("results");

    maps.asked[1]!.resolve();
    await settle();
    tickRoom(room, 1);
    expect(room.matchState).toBe("countdown");
    expect(lastRoom(host).seed).toBe(maps.asked[1]!.seed);
  });

  it("tries again with a new seed when a map cannot be built", async () => {
    const maps = laterMaps();
    const { room } = makeRoom(maps.patch);
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      maps.asked[0]!.reject(new Error("no valid map"));
      await settle();
    } finally {
      console.error = log;
    }
    expect(errors).toHaveLength(1);

    const host = new Client(room);
    start(host);
    expect(room.matchState).toBe("lobby");
    expect(maps.asked).toHaveLength(2);
    expect(maps.asked[1]!.seed).not.toBe(maps.asked[0]!.seed);
    maps.asked[1]!.resolve();
    await settle();
    tickRoom(room, 1);
    expect(room.matchState).toBe("countdown");
  });
});
