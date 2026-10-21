import { describe, expect, it } from "vitest";
import { DROP_BALL, DROP_HANGING, STEP, ballFallSeconds, encodeInput, type MechInput } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom } from "./testClient";

const config = loadRoomConfig();
const drop = config.drop!;

// The drop-in (gates 16a, 16c): a match starts with every mech hanging high over its own spot through the countdown;
// once live each falls as a ball, steering toward the point under its crosshair, and lands.
describe("drop-in", () => {
  it("hangs everyone apart through the countdown, drops them when live, steers the host onto its target, lands them all, and holds fire until they are down", () => {
    const { room } = makeRoom((c) => ({ ...c, drop }), "small", 5);
    const host = new Client(room);
    const altitude = drop.altitudeMeters.small!;
    // Sent packed, as the browser does, with the target along because the host is dropping and not firing.
    let seq = 0;
    const send = (input: MechInput) => room.receive(host.id, encodeInput({ ...input, t: "input", seq: ++seq }, true));
    const shots = () => host.messages.filter((m) => (m.t === "shot" || m.t === "grenade") && m.id === host.id).length;

    room.receive(host.id, JSON.stringify({ t: "start" }));
    expect(room.matchState).toBe("countdown");
    const hung = room.inspect();
    expect(hung).toHaveLength(6);
    for (const m of hung) {
      expect(m.dropPhase).toBe(DROP_HANGING);
      expect(m.y).toBeGreaterThanOrEqual(altitude - 1);
    }
    for (const a of hung) for (const b of hung) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(40);

    // Through the countdown nobody moves, whatever the host presses.
    const start = new Map(hung.map((m) => [m.id, { x: m.x, y: m.y, z: m.z }]));
    const me0 = hung.find((m) => m.id === host.id)!;
    const target = { x: Math.max(-130, Math.min(130, me0.x + 40)), z: Math.max(-130, Math.min(130, me0.z - 30)) };
    const press = idle({ jet: true, moveY: 1, dash: true, fire: true, grenade: true, aimPitch: -1, targetX: Math.fround(target.x), targetY: 0, targetZ: Math.fround(target.z) });
    let ticks = 0;
    while (room.matchState === "countdown" && ticks++ < 60) {
      send(press); room.tick();
      if (room.matchState !== "countdown") break;
      for (const m of room.inspect()) {
        expect(m.dropPhase).toBe(DROP_HANGING);
        expect({ x: m.x, y: m.y, z: m.z }).toEqual(start.get(m.id));
      }
    }
    expect(room.matchState).toBe("active");
    for (const m of room.inspect()) expect(m.dropPhase).toBe(DROP_BALL);

    // Live: everyone falls; the host steers at its target, firing the whole way, and bots aim at their spots.
    const landBy = ballFallSeconds(altitude + 60, config.mech) + 1;
    const landedAt = new Map<number, number>();
    let seconds = 0, shotsInAir = -1;
    while (seconds < landBy && landedAt.size < hung.length) {
      send(press); room.tick(); seconds += STEP;
      for (const m of room.inspect()) {
        if (m.dropPhase !== 0 || landedAt.has(m.id)) continue;
        landedAt.set(m.id, seconds);
        // Nothing hurts a mech in the air: it lands as whole as it hung.
        expect(m.hp).toEqual(hung.find((h) => h.id === m.id)!.hp);
        if (m.id === host.id) expect(Math.hypot(m.x - target.x, m.z - target.z)).toBeLessThan(2);
        if (m.dropSpot) expect(Math.hypot(m.dropSpot.x - m.x, m.dropSpot.z - m.z)).toBeLessThan(15);
        // Everyone hung at the same height, so the bots take about the same time; the host holds Space and W, so falls fast.
        const usual = ballFallSeconds(start.get(m.id)!.y - m.y, config.mech);
        if (m.id === host.id) { expect(seconds).toBeLessThan(usual * 0.8); shotsInAir = shots(); }
        else expect(Math.abs(seconds - usual)).toBeLessThan(1);
      }
    }
    expect(landedAt.size).toBe(hung.length);
    expect(shotsInAir).toBe(0); // the host lands first and may fire once down
    for (const m of room.inspect()) expect(Math.max(Math.abs(m.x), Math.abs(m.z))).toBeLessThanOrEqual(room.mapMeters / 2);

    // Down and steady again, the same trigger fires.
    for (let i = 0; i < 60; i++) { send(idle({ fire: true, aimPitch: -0.3, targetX: 0, targetY: 0, targetZ: 30 })); room.tick(); }
    expect(shots()).toBeGreaterThan(0);
  });

  it("puts a mech joining in the countdown at a spot of its own, without moving anyone", () => {
    const { room } = makeRoom((c) => ({ ...c, drop, match: { ...c.match, countdownSeconds: 2 } }), "small", 3);
    const host = new Client(room);
    room.receive(host.id, JSON.stringify({ t: "start" }));
    const before = room.inspect();
    new Client(room);
    const after = room.inspect();
    expect(after).toHaveLength(before.length + 1);
    for (const m of before) expect(after.find((a) => a.id === m.id)).toMatchObject({ x: m.x, y: m.y, z: m.z });
    const joined = after.find((a) => !before.some((b) => b.id === a.id))!;
    expect(joined.dropPhase).toBe(DROP_HANGING);
    for (const m of before) expect(Math.hypot(m.x - joined.x, m.z - joined.z)).toBeGreaterThan(20);
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
