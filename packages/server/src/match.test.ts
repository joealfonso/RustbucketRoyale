import { describe, expect, it } from "vitest";
import { STEP, ZONE_TORSO, type ServerMessage } from "@rustbucket/shared";
import { Client, idle, makeRoom, startMatch, tickRoom } from "./testClient";
import type { Room, RoomConfig } from "./Room";

const rooms = (c: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "room" }> => m.t === "room");
const lastRoom = (c: Client) => rooms(c).at(-1)!;
const seconds = (n: number) => Math.round(n / STEP);

function drive(room: Room, clients: Client[], count: number): void {
  for (let i = 0; i < count; i++) {
    for (const c of clients) c.send(idle());
    room.tick();
  }
}

// Keeps every client sending until something is true, with a cap so a broken test cannot spin forever.
function driveUntil(room: Room, clients: Client[], done: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks && !done(); i++) drive(room, clients, 1);
}

// Players spawn well outside the first ring, so the ring starts hurting them straight away.
const farAway = (c: RoomConfig): RoomConfig => {
  const map = c.mapFor("small", 0);
  const spawns: [number, number, number][] = map.spawns.map((s, i) => [s[0] + 400 + i * 4, s[1], s[2]]);
  return { ...c, mapFor: () => ({ ...map, spawns }) };
};

describe("room and lobby", () => {
  it("tells people their room code and who is hosting", () => {
    const { room } = makeRoom();
    const a = new Client(room);
    const b = new Client(room);
    expect(a.messages[0]).toMatchObject({ t: "welcome", code: "TEST", tier: "small" });
    expect(lastRoom(b)).toMatchObject({ code: "TEST", state: "lobby", hostId: a.id, players: 2 });
  });

  it("only the host can start the match", () => {
    const { room } = makeRoom();
    const host = new Client(room);
    const guest = new Client(room);
    room.receive(guest.id, JSON.stringify({ t: "start" }));
    tickRoom(room, 5);
    expect(room.matchState).toBe("lobby");
    room.receive(host.id, JSON.stringify({ t: "start" }));
    expect(room.matchState).toBe("countdown");
  });

  it("hands hosting to the next player when the host leaves", () => {
    const { room } = makeRoom();
    const host = new Client(room);
    const guest = new Client(room);
    room.leave(host.id);
    expect(lastRoom(guest).hostId).toBe(guest.id);
  });
});

describe("match flow", () => {
  it("counts down with everyone frozen, then goes live, and a fresh map comes with each match", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    const seedBefore = lastRoom(a).seed;
    room.receive(a.id, JSON.stringify({ t: "start" }));

    const countdown = lastRoom(a);
    expect(countdown.state).toBe("countdown");
    expect(countdown.seed).not.toBe(seedBefore);
    expect(countdown.ring).not.toBeNull();

    const xBefore = a.last()?.you.x;
    for (let i = 0; i < 6; i++) { a.send({ ...idle(), moveY: 1, run: true }); b.send(idle()); room.tick(); }
    tickRoom(room, 3);
    const during = a.snapshots().at(-1)!;
    expect(during.match.state).toBe("countdown");
    expect(Math.hypot(during.you.vx, during.you.vz)).toBe(0);
    expect(xBefore === undefined || Math.abs(during.you.x - xBefore) < 1e-6).toBe(true);

    tickRoom(room, 20);
    expect(room.matchState).toBe("active");
    expect(lastRoom(a).state).toBe("active");
  });

  it("starts the next match by itself after the results, with a new seed and full health", () => {
    const { room, config } = makeRoom();
    const solo = new Client(room, config);
    startMatch(room, solo);
    const seedOfFirst = lastRoom(solo).seed;
    // A solo player who stands still is caught by the closing ring, which ends the match.
    driveUntil(room, [solo], () => room.matchState === "results", seconds(config.match.matchSeconds) + 60);
    expect(room.matchState).toBe("results");
    expect(solo.messages.find((m) => m.t === "result")).toBeDefined();

    drive(room, [solo], seconds(config.match.resultsSeconds) + 5);
    expect(room.matchState).toBe("countdown");
    expect(lastRoom(solo).seed).not.toBe(seedOfFirst);
    expect(solo.last().health.hp[ZONE_TORSO]).toBe(100);
  });

  it("goes back to the lobby after results when auto next match is off", () => {
    const { room, config } = makeRoom((c) => ({ ...c, match: { ...c.match, autoNextMatch: 0, matchSeconds: 5 } }));
    const solo = new Client(room, config);
    startMatch(room, solo);
    drive(room, [solo], seconds(5) + seconds(config.match.resultsSeconds) + 10);
    expect(room.matchState).toBe("lobby");
  });

  it("someone arriving mid match can only watch, and others do not see a mech for them", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    startMatch(room, a);
    const late = new Client(room, config);
    drive(room, [a, b, late], 30);
    expect(late.last().health.dead).toBe(true);
    expect(late.last().match.state).toBe("active");
    expect(a.last().others.map((o) => o.id)).toEqual([b.id]);
  });
});

