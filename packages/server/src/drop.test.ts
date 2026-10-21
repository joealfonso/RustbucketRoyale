import { describe, expect, it } from "vitest";
import { DROP_RIDING, DROP_SHELL, STEP, shipAt, shipEndsAt, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom } from "./testClient";

const drop = loadRoomConfig().drop!;

// The drop-in (gates 16a, 16b): a match starts with everyone aboard the Rustbucket, flying its line through the
// countdown; once live each fires out of its cannon, flies a short shell arc, then dives in.
describe("drop-in", () => {
  it("rides everyone on the ship, fires nobody in the countdown, throws everyone out by the end of the line, lands them all, and holds fire until they are down", () => {
    const { room } = makeRoom((c) => ({ ...c, drop }), "small", 3);
    const host = new Client(room);
    const at = { x: 0, z: 0 };
    // Space held the whole time the host is aboard: it must not fire in the countdown, only once the match is live.
    // It looks at the middle of the map, so it comes down inside the ring rather than by the edge it boarded at.
    const jump = idle({ jet: true, aimPitch: -1.2 });
    const aimInwards = () => { const me = room.inspect().find((m) => m.id === host.id)!; jump.aimYaw = Math.atan2(me.x, me.z); };
    const shoot = idle({ fire: true, grenade: true, aimPitch: -1.2, targetX: 0, targetY: 0, targetZ: 30 });
    const shots = () => host.messages.filter((m) => (m.t === "shot" || m.t === "grenade") && m.id === host.id).length;

    room.receive(host.id, JSON.stringify({ t: "start" }));
    expect(room.matchState).toBe("countdown");
    const ship = room.shipPath!;
    expect(ship).not.toBeNull();
    const roomMessage = host.messages.filter((m): m is Extract<ServerMessage, { t: "room" }> => m.t === "room").at(-1)!;
    expect(roomMessage.ship).toEqual(ship);
    const boarded = room.inspect();
    expect(boarded).toHaveLength(4);
    for (const m of boarded) {
      expect(m.dropPhase).toBe(DROP_RIDING);
      expect(m.y).toBeCloseTo(ship.y, 5);
    }
    // Riders stand apart, round the cannon.
    for (const a of boarded) for (const b of boarded) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);

    // Through the countdown the ship flies and everyone moves with it, Space or not.
    const offset = new Map(boarded.map((m) => { shipAt(ship, ship.startAt, at); return [m.id, { x: m.x - at.x, z: m.z - at.z }]; }));
    let clock = ship.startAt;
    let ticks = 0;
    while (room.matchState === "countdown" && ticks++ < 60) {
      aimInwards(); host.send(jump); room.tick(); clock += STEP;
      if (room.matchState !== "countdown") break; // that tick began the match, and its jet counted
      shipAt(ship, clock, at);
      for (const m of room.inspect()) {
        expect(m.dropPhase).toBe(DROP_RIDING);
        const o = offset.get(m.id)!;
        expect(Math.hypot(m.x - o.x - at.x, m.z - o.z - at.z)).toBeLessThan(1e-3);
      }
    }
    expect(room.matchState).toBe("active");

    // Bots came down near where they meant to (checked as each lands).
    // Live: the host fires at once, holding Space; the bots fire when they pass their spots, or at the end.
    const endAt = shipEndsAt(ship);
    const firedAt = new Map<number, number>();
    for (const m of room.inspect()) if (m.dropPhase !== DROP_RIDING) firedAt.set(m.id, 0);
    const landedAt = new Map<number, number>();
    const landBy = endAt + drop.ship.edgeMeters + 30; // the end of the line, the shell, then a level dive from 250 m
    let seconds = 0;
    for (let i = 0; seconds < landBy && landedAt.size < 4; i++) {
      const me = room.inspect().find((m) => m.id === host.id)!;
      const held = me.dropPhase !== 0 || me.dropTime > 0;
      if (me.dropPhase === DROP_RIDING) aimInwards();
      shoot.aimYaw = jump.aimYaw;
      host.send(me.dropPhase === DROP_RIDING ? jump : held ? shoot : idle({ aimPitch: -1.2 }));
      room.tick(); seconds += STEP;
      for (const m of room.inspect()) {
        if (m.dropPhase !== DROP_RIDING && !firedAt.has(m.id)) firedAt.set(m.id, seconds);
        if (m.dropPhase === DROP_RIDING) expect(seconds).toBeLessThan(endAt + STEP * 1.5);
        if (m.dropPhase === 0 && !landedAt.has(m.id)) {
          landedAt.set(m.id, seconds);
          // Nothing hurts a mech in the air: it lands as whole as it boarded. (Once down, early landers may fight.)
          expect(m.hp).toEqual(boarded.find((b) => b.id === m.id)!.hp);
          if (m.dropSpot) expect(Math.hypot(m.dropSpot.x - m.x, m.dropSpot.z - m.z)).toBeLessThan(15);
        }
      }
    }
    expect(firedAt.get(host.id)).toBe(0); // on the match's very first tick
    expect(firedAt.size).toBe(4);
    expect(landedAt.size).toBe(4);
    expect(shots()).toBe(0);
    for (const m of room.inspect()) expect(Math.max(Math.abs(m.x), Math.abs(m.z))).toBeLessThanOrEqual(room.mapMeters / 2);

    // Down and steady again, the same trigger fires.
    for (let i = 0; i < 60; i++) { host.send(shoot); room.tick(); }
    expect(shots()).toBeGreaterThan(0);
  });

  it("throws out at the end of the line anyone who never fires", () => {
    const { room } = makeRoom((c) => ({ ...c, drop }), "small", 0);
    const host = new Client(room);
    room.receive(host.id, JSON.stringify({ t: "start" }));
    const endAt = shipEndsAt(room.shipPath!);
    let seconds = room.shipPath!.startAt;
    let phase = DROP_RIDING;
    while (phase === DROP_RIDING && seconds < endAt + 1) {
      host.send(idle());
      room.tick(); seconds += STEP;
      phase = room.inspect()[0]!.dropPhase;
    }
    expect(phase).toBe(DROP_SHELL);
    expect(seconds).toBeGreaterThanOrEqual(endAt - STEP);
    expect(seconds).toBeLessThan(endAt + STEP * 1.5);
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
