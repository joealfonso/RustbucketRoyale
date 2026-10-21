import { describe, expect, it } from "vitest";
import {
  ITEM_GRENADE, STEP, World, boxFromData, computeShot, createAltFireState, createMechInput, createMechState, createRayHit, createShot, flightSteps, reelPoint,
  type MechInput, type ServerMessage,
} from "@rustbucket/shared";
import { Bot } from "./Bot";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Room, RoomConfig } from "./Room";

// Gate 18b: the rivet gun and the magnet harpoon, checked by the server. On the test range the players spawn in a
// row along x at -21, -15, -9..., facing +Z; there is a crate at (-6, 18) and a 4 m high block ("Cover B") from
// x -11.5 to -8.5, z 30 to 40.
const withGun = (id: string, patch: (c: RoomConfig) => RoomConfig = (c) => c) => (c: RoomConfig): RoomConfig =>
  patch({ ...c, weapons: { ...c.weapons, start: c.weapons.weapons.findIndex((w) => w.id === id) } });
const AT_SECOND = { targetX: -15, targetY: 2.4, targetZ: 0 };
const AT_SKY = { targetX: -21, targetY: 40, targetZ: 30 };
const AT_GROUND = { targetX: -21, targetY: 0, targetZ: 12 };

type Of<T extends ServerMessage["t"]> = Extract<ServerMessage, { t: T }>;
const all = <T extends ServerMessage["t"]>(c: Client, t: T) => c.messages.filter((m): m is Of<T> => m.t === t);

function run(room: Room, clients: Client[], input: (c: Client, tick: number) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c, i)); room.tick(); }
}

function setup(gun: string, players = 2, patch?: (c: RoomConfig) => RoomConfig) {
  const { room, config } = makeRoom(withGun(gun, patch));
  const clients = Array.from({ length: players }, () => new Client(room, config));
  startMatch(room, clients[0]!);
  run(room, clients, () => idle(), 20);
  const weapon = config.weapons.weapons.find((w) => w.id === gun)!;
  return { room, config, clients, weapon };
}

const rivetsOf = (config: RoomConfig) => {
  const p = config.weapons.weapons.find((w) => w.id === "rivetGun")!.projectile;
  if (p.kind !== "rivet") throw new Error("expected rivets");
  return p;
};

