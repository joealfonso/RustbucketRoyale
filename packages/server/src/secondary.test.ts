import { describe, expect, it } from "vitest";
import { STEP, World, boxFromData, createAltFireState, createMechInput, createMechState, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { Bot } from "./Bot";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Room, RoomConfig } from "./Room";

// Gate 18a: right-click secondary fire, checked by the server. On the test range the players spawn in a row along
// x at -21, -15, -9..., so a shot from the first at the third's chest passes through the second on the way.
const withGun = (id: string) => (c: RoomConfig): RoomConfig => ({ ...c, weapons: { ...c.weapons, start: c.weapons.weapons.findIndex((w) => w.id === id) } });
const AT_SECOND = { targetX: -15, targetY: 2.4, targetZ: 0 };
const AT_THIRD = { targetX: -9, targetY: 2.4, targetZ: 0 };

function run(room: Room, clients: Client[], input: (c: Client, tick: number) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c, i)); room.tick(); }
}
const shots = (c: Client, from: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "shot" }> => m.t === "shot" && m.id === from.id);
const hitsOn = (c: Client, target: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "hit" }> => m.t === "hit" && m.targetId === target.id);

function setup(gun: string, players = 2) {
  const { room, config } = makeRoom(withGun(gun));
  const clients = Array.from({ length: players }, () => new Client(room, config));
  startMatch(room, clients[0]!);
  run(room, clients, () => idle(), 20);
  return { room, config, clients };
}

