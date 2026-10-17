import { describe, expect, it } from "vitest";
import { STEP, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Room } from "./Room";
import { Client, forward, inputMessage, type Snapshot } from "./testClient";

describe("Room", () => {
  it("welcomes players, shows them to each other, and refuses a ninth", () => {
    const room = new Room(loadRoomConfig());
    const clients = Array.from({ length: 8 }, () => new Client(room));
    expect(clients.every((c) => c.messages[0]?.t === "welcome")).toBe(true);
    room.tick(); room.tick(); room.tick();
    expect(clients[0]!.snapshots().at(-1)!.others).toHaveLength(7);

    const ninth: ServerMessage[] = [];
    expect(room.join((m) => ninth.push(m))).toBeNull();
    expect(ninth[0]).toEqual({ t: "full" });
  });

  it("removes a player who leaves", () => {
    const room = new Room(loadRoomConfig());
    const a = new Client(room);
    const b = new Client(room);
    room.leave(b.id);
    room.tick(); room.tick(); room.tick();
    expect(a.snapshots().at(-1)!.others).toHaveLength(0);
  });

  it("the client's prediction matches the server with no lag, so corrections are zero", () => {
    const room = new Room(loadRoomConfig());
    const client = new Client(room);
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      client.send(forward({ run: i % 100 < 60, jet: i % 90 > 70, dash: i % 70 === 10 }));
      room.tick();
      const snap = client.snapshots().at(-1);
      if (snap && snap.tick === room["tickCount" as keyof Room]) {
        worst = Math.max(worst, client.predictor.reconcile(snap.ack, snap.you, STEP));
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("stays in sync with the server under latency, with the replay absorbing the delay", () => {
    const room = new Room(loadRoomConfig());
    const client = new Client(room);
    const delayed: Snapshot[][] = [];
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      client.send(forward({ run: true, jet: i % 120 > 100, dash: i % 75 === 20 }));
      room.tick();
      delayed.push(client.snapshots().splice(0));
      client.messages.length = 0;
      // Snapshots reach the client 8 ticks late.
      const arriving = delayed[i - 8]?.at(-1);
      if (arriving) worst = Math.max(worst, client.predictor.reconcile(arriving.ack, arriving.you, STEP));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("limits fire rate on the server no matter how fast the client asks", () => {
    const config = loadRoomConfig();
    const room = new Room(config);
    const shooter = new Client(room);
    const watcher = new Client(room);
    for (let i = 0; i < 120; i++) {
      shooter.send(forward({ fire: true, targetX: 0, targetY: 2, targetZ: 100 }));
      room.tick();
    }
    const shots = watcher.messages.filter((m) => m.t === "shot");
    const expected = config.weapon.shotsPerSecond * 2;
    expect(shots.length).toBeGreaterThanOrEqual(expected - 1);
    expect(shots.length).toBeLessThanOrEqual(expected + 1);
    expect(shots.every((s) => s.t === "shot" && s.id === shooter.id)).toBe(true);
  });

  it("ignores malformed, replayed, and out of range input", () => {
    const room = new Room(loadRoomConfig());
    const client = new Client(room);
    for (const bad of ["not json", "{}", '{"t":"input"}', '{"t":"input","seq":"1"}', JSON.stringify({ t: "input", seq: 1, moveX: Infinity })]) {
      expect(room.receive(client.id, bad)).toBe(true);
    }
    client.send(forward()); // seq 1
    room.receive(client.id, inputMessage(1, forward())); // replay of seq 1
    room.tick();
    expect(client.snapshots().length).toBe(0); // snapshots only every few ticks
    room.tick(); room.tick();
    expect(client.snapshots().at(-1)!.ack).toBe(1);
  });

  it("clamps oversized movement so it cannot move faster than the sim allows", () => {
    const room = new Room(loadRoomConfig());
    const client = new Client(room);
    room.receive(client.id, JSON.stringify({ t: "input", seq: 1, moveX: 99, moveY: 99, aimYaw: 0, aimPitch: 99, run: false, jet: false, fire: false, targetX: 0, targetY: 0, targetZ: 0 }));
    for (let i = 0; i < 180; i++) room.tick();
    const you = client.snapshots().at(-1)!.you;
    expect(Math.hypot(you.vx, you.vz)).toBeLessThanOrEqual(loadRoomConfig().mech.walkSpeed + 1e-6);
  });

  it("processes at most two inputs per tick, so a burst cannot speed a mech up", () => {
    const config = loadRoomConfig();
    const room = new Room(config);
    const client = new Client(room);
    for (let i = 0; i < 12; i++) client.send(forward({ run: true }));
    room.tick(); room.tick(); room.tick();
    expect(client.snapshots().at(-1)!.ack).toBe(config.net.maxInputsPerTick * 3);
  });

  it("kicks a flooder", () => {
    const config = loadRoomConfig();
    const room = new Room(config);
    const client = new Client(room);
    let kicked = false;
    for (let seq = 1; seq <= 2000 && !kicked; seq++) {
      kicked = !room.receive(client.id, inputMessage(seq, forward()));
    }
    expect(kicked).toBe(true);
  });
});