describe("rivets", () => {
  it("stick to the mech they hit, ride on it, and pop through the blast code after the fuse", () => {
    const { room, config, clients } = setup("rivetGun");
    const [shooter, target] = clients as [Client, Client];
    const rivet = rivetsOf(config);
    // One rivet, then the target walks off with it.
    run(room, clients, (c, i) => (c === shooter ? idle({ fire: i === 0, ...AT_SECOND }) : idle()), 10);
    const stuck = all(target, "rivet").filter((m) => m.event === "stick");
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!).toMatchObject({ owner: shooter.id, on: target.id, fuse: rivet.fuseSeconds });
    expect(stuck[0]!.lx).toBeDefined();
    run(room, clients, (c) => (c === target ? idle({ moveY: 1 }) : idle()), Math.round(rivet.fuseSeconds * 60));
    const pop = all(target, "explode").find((m) => m.rivet === stuck[0]!.id)!;
    expect(pop).toBeDefined();
    // It popped where the target had walked to, not where it was hit.
    expect(pop.z).toBeGreaterThan(stuck[0]!.z + 3);
    expect(Math.abs(pop.z - target.last().you.z)).toBeLessThan(1.5);
    expect(room.projectileCount).toMatchObject({ rivetsStuck: 1, rivetsPopped: 1 });
    // The rivet's own hit plus its blast on every zone.
    const hits = all(shooter, "hit").filter((h) => h.targetId === target.id);
    expect(hits).toHaveLength(2);
    expect(hits[1]!.zone).toBe(-1);
  });

  it("stick to the ground with the surface's facing, and pop there", () => {
    const { room, clients } = setup("rivetGun");
    const [shooter] = clients as [Client, Client];
    run(room, clients, (c, i) => (c === shooter ? idle({ fire: i === 0, ...AT_GROUND }) : idle()), 120);
    const stuck = all(shooter, "rivet").find((m) => m.event === "stick")!;
    expect(stuck.on).toBeUndefined();
    expect(stuck.ny).toBeCloseTo(1, 5);
    expect(all(shooter, "explode").some((m) => m.rivet === stuck.id && Math.abs(m.z - stuck.z) < 1e-6)).toBe(true);
  });

  it("all pop at once on right-click, before their fuse", () => {
    const { room, config, clients, weapon } = setup("rivetGun");
    const [shooter] = clients as [Client, Client];
    // Three rivets into the ground, then right-click while they are still burning.
    const gap = Math.ceil(60 / weapon.shotsPerSecond) + 1;
    run(room, clients, (c, i) => (c === shooter ? idle({ fire: i === 0 || i === gap || i === gap * 2, ...AT_GROUND }) : idle()), gap * 2 + 10);
    expect(all(shooter, "rivet").filter((m) => m.event === "stick")).toHaveLength(3);
    expect(all(shooter, "explode")).toHaveLength(0);
    run(room, clients, (c, i) => (c === shooter ? idle({ altFire: i < 5 }) : idle()), 6);
    expect(all(shooter, "rivet").filter((m) => m.event === "detonate")).toHaveLength(1);
    expect(all(shooter, "explode").filter((m) => m.rivet !== undefined)).toHaveLength(3);
    expect(gap * 2 + 16).toBeLessThan(rivetsOf(config).fuseSeconds * 60 + gap * 2);
    expect(room.secondaryCount.detonate).toBe(1);
  });

  it("are capped per player: one more pops the oldest early", () => {
    const capped = (c: RoomConfig): RoomConfig => ({
      ...c, weapons: { ...c.weapons, weapons: c.weapons.weapons.map((w) => (w.projectile.kind === "rivet" ? { ...w, projectile: { ...w.projectile, maxStuck: 2, fuseSeconds: 30 } } : w)) },
    });
    const { room, clients, weapon } = setup("rivetGun", 2, capped);
    const [shooter] = clients as [Client, Client];
    const gap = Math.ceil(60 / weapon.shotsPerSecond) + 1;
    run(room, clients, (c, i) => (c === shooter ? idle({ fire: i % gap === 0, ...AT_GROUND }) : idle()), gap * 4);
    expect(all(shooter, "rivet").filter((m) => m.event === "stick")).toHaveLength(4);
    // Fuses of 30 s: only the cap can have popped these.
    expect(all(shooter, "explode")).toHaveLength(2);
  });

  it("are refused faster than the gun's rate, however the client holds the trigger", () => {
    const { room, clients, weapon } = setup("rivetGun");
    const [shooter] = clients as [Client, Client];
    run(room, clients, (c) => (c === shooter ? idle({ fire: true, ...AT_SKY }) : idle()), 120);
    const fired = all(shooter, "shot").filter((s) => s.id === shooter.id).length;
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThanOrEqual(Math.ceil(2 * weapon.shotsPerSecond));
  });
});