describe("the server's secondary fire", () => {
  it("refuses slugs faster than the slug's own rate, however the client holds the button", () => {
    const { room, config, clients } = setup("scattergun");
    const [shooter, target] = clients as [Client, Client];
    const slug = config.weapons.weapons.find((w) => w.id === "scattergun")!.secondary;
    if (slug.kind !== "slug") throw new Error("expected a slug");
    // Two seconds of the right button held, plus the left one for good measure: right wins, at the slug's rate.
    run(room, clients, (c) => (c === shooter ? idle({ altFire: true, fire: true, ...AT_SECOND }) : idle()), 120);
    const fired = shots(shooter, shooter);
    expect(fired.every((s) => s.alt === 1)).toBe(true);
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.length).toBeLessThanOrEqual(Math.ceil(2 * slug.shotsPerSecond));
    // One heavy hit each, not a spray of pellets.
    expect(hitsOn(shooter, target).length).toBe(fired.length);
    expect(hitsOn(shooter, target)[0]!.damage).toBeCloseTo(slug.damage, 0);
  });

  it("locks both triggers of an overheated autocannon until the vent ends", () => {
    const { room, config, clients } = setup("autocannon");
    const [shooter] = clients as [Client, Client];
    const ac = config.weapons.weapons.find((w) => w.id === "autocannon")!.secondary;
    if (ac.kind !== "windup") throw new Error("expected a windup");
    // Hold both buttons at a wall of air until it vents, noting every tick a shot went out and whether it was venting.
    let ventingShots = 0, ventingTicks = 0, seen = 0;
    for (let i = 0; i < 60 * 8; i++) {
      shooter.send(idle({ altFire: true, fire: true, targetX: -21, targetY: 2.4, targetZ: -50 }));
      room.tick();
      const now = shots(shooter, shooter).length;
      const venting = shooter.last().you.overheat > 0;
      if (venting) { ventingTicks++; if (now > seen) ventingShots++; }
      seen = now;
    }
    expect(ventingTicks).toBeGreaterThan(ac.overheatSeconds * 60 * 0.5);
    // The snapshot runs a few ticks behind, so the shot that tipped it over can land on a "venting" tick; nothing more.
    expect(ventingShots).toBeLessThanOrEqual(1);
    expect(shots(shooter, shooter).some((s) => s.alt !== undefined)).toBe(true);
  });

  it("pierces with a full charge, hitting the mech behind too, and pins both", () => {
    const { room, config, clients } = setup("spikeDriver", 3);
    const [shooter, second, third] = clients as [Client, Client, Client];
    const charge = config.weapons.weapons.find((w) => w.id === "spikeDriver")!.secondary;
    if (charge.kind !== "charge") throw new Error("expected a charge");
    const hold = Math.ceil(charge.chargeSeconds * 60) + 10;
    run(room, clients, (c, i) => (c === shooter ? idle({ altFire: i < hold, ...AT_THIRD }) : idle()), hold + 6);
    const fired = shots(shooter, shooter);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ alt: 1, pierce: true, hitMech: true });
    expect(hitsOn(shooter, second)).toHaveLength(1);
    expect(hitsOn(shooter, third)).toHaveLength(1);
    expect(room.secondaryCount).toMatchObject({ shots: 1, pierced: 1, pinned: 2 });
    for (const pinned of [second, third]) {
      expect(pinned.last().you.pinTime).toBeGreaterThan(0);
      expect(pinned.last().you.pinSpeed).toBeCloseTo(charge.pinSpeedShare, 5);
    }
    expect(shooter.last().others.find((o) => o.id === second.id)!.pinned).toBe(true);
  });

  it("does not pierce or pin with a part charge, and does less damage", () => {
    const { room, config, clients } = setup("spikeDriver", 3);
    const [shooter, second, third] = clients as [Client, Client, Client];
    const gun = config.weapons.weapons.find((w) => w.id === "spikeDriver")!;
    if (gun.secondary.kind !== "charge") throw new Error("expected a charge");
    const hold = Math.round(gun.secondary.chargeSeconds * 60 * 0.4);
    run(room, clients, (c, i) => (c === shooter ? idle({ altFire: i < hold, ...AT_THIRD }) : idle()), hold + 6);
    expect(shots(shooter, shooter)[0]?.pierce).toBeUndefined();
    expect(hitsOn(shooter, second)).toHaveLength(1);
    expect(hitsOn(shooter, second)[0]!.damage).toBeLessThan(gun.damage);
    expect(hitsOn(shooter, third)).toHaveLength(0);
    expect(second.last().you.pinTime).toBe(0);
  });

  it("fires a released charge at the aim point of the step the button comes up", () => {
    const { room, config, clients } = setup("spikeDriver", 2);
    const [shooter, target] = clients as [Client, Client];
    const charge = config.weapons.weapons.find((w) => w.id === "spikeDriver")!.secondary;
    if (charge.kind !== "charge") throw new Error("expected a charge");
    const hold = Math.ceil(charge.chargeSeconds * 60) + 10;
    // Charged while aiming off into the sky, swung onto the target only on the release step.
    const away = { targetX: -21, targetY: 30, targetZ: -50 };
    run(room, clients, (c, i) => (c === shooter ? idle(i < hold ? { altFire: true, ...away } : AT_SECOND) : idle()), hold + 3);
    expect(shots(shooter, shooter)).toHaveLength(1);
    expect(hitsOn(shooter, target)).toHaveLength(1);
  });

  it("throws a held charge away unfired when the countdown starts, as the client does", () => {
    const { room, config } = makeRoom(withGun("spikeDriver"));
    const shooter = new Client(room, config);
    new Client(room, config);
    for (let i = 0; i < 90; i++) { shooter.send(idle({ altFire: true, ...AT_SECOND })); room.tick(); }
    expect(shooter.last().you.charge).toBeGreaterThan(0);
    room.receive(shooter.id, JSON.stringify({ t: "start" }));
    for (let i = 0; i < 60; i++) { shooter.send(idle(AT_SECOND)); room.tick(); }
    expect(shots(shooter, shooter)).toHaveLength(0);
    expect(shooter.last().you.charge).toBe(0);
  });

  it("shows another mech's spin up to everyone near", () => {
    const { room, clients } = setup("autocannon", 2);
    const [shooter, watcher] = clients as [Client, Client];
    run(room, clients, (c) => (c === shooter ? idle({ altFire: true, targetX: -21, targetY: 2.4, targetZ: -50 }) : idle()), 45);
    expect(watcher.last().others.find((o) => o.id === shooter.id)!.spin).toBeGreaterThan(0.3);
    run(room, clients, () => idle(), 200);
    expect(watcher.last().others.find((o) => o.id === shooter.id)!.spin).toBe(0);
  });

  it("slows a pinned mech's walk, and its own prediction agrees", () => {
    const { room, config, clients } = setup("spikeDriver", 2);
    const [shooter, target] = clients as [Client, Client];
    const charge = config.weapons.weapons.find((w) => w.id === "spikeDriver")!.secondary;
    if (charge.kind !== "charge") throw new Error("expected a charge");
    const hold = Math.ceil(charge.chargeSeconds * 60) + 10;
    run(room, clients, (c, i) => (c === shooter ? idle({ altFire: i < hold, ...AT_SECOND }) : idle()), hold + 3);
    expect(target.last().you.pinTime).toBeGreaterThan(0);
    // The pin itself is news to the target's client (one correction, like a shove); from then on it predicts it.
    target.predictor.reconcile(target.last().ack, target.last().you, STEP);
    const startZ = target.last().you.z;
    // Walk forward (+Z at yaw PI) for half a second while pinned.
    run(room, clients, (c) => (c === target ? idle({ moveY: 1 }) : idle()), 30);
    const walked = Math.abs(target.last().you.z - startZ);
    expect(walked).toBeLessThan(config.mech.walkSpeed * 0.5 * charge.pinSpeedShare * 1.3);
    expect(walked).toBeGreaterThan(0);
    expect(target.predictor.reconcile(target.last().ack, target.last().you, STEP)).toBeLessThan(0.01);
  });
});

