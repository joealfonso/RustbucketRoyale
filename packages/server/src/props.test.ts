import { describe, expect, it } from "vitest";
import { NOISE_KINDS, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Room } from "./Room";

// The test range has a crate at (-6, 18), barrels at (3, 18) and (6, 18), and a junk pile at (14, 18).
// The first player spawns at (-21, 0, 0), the second at (-15, 0, 0).
const CRATE = 0, BARREL_A = 1, BARREL_B = 2, JUNK = 3;
const aimAt = (x: number, z: number, y = 1): Partial<MechInput> => ({ fire: true, targetX: x, targetY: y, targetZ: z });

function run(room: Room, clients: Client[], input: (c: Client) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c)); room.tick(); }
}
const messages = <T extends ServerMessage["t"]>(c: Client, t: T) => c.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);

describe("props", () => {
  it("break after enough hits, everyone is told, and they stop blocking", () => {
    const { room, config } = makeRoom();
    const shooter = new Client(room, config), other = new Client(room, config);
    run(room, [shooter, other], (c) => (c === shooter ? idle(aimAt(-6, 18)) : idle()), 60);
    expect(messages(other, "prop").map((m) => m.id)).toContain(CRATE);
    // Shots now fly through where the crate was and stop at whatever is behind it.
    const lastShot = messages(shooter, "shot").at(-1)!;
    expect(lastShot.length).toBeGreaterThan(Math.hypot(-6 - lastShot.ox, 18 - lastShot.oz) + 1);
  });

  it("a barrel goes off, sets off the barrel next to it, and the junk pile further away survives", () => {
    const { room, config } = makeRoom();
    const shooter = new Client(room, config), other = new Client(room, config);
    run(room, [shooter, other], (c) => (c === shooter ? idle(aimAt(3, 18)) : idle()), 60);
    const destroyed = messages(other, "prop").map((m) => m.id);
    expect(destroyed).toContain(BARREL_A);
    expect(destroyed).toContain(BARREL_B);
    expect(destroyed).not.toContain(JUNK);
    expect(messages(other, "explode").length).toBeGreaterThanOrEqual(2);
  });

  it("a barrel blast hurts a mech standing next to it", () => {
    const { room, config } = makeRoom((c) => {
      const map = c.mapFor("small", 0);
      const spawns = map.spawns.map((s, i): [number, number, number] => (i === 1 ? [3, 0.1, 15] : s));
      return { ...c, mapFor: () => ({ ...c.mapFor("small", 0), spawns }) };
    });
    const shooter = new Client(room, config), victim = new Client(room, config);
    run(room, [shooter, victim], (c) => (c === shooter ? idle(aimAt(3, 18)) : idle()), 60);
    expect(victim.last().health.hp.some((hp, zone) => hp < [60, 60, 100][zone]!)).toBe(true);
  });

  it("breaking something is loud on the radar", () => {
    const { room, config } = makeRoom();
    const shooter = new Client(room, config), other = new Client(room, config);
    run(room, [shooter, other], (c) => (c === shooter ? idle(aimAt(-6, 18)) : idle()), 60);
    const kinds = other.snapshots().flatMap((s) => s.noises.map((n) => n.kind));
    expect(kinds).toContain(NOISE_KINDS.indexOf("smash"));
  });

  it("someone arriving later is told what is already broken", () => {
    const { room, config } = makeRoom();
    const shooter = new Client(room, config);
    run(room, [shooter], () => idle(aimAt(-6, 18)), 60);
    const late = new Client(room, config);
    expect(messages(late, "props")[0]?.destroyed).toContain(CRATE);
  });

  it("every match starts with everything whole again", () => {
    const { room, config } = makeRoom();
    const shooter = new Client(room, config);
    run(room, [shooter], () => idle(aimAt(-6, 18)), 60);
    startMatch(room, shooter);
    const late = new Client(room, config);
    expect(messages(late, "props")).toHaveLength(0);
  });

  it("cannot be broken during the countdown", () => {
    const { room, config } = makeRoom((c) => ({ ...c, match: { ...c.match, countdownSeconds: 3 } }));
    const shooter = new Client(room, config), other = new Client(room, config);
    room.receive(shooter.id, JSON.stringify({ t: "start" }));
    run(room, [shooter, other], (c) => (c === shooter ? idle(aimAt(-6, 18)) : idle()), 120);
    expect(room.matchState).toBe("countdown");
    expect(messages(other, "prop")).toHaveLength(0);
  });
});
