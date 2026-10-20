import { describe, expect, it } from "vitest";
import { ITEM_UPGRADE_FIRST, STEP, createRingNow, isDestroyed, makeRingSchedule, navCell, raised, ringAt, type PickupState, type ServerMessage, type SupplyDrop } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import type { Player } from "./Player";
import type { Room, RoomConfig } from "./Room";
import { planDrops } from "./supplyDrops";
import { Client, lcg, makeRoom, startMatch, tickRoom } from "./testClient";

const generated = loadRoomConfig({ maps: "generated" });

describe("supply drop planning", () => {
  it("lands every drop on open dry ground inside the ring as it will be when it lands", () => {
    for (const tier of ["small", "medium"]) {
      for (let seed = 1; seed <= 4; seed++) {
        const map = generated.mapFor(tier, seed);
        const random = lcg(seed);
        const ring = makeRingSchedule(generated.ring, tier, map.meters, random);
        const drops = planDrops(generated.drops, tier, ring, map, random);
        expect(drops.length).toBe(generated.drops.landSeconds[tier]!.length);
        const circle = createRingNow();
        for (const d of drops) {
          ringAt(ring, d.landAt, circle);
          expect(Math.hypot(d.x - circle.cx, d.z - circle.cz)).toBeLessThanOrEqual(circle.radius * generated.drops.placeShareOfRing + 1e-6);
          expect(raised(map.nav, navCell(map.nav, d.x, d.z))).toBeLessThan(0.05);
          expect(map.world.terrain?.waterDepthAt(d.x, d.z) ?? 0).toBe(0);
        }
      }
    }
  });
});

describe("supply drops in a room", () => {
  // Lands 25 s into the match, before the small ring has closed on anyone.
  const soon = (c: RoomConfig): RoomConfig => ({ ...c, mapFor: generated.mapFor, drops: { ...c.drops, landSeconds: { small: [25] } } });
  const players = (room: Room) => (room as unknown as { players: Map<number, Player> }).players;
  const pickupsNear = (room: Room, d: SupplyDrop) => (room as unknown as { pickups: { near(x: number, z: number, r: number, out: PickupState[]): PickupState[] } }).pickups.near(d.x, d.z, 10, []);

  it("is sent with the ring, flattens whoever stands under it, then spills its loot", () => {
    const { room, config } = makeRoom(soon);
    const a = new Client(room, { ...config });
    startMatch(room, a);
    const rooms = a.messages.filter((m): m is Extract<ServerMessage, { t: "room" }> => m.t === "room");
    const drop = rooms.at(-1)!.drops![0]!;
    expect(drop.landAt).toBe(25);

    const me = players(room).get(a.id)!;
    tickRoom(room, Math.round(24 / STEP)); // startMatch already ran a few ticks of the match
    me.state.x = drop.x; me.state.y = drop.y; me.state.z = drop.z;
    const before = me.hp.reduce((s, h) => s + h, 0);
    tickRoom(room, Math.round(1.5 / STEP));
    expect(me.hp.reduce((s, h) => s + h, 0) < before || isDestroyed(me.hp)).toBe(true);
    expect(pickupsNear(room, drop)).toEqual([]); // still sealed

    tickRoom(room, Math.round((config.drops.openSeconds + 0.2) / STEP));
    const spilled = pickupsNear(room, drop);
    expect(spilled.length).toBe(config.drops.contents.length);
    expect(spilled.filter((p) => p.item >= ITEM_UPGRADE_FIRST).length).toBe(config.drops.contents.filter((c) => c === "upgrade").length);
  });
});
