import { describe, expect, it } from "vitest";
import { ZONE_ARMS, ZONE_LEGS, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Player } from "./Player";
import type { Room } from "./Room";

const players = (room: Room) => (room as unknown as { players: Map<number, Player> }).players;
const breakZone = (room: Room, c: Client, zone: number) => { players(room).get(c.id)!.hp[zone] = 0; };

function run(room: Room, clients: Client[], input: (c: Client) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c)); room.tick(); }
}

function inMatch() {
  const { room, config } = makeRoom();
  const a = new Client(room, config);
  startMatch(room, a);
  return { room, config, a };
}

describe("broken legs", () => {
  it("make the mech crawl, on the server and in what the client is told", () => {
    const { room, config, a } = inMatch();
    breakZone(room, a, ZONE_LEGS);
    run(room, [a], () => idle({ moveY: 1, run: true }), 90);
    const you = a.last().you;
    expect(you.crawling).toBe(true);
    expect(Math.hypot(you.vx, you.vz)).toBeCloseTo(config.mech.walkSpeed * config.mech.crawlSpeedMultiplier, 1);
    expect(you.running).toBe(false);
  });

  it("are mended when a knocked out mech comes back between matches", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    breakZone(room, a, ZONE_LEGS);
    run(room, [a], () => idle(), 5);
    expect(a.last().you.crawling).toBe(true);
    (room as unknown as { eliminate(p: Player, k: Player | null): void }).eliminate(players(room).get(a.id)!, null);
    run(room, [a], () => idle(), Math.ceil(config.combat.respawnSeconds * 60) + 5);
    expect(a.last().you.crawling).toBe(false);
  });
});

describe("broken arms", () => {
  // Fires straight ahead at a far point for a while and returns how far the shots strayed, on average, in radians.
  function stray(broken: boolean): number {
    const { room, a } = inMatch();
    if (broken) breakZone(room, a, ZONE_ARMS);
    run(room, [a], () => idle({ fire: true, targetX: -21, targetY: 2.4, targetZ: 200 }), 120);
    const shots = a.messages.filter((m): m is Extract<ServerMessage, { t: "shot" }> => m.t === "shot");
    expect(shots.length).toBeGreaterThan(5);
    return shots.reduce((sum, s) => sum + Math.acos(Math.min(1, s.dz)), 0) / shots.length;
  }

  it("send shots much wider", () => {
    expect(stray(true)).toBeGreaterThan(stray(false) * 2);
  });

  it("cannot throw a grenade", () => {
    const { room, a } = inMatch();
    const b = new Client(room);
    breakZone(room, a, ZONE_ARMS);
    run(room, [a, b], (c) => (c === a ? idle({ grenade: true, targetX: 0, targetY: 0, targetZ: 30 }) : idle()), 60);
    expect(b.messages.some((m) => m.t === "grenade")).toBe(false);
    expect(a.last().loadout.grenades).toBeGreaterThan(0);
  });
});