describe("bots with secondaries", () => {
  const config = loadRoomConfig();
  const stats = config.bots.difficulties.normal!;
  const always = () => 0;
  const flat = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "" })]);
  const gun = (id: string) => config.weapons.weapons.find((w) => w.id === id)!.secondary;

  // Thinks for three seconds at a target `distance` ahead and returns every step's input.
  function fight(id: string, distance: number, heat = 0, targetMoves = false) {
    const bot = new Bot(stats, always, config.bots.path, null, 2, config.botAbilities);
    bot.secondary = gun(id);
    const alt = createAltFireState();
    alt.heat = heat;
    bot.alt = alt;
    const self = createMechState(config.mech, 0, 0, 0, 0);
    const input = createMechInput();
    const steps: MechInput[] = [];
    for (let i = 0; i < 180; i++) {
      const z = -distance + (targetMoves ? Math.sin(i / 10) * 3 : 0);
      bot.think(self, [{ id: 2, x: 0, y: 0, z }], null, flat, 1 / 60, input);
      steps.push({ ...input });
      if (id === "spikeDriver" && input.altFire) alt.charge = Math.min(alt.charge + 1 / 60, 10); // a charge that keeps building
    }
    return steps;
  }

  it("fire slugs at range and pellets up close", () => {
    const b = config.botAbilities.secondary;
    expect(fight("scattergun", b.slugMinRange + 10).some((s) => s.altFire)).toBe(true);
    const close = fight("scattergun", b.slugMinRange / 2);
    expect(close.some((s) => s.fire)).toBe(true);
    expect(close.some((s) => s.altFire)).toBe(false);
  });

  it("spin up an autocannon in a close fight, and let go of it when hot", () => {
    const b = config.botAbilities.secondary;
    expect(fight("autocannon", b.windupMaxRange / 2).some((s) => s.altFire)).toBe(true);
    const hot = fight("autocannon", b.windupMaxRange / 2, b.windupHeatLimit);
    expect(hot.some((s) => s.altFire)).toBe(false);
    expect(hot.some((s) => s.fire)).toBe(true);
  });

  it("charge a spike on a still target, hold it, then let go once it is full", () => {
    const steps = fight("spikeDriver", 20);
    const first = steps.findIndex((s) => s.altFire);
    expect(first).toBeGreaterThanOrEqual(0);
    const released = steps.findIndex((s, i) => i > first && !s.altFire);
    expect(released).toBeGreaterThan(first + 60); // held for the full charge (1.2 s)
    expect(steps[released]!.fire).toBe(false); // the release is the shot, not a left click on top
  });

  it("fire secondaries in a real room against a person", () => {
    const { room, config: c } = makeRoom(withGun("autocannon"), "small", 1);
    const person = new Client(room, c);
    run(room, [person], () => idle(), 60 * 4);
    expect(room.secondaryCount.shots).toBeGreaterThan(0);
  });
});
