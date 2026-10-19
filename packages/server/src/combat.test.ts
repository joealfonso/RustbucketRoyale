import { describe, expect, it } from "vitest";
import { ZONE_ARMS, ZONE_LEGS, ZONE_TORSO, World, boxFromData, type MechInput, type ServerMessage } from "@rustbucket/shared";
import type { Room, RoomConfig } from "./Room";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom, startMatch } from "./testClient";

// The shooter spawns at x -21 and the target at x -15. The target turns its back (faces +X) so its
// arms are out of the line of fire, and the shot lands on the torso. Aim at the target's chest.
const AT_TARGET: Partial<MechInput> = { fire: true, targetX: -15, targetY: 2.4, targetZ: 0 };
const FACE_AWAY = -Math.PI / 2;
const turnedAway = (extra: Partial<MechInput> = {}) => idle({ aimYaw: FACE_AWAY, ...extra });

const wallAt = (config: RoomConfig): RoomConfig => {
  const map = config.mapFor("small", 0);
  const world = new World([...map.world.boxes, boxFromData({ name: "wall", center: [-18, 5, 0], size: [1, 10, 20], color: "" })]);
  return { ...config, mapFor: () => ({ ...map, world }) };
};

// Two players in a match that has just started (the countdown is over and damage is live).
function setup(patch: (c: RoomConfig) => RoomConfig = (c) => c) {
  const { room, config } = makeRoom(patch);
  const shooter = new Client(room, config); // the first to join is the room's host
  const target = new Client(room, config);
  startMatch(room, shooter);
  return { config, room, shooter, target };
}

function tick(room: Room, clients: Client[], input: (c: Client, i: number) => MechInput, count: number): void {
  for (let i = 0; i < count; i++) {
    for (const c of clients) c.send(input(c, i));
    room.tick();
  }
}

// Give the target time to swing round before anything is fired.
function settle(room: Room, shooter: Client, target: Client): void {
  tick(room, [shooter, target], (c) => (c === target ? turnedAway() : idle()), 40);
}

const hits = (c: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "hit" }> => m.t === "hit");

describe("shots", () => {
  it("hit the zone they were aimed at, tell the shooter, and hurt the target", () => {
    const { room, shooter, target, config } = setup();
    settle(room, shooter, target);
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 6);

    expect(hits(shooter)[0]).toMatchObject({ t: "hit", targetId: target.id, zone: ZONE_TORSO, damage: config.weapons.weapons[config.weapons.start]!.damage, killed: false });
    expect(target.last().health.hp[ZONE_TORSO]).toBe(100 - config.weapons.weapons[config.weapons.start]!.damage);
    expect(shooter.messages.find((m) => m.t === "shot")).toMatchObject({ hitMech: true });
  });

  it("hit an arm when aimed at the arm itself", () => {
    // The target faces the shooter (forward is -X at yaw PI/2), so its left arm is 1.2 m to the +Z side.
    const { room, shooter, target } = setup();
    tick(room, [shooter, target], (c) => (c === target ? idle({ aimYaw: Math.PI / 2 }) : idle()), 40);
    tick(room, [shooter, target], (c) => (c === shooter ? idle({ fire: true, targetX: -15, targetY: 2.4, targetZ: 1.2 }) : idle({ aimYaw: Math.PI / 2 })), 6);
    expect(hits(shooter)[0]).toMatchObject({ targetId: target.id, zone: ZONE_ARMS });
    expect(target.last().health.hp[ZONE_ARMS]).toBeLessThan(60);
  });

  it("land on the shape of the mech the target was dealt, not only the standard boxes", () => {
    // The target is player 2, which the roster deals the Cataclysm: four legs splayed wide. With the server's default
    // spawn yaw its front legs reach out to about 1.1 m on +Z, where the standard leg box (0.35 m) has nothing.
    const legShot = (roster: boolean) => {
      const { room, shooter, target } = setup((c) => (roster ? { ...c, roster: loadRoomConfig({ roster: true }).roster, kitHitboxes: loadRoomConfig({ roster: true }).kitHitboxes } : c));
      expect(target.id).toBe(2);
      tick(room, [shooter, target], () => idle(), 30);
      tick(room, [shooter, target], (c) => (c === shooter ? idle({ fire: true, targetX: -10, targetY: 1.0, targetZ: 1.1 }) : idle()), 6);
      return hits(shooter)[0];
    };
    expect(legShot(true)).toMatchObject({ targetId: 2, zone: ZONE_LEGS });
    expect(legShot(false)).toBeUndefined();
  });

  it("are stopped by a wall in between", () => {
    const { room, shooter, target } = setup(wallAt);
    settle(room, shooter, target);
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 20);
    expect(hits(shooter)).toHaveLength(0);
    expect(target.last().health.hp[ZONE_TORSO]).toBe(100);
  });

  it("are checked against where the target was when the shooter saw it, up to a cap", () => {
    // The target dashes sideways just before the shot. The shooter reports how far behind its picture is.
    const run = (reportedMs: number, capMs: number) => {
      const { room, shooter, target } = setup((c) => ({ ...c, combat: { ...c.combat, lagCompensationMs: capMs, historyMs: 600 } }));
      shooter.lagMs = reportedMs;
      settle(room, shooter, target);
      tick(room, [shooter, target], (c) => (c === target ? turnedAway({ moveX: 1, run: true }) : idle()), 30);
      tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway({ moveX: 1, run: true })), 1);
      return hits(shooter).length > 0;
    };
    expect(run(0, 500)).toBe(false); // saw it live: it has already moved
    expect(run(500, 500)).toBe(true); // saw it half a second ago: it was still there
    expect(run(500, 0)).toBe(false); // a client cannot ask for more than the server allows
  });

  it("hurt people in the lobby too, so there is something to practise on, and the destroyed mech comes back without ending anything", () => {
    const { room, config } = makeRoom();
    const shooter = new Client(room, config);
    const target = new Client(room, config);
    settle(room, shooter, target);
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 6);
    expect(target.last().health.hp[ZONE_TORSO]).toBeLessThan(100);

    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 120);
    expect(target.last().health.dead).toBe(true);
    expect(target.messages.some((m) => m.t === "eliminated")).toBe(false);
    expect(room.matchState).toBe("lobby");

    tick(room, [shooter, target], () => idle(), Math.ceil(config.combat.respawnSeconds * 60) + 20);
    expect(target.last().health.dead).toBe(false);
    expect(target.last().health.hp[ZONE_TORSO]).toBe(100);
  });

  it("do no harm during the countdown", () => {
    const { room, config } = makeRoom((c) => ({ ...c, match: { ...c.match, countdownSeconds: 5 } }));
    const shooter = new Client(room, config);
    const target = new Client(room, config);
    settle(room, shooter, target);
    room.receive(shooter.id, JSON.stringify({ t: "start" }));
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 90);
    expect(room.matchState).toBe("countdown");
    expect(hits(shooter)).toHaveLength(0);
    expect(target.last().health.hp[ZONE_TORSO]).toBe(100);
  });
});

