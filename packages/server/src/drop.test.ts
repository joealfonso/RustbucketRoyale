import { describe, expect, it } from "vitest";
import { DROP_DIVING, DROP_RIDING, STEP } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom } from "./testClient";

const drop = loadRoomConfig().drop!;
const ALTITUDE = drop.altitudeMeters.small!;
const LAND_WITHIN_SECONDS = 20; // looking level the whole way down from 250 m takes about 11 s; a bot dives steeper

// The drop-in: a match starts with everyone high above their spawns, held through the countdown, then diving in.
describe("drop-in", () => {
  it("starts everyone riding high, dives at the start, lands them all in time, and holds fire until they are down", () => {
    const { room } = makeRoom((c) => ({ ...c, drop }), "small", 3);
    const host = new Client(room);
    // Looking straight down, so the host lands by its spawn, well inside the ring, rather than gliding out of it.
    const down = -1.2;
    const shoot = idle({ fire: true, grenade: true, aimPitch: down, targetX: 0, targetY: 0, targetZ: 30 });
    const shots = () => host.messages.filter((m) => (m.t === "shot" || m.t === "grenade") && m.id === host.id).length;

    room.receive(host.id, JSON.stringify({ t: "start" }));
    expect(room.matchState).toBe("countdown");
    const riding = room.inspect();
    expect(riding).toHaveLength(4);
    for (const m of riding) {
      expect(m.dropPhase).toBe(DROP_RIDING);
      expect(m.y).toBeGreaterThan(ALTITUDE - 1);
    }

    // Held still up top through the countdown.
    let ticks = 0;
    while (room.matchState === "countdown" && ticks++ < 60) { host.send(shoot); room.tick(); }
    expect(room.matchState).toBe("active");
    const start = room.inspect();
    for (const m of start) {
      expect(m.dropPhase).toBe(DROP_DIVING);
      const before = riding.find((r) => r.id === m.id)!;
      expect(Math.hypot(m.x - before.x, m.z - before.z)).toBeLessThan(1);
    }

    // Fire and grenades held down all the way: nothing leaves the mech while it drops or is stunned.
    const landedAt = new Map<number, number>();
    for (let i = 0; i < LAND_WITHIN_SECONDS / STEP && landedAt.size < 4; i++) {
      const me = room.inspect().find((m) => m.id === host.id)!;
      const held = me.dropPhase !== 0 || me.dropTime > 0;
      host.send(held ? shoot : idle({ aimPitch: down }));
      room.tick();
      for (const m of room.inspect()) if (m.dropPhase === 0 && !landedAt.has(m.id)) landedAt.set(m.id, i * STEP);
    }
    expect(landedAt.size).toBe(4);
    expect(shots()).toBe(0);
    // Bots came down near where they meant to, and nobody was hurt on the way down.
    for (const m of room.inspect()) {
      expect(m.hp).toEqual(start.find((s) => s.id === m.id)!.hp);
      if (m.dropSpot) expect(Math.hypot(m.dropSpot.x - m.x, m.dropSpot.z - m.z)).toBeLessThan(15);
    }

    // Down and steady again, the same trigger fires.
    for (let i = 0; i < 60; i++) { host.send(shoot); room.tick(); }
    expect(shots()).toBeGreaterThan(0);
  });

  it("keeps the lobby on the ground: practice respawns never drop", () => {
    const { room } = makeRoom((c) => ({ ...c, drop }), "small", 2);
    new Client(room);
    for (let i = 0; i < 30; i++) room.tick();
    for (const m of room.inspect()) {
      expect(m.dropPhase).toBe(0);
      expect(m.y).toBeLessThan(10);
    }
  });
});