describe("the magnet harpoon", () => {
  const harpoonOf = (config: RoomConfig) => {
    const p = config.weapons.weapons.find((w) => w.id === "magnetHarpoon")!.projectile;
    if (p.kind !== "harpoon") throw new Error("expected a harpoon");
    return p;
  };

  it("yanks a mech it hits toward the shooter, and the yanked mech's prediction follows from the snapshot", () => {
    const { room, config, clients } = setup("magnetHarpoon", 3);
    const [shooter, , target] = clients as [Client, Client, Client];
    const harpoon = harpoonOf(config);
    // The third player stands at x -9; move it out of line with the second first, 12 m up the range.
    run(room, clients, (c) => (c === target ? idle({ moveY: 1 }) : idle()), 150);
    const t0 = target.last().you;
    const before = Math.hypot(t0.x - -21, t0.z);
    run(room, clients, (c, i) => (c === shooter ? idle({ fire: i === 0, targetX: t0.x, targetY: t0.y + 2.4, targetZ: t0.z }) : idle()), 8);
    const landed = all(target, "harpoon");
    expect(landed).toHaveLength(1);
    expect(landed[0]!).toMatchObject({ id: shooter.id, reel: false, hit: "mech", target: target.id });
    expect(landed[0]!.seconds).toBeGreaterThan(0);
    expect(target.last().you.pullTime).toBeGreaterThan(0);
    // Its own client learns of the yank from the snapshot (one correction), then predicts the rest exactly.
    target.predictor.reconcile(target.last().ack, target.last().you, STEP);
    run(room, clients, () => idle(), 50);
    const after = target.last().you;
    expect(Math.hypot(after.x - -21, after.z)).toBeLessThan(before - 8);
    expect(Math.hypot(after.x - -21, after.z)).toBeGreaterThan(harpoon.yankStopMeters / 4);
    expect(target.predictor.reconcile(target.last().ack, target.last().you, STEP)).toBeLessThan(0.01);
    expect(room.projectileCount.yanks).toBe(1);
    expect(all(shooter, "hit").filter((h) => h.targetId === target.id)).toHaveLength(1);
  });

  it("pulls a pickup it hits to the shooter's feet, keeping its id, its position sent while it slides", () => {
    const { room, config, clients } = setup("magnetHarpoon");
    const [shooter] = clients as [Client, Client];
    const harpoon = harpoonOf(config);
    const placed = (room as unknown as { pickups: { add(item: number, x: number, y: number, z: number): { id: number } } }).pickups.add(ITEM_GRENADE, -21, 0.5, 30);
    run(room, clients, (c, i) => (c === shooter ? idle({ fire: i === 0, targetX: -21, targetY: 0.5, targetZ: 30 }) : idle()), 6);
    const zs: number[] = [];
    for (let i = 0; i < 60; i++) {
      shooter.send(idle()); room.tick();
      const p = shooter.last().pickups.find((q) => q.id === placed.id);
      if (p && zs.at(-1) !== p.z) zs.push(p.z);
    }
    expect(all(shooter, "harpoon")[0]!).toMatchObject({ hit: "pickup", target: placed.id, seconds: harpoon.itemPullSeconds });
    expect(zs.length).toBeGreaterThan(3); // seen part way, not only at the end
    expect(zs.at(-1)!).toBeCloseTo(harpoon.itemStopMeters, 0);
    expect(room.projectileCount.itemsPulled).toBe(1);
  });

  // A weapon, since grenades and plates pulled to your feet are walked over and taken at once.
  it("smashes a crate open and pulls its loot to the shooter", () => {
    const loot = (c: RoomConfig): RoomConfig => ({ ...c, loot: { ...c.loot, drops: { ...c.loot.drops, crate: { chance: 1, table: { scattergun: 1 } } } } });
    const { room, config, clients } = setup("magnetHarpoon", 2, loot);
    const [shooter] = clients as [Client, Client];
    run(room, clients, (c, i) => (c === shooter ? idle({ fire: i === 0, targetX: -6, targetY: 1, targetZ: 18 }) : idle()), 70);
    const landed = all(shooter, "harpoon")[0]!;
    expect(landed).toMatchObject({ hit: "prop" });
    expect(landed.loot).toBeDefined();
    expect(all(shooter, "prop")).toHaveLength(1);
    const p = shooter.last().pickups.find((q) => q.id === landed.loot)!;
    expect(Math.hypot(p.x - -21, p.z)).toBeLessThan(harpoonOf(config).itemStopMeters + 0.5);
    expect(room.projectileCount.cratesSmashed).toBe(1);
  });

  it("reels the shooter up to a ledge it hits, and a client that books the same reel predicts it", () => {
    const { room, config, clients, weapon } = setup("magnetHarpoon");
    const [shooter] = clients as [Client, Client];
    const reel = weapon.secondary;
    if (reel.kind !== "reel") throw new Error("expected a reel");
    const aim = { targetX: -10, targetY: 3.6, targetZ: 30 };
    shooter.send(idle({ altFire: true, ...aim }));
    // The client's half: the same shot, the world's answer, and the pull booked for the step it lands on.
    const map = config.mapFor("small", 0);
    const shot = createShot(), hit = createRayHit();
    computeShot(shooter.predictor.state, aim.targetX, aim.targetY, aim.targetZ, { ...weapon, spreadDegrees: 0 }, () => 0.5, shot);
    expect(map.world.raycast(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, weapon.maxAimDistance, hit)).toBe(true);
    const goal = { x: 0, y: 0, z: 0 };
    reelPoint(shot.ox + shot.dx * hit.distance + hit.normalX * 0.1, shot.oy + shot.dy * hit.distance + hit.normalY * 0.1, shot.oz + shot.dz * hit.distance + hit.normalZ * 0.1, hit.normalX, hit.normalY, hit.normalZ, reel, goal);
    shooter.predictor.pullAfter(shooter.predictor.seq + flightSteps(hit.distance, weapon), goal.x, goal.y, goal.z, reel.speed, reel.maxSeconds, reel.stopMeters, 0);
    room.tick();
    let highest = 0;
    for (let i = 0; i < 150; i++) { shooter.send(idle()); room.tick(); highest = Math.max(highest, shooter.last().you.y); }
    const reeled = all(shooter, "harpoon").find((m) => m.reel)!;
    expect(reeled).toMatchObject({ hit: "world" });
    expect(reeled.seconds).toBeGreaterThan(0.5);
    const you = shooter.last().you;
    expect(highest).toBeGreaterThan(4);
    expect(you.z).toBeGreaterThan(25);
    expect(room.projectileCount.reels).toBe(1);
    expect(shooter.predictor.reconcile(shooter.last().ack, you, STEP)).toBeLessThan(0.01);
  });

  it("waits out its cooldown between harpoons, primary or reel, whatever the client sends", () => {
    const { room, clients, weapon } = setup("magnetHarpoon");
    const [shooter] = clients as [Client, Client];
    run(room, clients, (c, i) => (c === shooter ? idle({ fire: true, altFire: i % 3 === 0, ...AT_SKY }) : idle()), 60 * 4);
    const fired = all(shooter, "shot").filter((s) => s.id === shooter.id).length;
    expect(fired).toBe(Math.floor(4 * weapon.shotsPerSecond));
    // Into the sky they miss: each lets go with a "none".
    expect(all(shooter, "harpoon").every((m) => m.hit === "none")).toBe(true);
  });
});

