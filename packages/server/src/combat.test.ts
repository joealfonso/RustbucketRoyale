import { describe, expect, it } from "vitest";
import { ZONE_TORSO, boxFromData, type MechInput } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Room, type RoomConfig } from "./Room";
import { Client, forward, idle } from "./testClient";

// The shooter spawns at x -21 and the target at x -15. The target turns its back (faces +X) so its
// arms are out of the line of fire, and the shot lands on the torso. Aim at the target's chest.
const AT_TARGET: Partial<MechInput> = { fire: true, targetX: -15, targetY: 2.4, targetZ: 0 };
const FACE_AWAY = -Math.PI / 2;
const turnedAway = (extra: Partial<MechInput> = {}) => idle({ aimYaw: FACE_AWAY, ...extra });

function setup(patch: (c: RoomConfig) => RoomConfig = (c) => c) {
  // No random spread, so shots go exactly where aimed.
  const config = patch({ ...loadRoomConfig(), random: () => 0.5 });
  const room = new Room(config);
  const shooter = new Client(room, config);
  const target = new Client(room, config);
  return { config, room, shooter, target };
}

// Give the target time to swing round before anything is fired.
function settle(room: Room, shooter: Client, target: Client): void {
  tick(room, [shooter, target], (c) => (c === target ? turnedAway() : idle()), 40);
}

function tick(room: Room, clients: Client[], input: (c: Client, i: number) => MechInput, count: number): void {
  for (let i = 0; i < count; i++) {
    for (const c of clients) c.send(input(c, i));
    room.tick();
  }
}

describe("shots", () => {
  it("hit the zone they were aimed at, tell the shooter, and hurt the target", () => {
    const { room, shooter, target, config } = setup();
    settle(room, shooter, target);
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 6);

    const hit = shooter.messages.find((m) => m.t === "hit");
    expect(hit).toMatchObject({ t: "hit", targetId: target.id, zone: ZONE_TORSO, damage: config.weapon.damage, killed: false });
    expect(target.last().health.hp[ZONE_TORSO]).toBe(100 - config.weapon.damage);
    expect(shooter.messages.find((m) => m.t === "shot")).toMatchObject({ hitMech: true });
  });

  it("are stopped by a wall in between", () => {
    const { room, shooter, target } = setup((c) => ({
      ...c, boxes: [...c.boxes, boxFromData({ name: "wall", center: [-18, 5, 0], size: [1, 10, 20], color: "" })],
    }));
    settle(room, shooter, target);
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 20);
    expect(shooter.messages.some((m) => m.t === "hit")).toBe(false);
    expect(target.last().health.hp[ZONE_TORSO]).toBe(100);
  });

  it("are checked against where the target was a moment ago (lag compensation)", () => {
    const run = (lagMs: number) => {
      const { room, shooter, target } = setup((c) => ({ ...c, combat: { ...c.combat, lagCompensationMs: lagMs, historyMs: 600 } }));
      // Both stand still, then the target dashes sideways just before the shot is fired.
      settle(room, shooter, target);
      tick(room, [shooter, target], (c) => (c === target ? turnedAway({ moveX: 1, run: true }) : idle()), 30);
      tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway({ moveX: 1, run: true })), 1);
      return shooter.messages.some((m) => m.t === "hit");
    };
    expect(run(0)).toBe(false);
    expect(run(500)).toBe(true);
  });

  it("destroy the mech when the torso is gone, then it respawns whole after a wait", () => {
    const { room, shooter, target, config } = setup();
    settle(room, shooter, target);
    tick(room, [shooter, target], (c) => (c === shooter ? idle(AT_TARGET) : turnedAway()), 120);
    const kill = shooter.messages.find((m) => m.t === "hit" && m.killed);
    expect(kill).toBeDefined();
    expect(target.last().health.dead).toBe(true);

    // A destroyed mech cannot move or fire.
    const before = { x: target.last().you.x, z: target.last().you.z };
    tick(room, [shooter, target], (c) => (c === target ? forward({ run: true, fire: true }) : idle()), 30);
    expect(target.last().you.x).toBeCloseTo(before.x);
    expect(target.last().you.z).toBeCloseTo(before.z);

    tick(room, [shooter, target], () => idle(), Math.ceil(config.combat.respawnSeconds * 60));
    expect(target.last().health.dead).toBe(false);
    expect(target.last().health.hp[ZONE_TORSO]).toBe(100);
  });
});

describe("grenades", () => {
  // Make the grenade drop where it is thrown and go off quickly, so the blast point is known.
  const dropBomb = (c: RoomConfig): RoomConfig => ({
    ...c, grenade: { ...c.grenade, throwSpeed: 0, throwLift: 0, fuseSeconds: 0.5 },
  });
  const THROW: Partial<MechInput> = { grenade: true, targetX: -21, targetY: 0, targetZ: 5 };

  it("go off after the fuse, hurt everyone in range including the thrower, and tell the shooter", () => {
    const { room, shooter, target } = setup(dropBomb);
    tick(room, [shooter, target], (c, i) => (c === shooter && i === 0 ? idle(THROW) : idle()), 60);

    expect(target.messages.some((m) => m.t === "grenade")).toBe(true);
    expect(target.messages.some((m) => m.t === "explode")).toBe(true);
    const thrower = shooter.last().health.hp;
    const bystander = target.last().health.hp;
    expect(thrower.every((hp, zone) => hp < [60, 60, 100][zone]!)).toBe(true);
    expect(bystander.some((hp, zone) => hp < [60, 60, 100][zone]!)).toBe(true);
    expect(thrower[ZONE_TORSO]!).toBeLessThan(bystander[ZONE_TORSO]!); // closer means more damage
  });

  it("are blocked by walls", () => {
    const { room, shooter, target } = setup((c) => ({
      ...dropBomb(c), boxes: [...c.boxes, boxFromData({ name: "wall", center: [-18, 5, 0], size: [1, 10, 20], color: "" })],
    }));
    tick(room, [shooter, target], (c, i) => (c === shooter && i === 0 ? idle(THROW) : idle()), 60);
    expect(target.last().health.hp).toEqual([60, 60, 100]);
  });

  it("have a cooldown", () => {
    const { room, shooter, target } = setup();
    tick(room, [shooter, target], (c) => (c === shooter ? idle({ grenade: true }) : idle()), 60);
    expect(target.messages.filter((m) => m.t === "grenade")).toHaveLength(1);
  });
});