describe("destroying a mech", () => {
  it("knocks the target out for the match and ends it when one is left, with the survivor winning", () => {
    const { room, shooter, target } = setup((c) => ({ ...c, match: { ...c.match, resultsSeconds: 30 } }));
    settle(room, shooter, target);
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 120);

    expect(hits(shooter).some((h) => h.killed)).toBe(true);
    const out = shooter.messages.find((m) => m.t === "eliminated");
    expect(out).toMatchObject({ t: "eliminated", id: target.id, killerId: shooter.id, place: 2, alive: 1 });
    expect(shooter.messages.find((m) => m.t === "result")).toMatchObject({ winnerId: shooter.id });
    expect(room.matchState).toBe("results");
  });

  it("leaves a knocked out mech unable to move or fire", () => {
    const { room, shooter, target } = setup((c) => ({ ...c, match: { ...c.match, resultsSeconds: 30 } }));
    settle(room, shooter, target);
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 120);
    const before = { x: target.last().you.x, z: target.last().you.z };
    tick(room, [shooter, target], (c) => (c === target ? turnedAway({ moveX: 1, run: true, fire: true }) : idle()), 30);
    expect(target.last().you.x).toBeCloseTo(before.x);
    expect(target.last().you.z).toBeCloseTo(before.z);
    expect(target.last().health.dead).toBe(true);
  });
});

describe("grenades", () => {
  // Make the grenade drop where it is thrown and go off quickly, so the blast point is known.
  const dropBomb = (c: RoomConfig): RoomConfig => ({
    ...c, grenade: { ...c.grenade, throwSpeed: 0, throwLift: 0, fuseSeconds: 0.5 },
  });
  const THROW: Partial<MechInput> = { grenade: true, targetX: -21, targetY: 0, targetZ: 5 };
  const full = [60, 60, 100];

  it("go off after the fuse, hurt everyone in range including the thrower, and tell the shooter", () => {
    const { room, shooter, target } = setup(dropBomb);
    tick(room, [shooter, target], (c, i) => (c === shooter && i === 0 ? idle(THROW) : idle()), 60);

    expect(target.messages.some((m) => m.t === "grenade")).toBe(true);
    expect(target.messages.some((m) => m.t === "explode")).toBe(true);
    const thrower = shooter.last().health.hp;
    const bystander = target.last().health.hp;
    expect(thrower.every((hp, zone) => hp < full[zone]!)).toBe(true);
    expect(bystander.some((hp, zone) => hp < full[zone]!)).toBe(true);
    expect(thrower[ZONE_TORSO]!).toBeLessThan(bystander[ZONE_TORSO]!); // closer means more damage
  });

  it("are blocked by walls", () => {
    const { room, shooter, target } = setup((c) => wallAt(dropBomb(c)));
    tick(room, [shooter, target], (c, i) => (c === shooter && i === 0 ? idle(THROW) : idle()), 60);
    expect(target.last().health.hp).toEqual(full);
  });

  it("have a cooldown", () => {
    const { room, shooter, target } = setup();
    tick(room, [shooter, target], (c) => (c === shooter ? idle({ grenade: true }) : idle()), 60);
    expect(target.messages.filter((m) => m.t === "grenade")).toHaveLength(1);
  });
});