describe("bots with the rivet gun and the harpoon", () => {
  const config = loadRoomConfig();
  const stats = config.bots.difficulties.normal!;
  const flat = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "" })]);
  const weapon = (id: string) => config.weapons.weapons.find((w) => w.id === id)!;

  function brain(id: string, random = () => 0) {
    const bot = new Bot(stats, random, config.bots.path, null, 2, config.botAbilities);
    bot.weapon = weapon(id);
    bot.secondary = weapon(id).secondary;
    bot.alt = createAltFireState();
    return bot;
  }
  // Thinks for `seconds` at a target that starts `distance` ahead and moves `away` m/s further off.
  function fight(bot: Bot, distance: number, away = 0, world = flat, seconds = 3, each?: (i: number) => void) {
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    const steps: MechInput[] = [];
    for (let i = 0; i < seconds * 60; i++) {
      each?.(i);
      bot.think(self, [{ id: 2, x: 0, y: 0, z: -distance - (away * i) / 60 }], null, world, 1 / 60, input);
      steps.push({ ...input });
    }
    return steps;
  }

  it("harpoon a distant or fleeing mech, and leave a close still one alone", () => {
    const b = config.botAbilities.secondary;
    expect(fight(brain("magnetHarpoon"), b.harpoonMinRange + 10).some((s) => s.fire)).toBe(true);
    expect(fight(brain("magnetHarpoon"), b.harpoonMinRange / 2, b.harpoonFleeSpeed + 3).some((s) => s.fire)).toBe(true);
    expect(fight(brain("magnetHarpoon"), b.harpoonMinRange / 2).some((s) => s.fire)).toBe(false);
  });

  it("pop their rivets with a fresh press once enough ride mechs nearby", () => {
    const bot = brain("rivetGun");
    const steps = fight(bot, 15, 0, flat, 2, (i) => { bot.rivetsReady = i >= 60 ? config.botAbilities.secondary.detonateMinRivets : 0; });
    expect(steps.slice(0, 60).some((s) => s.altFire)).toBe(false);
    const later = steps.slice(60);
    expect(later.some((s) => s.altFire)).toBe(true);
    expect(later.some((s) => !s.altFire)).toBe(true); // let go between presses
    expect(steps.some((s) => s.fire)).toBe(true);
  });

  it("reel away from a fight when hurt, at a wall behind it", () => {
    const wall = boxFromData({ name: "w", center: [0, 5, 30], size: [60, 10, 2], color: "" });
    const walled = new World([...flat.boxes, wall]);
    const bot = brain("magnetHarpoon");
    bot.noteHealth(100);
    bot.noteHealth(50); // just hit
    const steps = fight(bot, 15, 0, walled, 1.5);
    const reel = steps.find((s) => s.altFire)!;
    expect(reel).toBeDefined();
    expect(reel.targetZ).toBeGreaterThan(25); // behind it, away from the target at -15
  });

  it("use both in a real room", () => {
    for (const id of ["rivetGun", "magnetHarpoon"]) {
      const { room, config: c } = makeRoom(withGun(id), "small", 6);
      const person = new Client(room, c);
      run(room, [person], () => idle(), 60 * 8);
      if (id === "rivetGun") expect(room.projectileCount.rivetsStuck).toBeGreaterThan(0);
      else expect(room.projectileCount.harpoons).toBeGreaterThan(0);
    }
  });
});