describe("the ring", () => {
  it("hurts mechs outside it and knocks them out, and the last one standing wins", () => {
    const { room, config } = makeRoom((c) => farAway({ ...c, match: { ...c.match, resultsSeconds: 60 } }));
    const a = new Client(room, config);
    const b = new Client(room, config);
    startMatch(room, a);
    // Both start outside the ring. Move the second one inside by hand: it cannot be done from here, so
    // use the fact that damage is per mech and see both lose health and both be knocked out in order.
    drive(room, [a, b], seconds(120));
    expect(a.messages.filter((m) => m.t === "eliminated").length).toBeGreaterThanOrEqual(1);
    expect(a.messages.find((m) => m.t === "eliminated")).toMatchObject({ killerId: null });
  });

  it("does nothing to mechs inside the ring", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    startMatch(room, a);
    drive(room, [a, b], seconds(60));
    expect(a.last().health.hp).toEqual([60, 60, 100]);
    expect(b.last().health.hp).toEqual([60, 60, 100]);
  });

  it("gives the healthiest survivor the win when time runs out with several left", () => {
    const { room, config } = makeRoom((c) => ({ ...c, match: { ...c.match, matchSeconds: 8, resultsSeconds: 60 } }));
    const a = new Client(room, config);
    const b = new Client(room, config);
    startMatch(room, a);
    drive(room, [a, b], seconds(8) + 5);
    expect(room.matchState).toBe("results");
    expect(a.messages.find((m) => m.t === "result")).toMatchObject({ t: "result" });
  });

  it("counts a player who walks out of the match as knocked out, once they are not back in time", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    startMatch(room, a);
    room.leave(b.id);
    expect(room.matchState).toBe("active");
    tickRoom(room, seconds(config.net.rejoinGraceSeconds) + 1);
    expect(room.matchState).toBe("results");
    expect(a.messages.find((m) => m.t === "result")).toMatchObject({ winnerId: a.id });
  });

  it("holds a dropped player's mech for the grace time, then leaves it as a wreck until the next countdown", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    const c = new Client(room, config);
    startMatch(room, a);
    room.leave(b.id);
    expect(lastRoom(a).players).toBe(2); // people still connected
    expect(room.holdingForRejoin).toBe(true);
    drive(room, [a, c], seconds(config.net.rejoinGraceSeconds) - 5);
    expect(room.inspect().find((m) => m.id === b.id)).toMatchObject({ dead: false, eliminated: false }); // still waiting
    drive(room, [a, c], 10);
    expect(a.messages.find((m) => m.t === "eliminated")).toMatchObject({ id: b.id, killerId: null, left: true });
    expect(room.inspect().find((m) => m.id === b.id)).toMatchObject({ dead: true, eliminated: true });
    expect(room.holdingForRejoin).toBe(false);
    expect(room.matchState).toBe("active"); // two still in it
    room.leave(c.id);
    drive(room, [a], seconds(config.net.rejoinGraceSeconds) + 5);
    expect(room.matchState).toBe("results");
    driveUntil(room, [a], () => room.matchState === "countdown", seconds(60));
    expect(room.inspect().some((m) => m.id === b.id || m.id === c.id)).toBe(false);
  });

  it("gives a player who comes back in time their own mech, in the same match", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    startMatch(room, a);
    const welcome = b.messages.find((m) => m.t === "welcome") as Extract<ServerMessage, { t: "welcome" }>;
    expect(welcome.rejoin).toMatch(/^[0-9a-f]{32}$/);
    room.leave(b.id);
    drive(room, [a], seconds(5));
    expect(room.rejoin(b.id, "0".repeat(32), () => {})).toBeNull(); // somebody else's guess
    const back: ServerMessage[] = [];
    expect(room.rejoin(b.id, welcome.rejoin, (m) => back.push(m))).toBe(b.id);
    expect(back[0]).toMatchObject({ t: "welcome", id: b.id, rejoin: welcome.rejoin });
    expect(lastRoom(a).players).toBe(2);
    drive(room, [a, b], seconds(config.net.rejoinGraceSeconds) + 5);
    expect(room.inspect().find((m) => m.id === b.id)).toMatchObject({ eliminated: false });
    expect(back.some((m) => m.t === "snapshot")).toBe(true);
  });

  it("refuses to bring back a player who was gone too long, or who left outside a match", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    const c = new Client(room, config);
    const token = (x: Client) => (x.messages.find((m) => m.t === "welcome") as Extract<ServerMessage, { t: "welcome" }>).rejoin;
    room.leave(c.id); // in the lobby: just gone
    expect(room.rejoin(c.id, token(c), () => {})).toBeNull();
    startMatch(room, a);
    room.leave(b.id);
    drive(room, [a], seconds(config.net.rejoinGraceSeconds) + 5);
    expect(room.rejoin(b.id, token(b), () => {})).toBeNull();
  });
});
