import { describe, expect, it } from "vitest";
import {
  World, ZONE_ARMS, ZONE_TORSO, boxFromData, createMechInput, createMechState, stepMech, type BarrageStats, type DecoyStats, type MechInput, type RailStats, type RamStats, type ServerMessage,
} from "@rustbucket/shared";
import { Bot } from "./Bot";
import { loadRoomConfig } from "./config";
import { Client, forward, idle, makeRoom, startMatch, tickRoom } from "./testClient";
import type { Room, RoomConfig } from "./Room";

// On the test range the first player spawns at (-21, 0, 0) and the second at (-15, 0, 0). Yaw -PI/2 looks down +X,
// from the first toward the second.
const TOWARD_SECOND = -Math.PI / 2;
const withRoster = (c: RoomConfig): RoomConfig => {
  const { roster, kitHitboxes } = loadRoomConfig({ roster: true });
  return { ...c, roster, kitHitboxes };
};
const mechIndex = (c: RoomConfig, id: string) => c.roster!.mechs.findIndex((m) => m.id === id);
const pick = (room: Room, c: Client, mech: number) => room.receive(c.id, JSON.stringify({ t: "mech", mech }));

function run(room: Room, clients: Client[], input: (c: Client) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c)); room.tick(); }
}
const abilityMessages = (c: Client, event?: string) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: "ability" }> => m.t === "ability" && (event === undefined || m.event === event));
const hitsOn = (c: Client, targetId: number) => c.messages.filter((m): m is Extract<ServerMessage, { t: "hit" }> => m.t === "hit" && m.targetId === targetId);
const where = (room: Room, c: Client) => room.inspect().find((p) => p.id === c.id)!;

// Moves one spawn on the test range, keeping the rest.
const spawnAt = (slot: number, x: number, z: number) => (c: RoomConfig): RoomConfig => {
  const map = c.mapFor("small", 0);
  const spawns = map.spawns.map((s, i): [number, number, number] => (i === slot ? [x, 0.1, z] : s));
  return { ...c, mapFor: () => ({ ...c.mapFor("small", 0), spawns }) };
};
const withAbility = (id: string, change: Record<string, number>) => (c: RoomConfig): RoomConfig =>
  ({ ...c, abilities: { mechs: { ...c.abilities.mechs, [id]: { ...c.abilities.mechs[id]!, ...change } } } });
const both = (...patches: ((c: RoomConfig) => RoomConfig)[]) => (c: RoomConfig) => patches.reduce((acc, p) => p(acc), c);

// Two people in a running match on the roster: the first drives `first`, the second `second`.
function duel(first: string, second: string, patch: (c: RoomConfig) => RoomConfig = (c) => c) {
  const { room, config } = makeRoom((c) => patch(withRoster(c)));
  const a = new Client(room, config), b = new Client(room, config);
  b.lagMs = 0; // its shots are checked against where things are now, which keeps the shield test exact
  pick(room, a, mechIndex(config, first));
  pick(room, b, mechIndex(config, second));
  startMatch(room, a);
  run(room, [a, b], (c) => idle({ aimYaw: c === a ? TOWARD_SECOND : Math.PI / 2 }), 30); // land and turn to face each other
  return { room, config, a, b };
}

describe("Shield Ram", () => {
  it("charges the Ironclad forward, and hurts and shoves a mech in its path once", () => {
    const { room, a, b } = duel("ironclad", "arbiter");
    const startX = where(room, a).x, targetX = where(room, b).x;
    run(room, [a, b], (c) => idle({ aimYaw: c === a ? TOWARD_SECOND : Math.PI / 2, ability: c === a }), 1);
    run(room, [a, b], (c) => idle({ aimYaw: c === a ? TOWARD_SECOND : Math.PI / 2 }), 60);

    expect(where(room, a).x - startX).toBeGreaterThan(12);
    expect(abilityMessages(a, "start")).toHaveLength(1);
    expect(abilityMessages(b, "hit")).toHaveLength(1);
    expect(hitsOn(a, b.id)).toHaveLength(1);
    expect(hitsOn(a, b.id)[0]).toMatchObject({ zone: -1, killed: false });
    const hp = b.last().health.hp;
    expect(hp[ZONE_ARMS]).toBeLessThan(60);
    expect(hp[ZONE_TORSO]).toBeLessThan(100);
    expect(where(room, b).x - targetX).toBeGreaterThan(2); // sent sliding the way the ram was going
  });

  it("waits out its cooldown before it can charge again", () => {
    const { room, config, a, b } = duel("ironclad", "arbiter");
    const cooldown = config.abilities.mechs.ironclad!.cooldownSeconds;
    run(room, [a, b], (c) => idle({ ability: c === a }), Math.round((cooldown - 1) * 60));
    expect(abilityMessages(a, "start")).toHaveLength(1);
    run(room, [a, b], (c) => idle({ ability: c === a }), 120);
    expect(abilityMessages(a, "start")).toHaveLength(2);
  });

  it("does nothing for a mech without an ability", () => {
    // Every roster mech has one now, so the Cataclysm's is taken away for this.
    const withoutStrike = (c: RoomConfig): RoomConfig => {
      const mechs = { ...c.abilities.mechs };
      delete mechs.cataclysm;
      return { ...c, abilities: { mechs } };
    };
    const { room, a, b } = duel("cataclysm", "arbiter", withoutStrike);
    const startX = where(room, a).x;
    run(room, [a, b], (c) => idle({ aimYaw: TOWARD_SECOND, ability: c === a }), 60);
    expect(abilityMessages(a)).toHaveLength(0);
    expect(a.last().you.abilityTime).toBe(0);
    expect(Math.abs(where(room, a).x - startX)).toBeLessThan(0.01);
  });

  it("takes only part of the damage from shots on its shield while charging", () => {
    const { room, config, a, b } = duel("ironclad", "arbiter");
    const atA = (): Partial<MechInput> => { const p = where(room, a); return { fire: true, targetX: p.x, targetY: p.y + 2.4, targetZ: p.z }; };
    run(room, [a, b], (c) => (c === b ? idle({ aimYaw: Math.PI / 2, ...atA() }) : idle({ aimYaw: TOWARD_SECOND })), 1);
    run(room, [a, b], (c) => idle({ aimYaw: c === a ? TOWARD_SECOND : Math.PI / 2 }), 60); // the fire gate opens again
    run(room, [a, b], (c) => (c === b ? idle({ aimYaw: Math.PI / 2, ...atA() }) : idle({ aimYaw: TOWARD_SECOND, ability: true })), 2);

    const [plain, shielded] = hitsOn(b, a.id);
    expect(shielded?.zone).toBe(plain?.zone);
    expect(shielded!.damage).toBeCloseTo(plain!.damage * (config.abilities.mechs.ironclad as RamStats).frontDamageMultiplier, 3);
  });

  it("smashes a crate it drives into and keeps going", () => {
    // The test range has a crate at (-6, 18). The Ironclad starts 10 m short of it, facing it.
    const nearCrate = (c: RoomConfig): RoomConfig => {
      const map = c.mapFor("small", 0);
      const spawns = map.spawns.map((s, i): [number, number, number] => (i === 0 ? [-6, 0.1, 8] : s));
      return { ...c, mapFor: () => ({ ...c.mapFor("small", 0), spawns }) };
    };
    const { room, a, b } = duel("ironclad", "arbiter", nearCrate);
    run(room, [a, b], (c) => idle({ aimYaw: Math.PI, ability: c === a }), 1);
    run(room, [a, b], () => idle({ aimYaw: Math.PI }), 60);
    expect(b.messages.some((m) => m.t === "prop" && m.id === 0)).toBe(true);
    expect(where(room, a).z).toBeGreaterThan(19);
  });
});

describe("Pounce", () => {
  it("lands on the aim point and slams a mech standing there", () => {
    const { room, a, b } = duel("stiletto", "arbiter");
    const target = where(room, b);
    run(room, [a, b], (c) => idle({ aimYaw: TOWARD_SECOND, ability: c === a, targetX: target.x, targetY: target.y, targetZ: target.z }), 1);
    run(room, [a, b], () => idle({ aimYaw: TOWARD_SECOND }), 90);

    expect(abilityMessages(a, "start")).toHaveLength(1);
    const land = abilityMessages(b, "land")[0];
    expect(land).toBeDefined();
    expect(Math.hypot(land!.x - target.x, land!.z - target.z)).toBeLessThan(1.5);
    expect(hitsOn(a, b.id)).toHaveLength(1);
    expect(b.last().health.hp[ZONE_TORSO]).toBeLessThan(100);
  });
});

describe("abilities and the match", () => {
  it("are off during the countdown", () => {
    const { room, config } = makeRoom(withRoster);
    const a = new Client(room, config), b = new Client(room, config);
    pick(room, a, mechIndex(config, "ironclad"));
    room.receive(a.id, JSON.stringify({ t: "start" }));
    run(room, [a, b], (c) => idle({ ability: c === a }), 6);
    expect(room.matchState).toBe("countdown");
    expect(abilityMessages(a)).toHaveLength(0);
    expect(a.last().you.abilityCooldown).toBe(0);
    tickRoom(room, 20);
    run(room, [a, b], (c) => idle({ ability: c === a }), 30);
    expect(abilityMessages(a, "start")).toHaveLength(1);
  });
});

describe("bots with abilities", () => {
  const botsFile = loadRoomConfig();
  const stats = botsFile.bots.difficulties.normal!;
  const always = () => 0; // every chance roll comes up yes
  const flat = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "" })]);

  function thinkAt(kind: "ram" | "pounce", x: number, z: number): MechInput {
    const bot = new Bot(stats, always, botsFile.bots.path, null, 2, botsFile.botAbilities);
    bot.abilityKind = kind;
    const self = createMechState(botsFile.mech, 0, 0, 0, 0);
    const input = createMechInput();
    let pressed: MechInput | null = null;
    // Give it time to turn toward the target first; keep the first step it pressed Q.
    for (let i = 0; i < 120; i++) {
      bot.think(self, [{ id: 2, x, y: 0, z }], null, flat, 1 / 60, input);
      if (input.ability && !pressed) pressed = { ...input };
    }
    return pressed ?? input;
  }

  it("run sideways out from under a Rail Shot laser, dashing as they go, and decide once per laser", () => {
    const bot = new Bot(stats, always, botsFile.bots.path, null, 2, botsFile.botAbilities);
    const self = createMechState(botsFile.mech, 0, 0, 0, 0);
    const input = createMechInput();
    bot.laserOn(7, 1, 0, 1.2); // the laser runs along z; +x is away from it
    bot.think(self, [], null, flat, 1 / 60, input);
    expect(input.dash).toBe(true);
    for (let i = 0; i < 60; i++) { bot.think(self, [], null, flat, 1 / 60, input); stepMech(self, input, botsFile.mech, 1 / 60, flat, null); }
    expect(self.x).toBeGreaterThan(3);
    const again = new Bot(stats, () => 0.99, botsFile.bots.path, null, 2, botsFile.botAbilities); // a roll that says no
    again.laserOn(8, 1, 0, 1.2);
    again.think(createMechState(botsFile.mech, 0, 0, 0, 0), [], null, flat, 1 / 60, input);
    expect(input.dash).toBe(false);
  });

  it("ram a target lined up in front, not one off to the side or too far", () => {
    const { botAbilities: b } = botsFile;
    expect(thinkAt("ram", 0, -(b.ramMinRange + 4)).ability).toBe(true);
    expect(thinkAt("ram", 0, -(b.ramMaxRange + 10)).ability).toBe(false);
    expect(thinkAt("ram", 0, -(b.ramMinRange / 2)).ability).toBe(false);
  });

  it("pounce onto a target at middling range, aiming at it", () => {
    const { botAbilities: b } = botsFile;
    const distance = (b.pounceMinRange + b.pounceMaxRange) / 2;
    const input = thinkAt("pounce", 0, -distance);
    expect(input.ability).toBe(true);
    expect(input.targetZ).toBeCloseTo(-distance, 3);
    expect(input.fire).toBe(false);
    expect(thinkAt("pounce", 0, -(b.pounceMinRange / 2)).ability).toBe(false);
  });

  it("use them in a real fight between bots", () => {
    const { room, config } = makeRoom(withRoster, "small", 7);
    const watcher = new Client(room, config); // bots near a person think in full, and the person is told what they do
    run(room, [watcher], () => idle(), 60 * 60);
    const kinds = new Set(abilityMessages(watcher, "start").map((m) => m.kind));
    expect(kinds.has("ram")).toBe(true);
    expect(kinds.has("pounce")).toBe(true);
  });

  it("call mortar strikes and drop decoys on a real map", () => {
    // On the flat test range bots bunch up closer than a strike is worth, so this one has a generated map's room.
    const generated = (c: RoomConfig): RoomConfig => ({ ...withRoster(c), mapFor: loadRoomConfig({ maps: "generated" }).mapFor });
    const { room, config } = makeRoom(generated, "small", 7);
    const watcher = new Client(room, config);
    let sawDecoys = false;
    for (let second = 0; second < 60; second++) {
      run(room, [watcher], () => idle(), 60);
      sawDecoys ||= room.decoyCount > 0;
    }
    // Strikes are announced to anyone near; decoys only to their owner, so the room is asked.
    expect(abilityMessages(watcher, "start").some((m) => m.kind === "barrage")).toBe(true);
    expect(sawDecoys).toBe(true);
  });
});

const explosions = (c: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "explode" }> => m.t === "explode");

describe("Mortar Strike", () => {
  const far = spawnAt(1, 30, 0); // the second player 51 m off, inside the strike's range

  it("brings shells down round the aim point only after the warning, hurting a mech there for the Cataclysm", () => {
    const { room, config, a, b } = duel("cataclysm", "arbiter", far);
    const strike = config.abilities.mechs.cataclysm as BarrageStats;
    const target = where(room, b);
    run(room, [a, b], (c) => idle({ aimYaw: c === a ? TOWARD_SECOND : Math.PI / 2, ability: c === a, targetX: target.x, targetY: target.y, targetZ: target.z }), 1);

    const start = abilityMessages(b, "start")[0]!;
    expect(start).toMatchObject({ id: a.id, kind: "barrage" });
    expect(start.x).toBeCloseTo(target.x, 3);
    expect(start.z).toBeCloseTo(target.z, 3);
    expect(start.y).toBeCloseTo(0, 3); // the top of the ground, found under the aim point
    expect(abilityMessages(a, "start")).toHaveLength(1);

    run(room, [a, b], () => idle({ aimYaw: Math.PI / 2 }), Math.round(strike.delaySeconds * 60) - 2);
    expect(explosions(b)).toHaveLength(0);
    expect(hitsOn(a, b.id)).toHaveLength(0);

    run(room, [a, b], () => idle({ aimYaw: Math.PI / 2 }), Math.round((strike.shells * strike.shellSeconds + 0.5) * 60));
    expect(explosions(b)).toHaveLength(strike.shells);
    for (const e of explosions(b)) expect(Math.hypot(e.x - target.x, e.z - target.z)).toBeLessThanOrEqual(strike.spreadMeters + 1e-6);
    expect(hitsOn(a, b.id).length).toBeGreaterThan(0);
    expect(b.last().health.hp[ZONE_TORSO]).toBeLessThan(100);
  });

  it("counts a kill by its shells as the Cataclysm's", () => {
    const { room, a, b } = duel("cataclysm", "arbiter", both(far, withAbility("cataclysm", { damage: 1000, spreadMeters: 0 })));
    const target = where(room, b);
    run(room, [a, b], (c) => idle({ aimYaw: TOWARD_SECOND, ability: c === a, targetX: target.x, targetY: target.y, targetZ: target.z }), 1);
    run(room, [a, b], () => idle(), 180);
    expect(b.messages.find((m) => m.t === "eliminated")).toMatchObject({ id: b.id, killerId: a.id });
  });

  it("holds the Cataclysm still while it braces, then lets it walk", () => {
    const { room, config, a, b } = duel("cataclysm", "arbiter", far);
    const strike = config.abilities.mechs.cataclysm as BarrageStats;
    const startX = where(room, a).x;
    const walk = (extra: Partial<MechInput> = {}) => (c: Client) => (c === a ? forward({ aimYaw: TOWARD_SECOND, ...extra }) : idle());
    run(room, [a, b], walk({ ability: true, targetX: 30, targetY: 0, targetZ: 0 }), 1);
    run(room, [a, b], walk(), Math.round(strike.braceSeconds * 60) - 2);
    expect(a.last().you.abilityTime).toBeGreaterThan(0);
    expect(Math.abs(where(room, a).x - startX)).toBeLessThan(0.01);
    run(room, [a, b], walk(), 30);
    expect(where(room, a).x - startX).toBeGreaterThan(1);
  });

  it("keeps falling after the Cataclysm has gone", () => {
    const { room, config } = makeRoom((c) => far(withRoster(c)));
    const a = new Client(room, config), b = new Client(room, config);
    pick(room, a, mechIndex(config, "cataclysm"));
    run(room, [a, b], () => idle(), 30); // in the lobby, where shells still do damage, so leaving ends nothing
    const target = where(room, b);
    run(room, [a, b], (c) => idle({ aimYaw: TOWARD_SECOND, ability: c === a, targetX: target.x, targetY: target.y, targetZ: target.z }), 1);
    room.leave(a.id);
    run(room, [b], () => idle(), 180);
    expect(explosions(b)).toHaveLength((config.abilities.mechs.cataclysm as BarrageStats).shells);
    expect(b.last().health.hp[ZONE_TORSO]).toBeLessThan(100);
  });
});

describe("Decoy Drones", () => {
  const AWAY = Math.PI / 2; // the first player looking down -X, away from the second

  // The Arbiter (the first player) sends its decoys away from the second, and they run for a second.
  function dropped(patch?: (c: RoomConfig) => RoomConfig) {
    const game = duel("arbiter", "ironclad", patch);
    const { room, a, b } = game;
    run(room, [a, b], (c) => idle({ aimYaw: AWAY, ability: c === a }), 1);
    const ids = abilityMessages(a, "start")[0]?.ids ?? [];
    run(room, [a, b], () => idle({ aimYaw: AWAY }), 60);
    return { ...game, ids };
  }

  it("look like the Arbiter to everyone else, and run out away from it", () => {
    const { config, b, ids } = dropped();
    const decoy = config.abilities.mechs.arbiter as DecoyStats;
    expect(ids).toHaveLength(decoy.count);
    const snap = b.last();
    const real = snap.others.find((o) => o.id !== b.id && !ids.includes(o.id))!;
    const fakes = snap.others.filter((o) => ids.includes(o.id));
    expect(fakes).toHaveLength(decoy.count);
    for (const f of fakes) {
      expect(f).toMatchObject({ mech: real.mech, weapon: real.weapon, armor: real.armor, upgrades: real.upgrades, hp: real.hp, bot: false, dead: false, running: true, ability: false });
      expect(Math.hypot(f.x - real.x, f.z - real.z)).toBeGreaterThan(10);
      expect(f.x).toBeLessThan(real.x);
    }
    expect(Math.hypot(fakes[0]!.x - fakes[1]!.x, fakes[0]!.z - fakes[1]!.z)).toBeGreaterThan(5); // fanned out
  });

  it("are not players: the match still has two in it", () => {
    const { room, b } = dropped();
    expect(b.last().match).toMatchObject({ alive: 2, total: 2 });
    expect(room.inspect()).toHaveLength(2);
  });

  it("fade when their time is up", () => {
    const { room, config, a, b, ids } = dropped();
    const decoy = config.abilities.mechs.arbiter as DecoyStats;
    run(room, [a, b], () => idle({ aimYaw: AWAY }), Math.round(decoy.lifeSeconds * 60));
    expect(b.last().others.some((o) => ids.includes(o.id))).toBe(false);
    expect(abilityMessages(b, "pop").map((m) => m.id).sort()).toEqual([...ids].sort());
  });

  it("pop when shot, without any damage or hit marker, and the shot stops on them", () => {
    const { room, a, b, ids } = dropped();
    const hpBefore = a.last().health.hp;
    for (let i = 0; i < 60 && abilityMessages(b, "pop").length === 0; i++) {
      const d = b.last().others.find((o) => o.id === ids[0])!;
      run(room, [a, b], (c) => (c === b ? idle({ aimYaw: AWAY, fire: true, targetX: d.x, targetY: d.y + 2.4, targetZ: d.z }) : idle({ aimYaw: AWAY })), 1);
    }
    const pop = abilityMessages(b, "pop")[0];
    expect(pop).toMatchObject({ id: ids[0], kind: "decoy" });
    expect(b.messages.some((m) => m.t === "hit")).toBe(false);
    expect(a.last().health.hp).toEqual(hpBefore);
    run(room, [a, b], () => idle({ aimYaw: AWAY }), 3);
    expect(b.last().others.some((o) => o.id === ids[0])).toBe(false);
    expect(b.last().others.some((o) => o.id === ids[1])).toBe(true);
    const shot = a.messages.filter((m): m is Extract<ServerMessage, { t: "shot" }> => m.t === "shot" && m.id === b.id).at(-1)!;
    expect(shot.hitMech).toBe(true);
    expect(Math.hypot(shot.ox + shot.dx * shot.length - pop!.x, shot.oz + shot.dz * shot.length - pop!.z)).toBeLessThan(3);
  });

  it("pop in a blast", () => {
    // The second player is a Cataclysm this time, and drops a tight strike where the first decoy will be by then.
    const tight = withAbility("cataclysm", { spreadMeters: 0, shells: 1 });
    const game = duel("arbiter", "cataclysm", tight);
    const { room, config, a, b } = game;
    run(room, [a, b], (c) => idle({ aimYaw: AWAY, ability: c === a }), 1);
    const id = abilityMessages(a, "start")[0]!.ids![0]!;
    run(room, [a, b], () => idle({ aimYaw: AWAY }), 30);
    const seen = () => b.last().others.find((o) => o.id === id)!;
    const then = seen();
    run(room, [a, b], () => idle({ aimYaw: AWAY }), 6);
    const now = seen();
    const lead = (config.abilities.mechs.cataclysm as BarrageStats).delaySeconds / 0.1; // velocity below is per 0.1 s
    const x = now.x + (now.x - then.x) * lead, z = now.z + (now.z - then.z) * lead;
    run(room, [a, b], (c) => idle({ aimYaw: AWAY, ability: c === b, targetX: x, targetY: 0, targetZ: z }), 1);
    run(room, [a, b], () => idle({ aimYaw: AWAY }), 120);
    expect(explosions(b)).toHaveLength(1);
    expect(abilityMessages(b, "pop").map((m) => m.id)).toContain(id);
  });

  it("go when their Arbiter leaves", () => {
    const { room, a, b, ids } = dropped();
    room.leave(a.id);
    run(room, [b], () => idle(), 3);
    expect(abilityMessages(b, "pop").map((m) => m.id).sort()).toEqual([...ids].sort());
    // Only the Arbiter itself is left, standing and waiting for its player to reconnect.
    expect(b.last().others.map((o) => [o.id, o.dead])).toEqual([[a.id, false]]);
  });

  it("fool a bot into shooting one", () => {
    // A bot on the first spawn, the Arbiter 61 m off down the line, sending one decoy straight at the bot: the decoy
    // is between them, so it is the nearest thing the bot can see.
    const patch = both(withRoster, spawnAt(1, 40, 0), withAbility("arbiter", { count: 1 }));
    const { room, config } = makeRoom(patch, "small", 1);
    const a = new Client(room, config);
    pick(room, a, mechIndex(config, "arbiter"));
    run(room, [a], () => idle({ aimYaw: AWAY }), 30);
    run(room, [a], () => idle({ aimYaw: AWAY, ability: true }), 1);
    const id = abilityMessages(a, "start")[0]!.ids![0]!;
    const botId = room.inspect().find((p) => p.bot)!.id;
    for (let i = 0; i < 300 && abilityMessages(a, "pop").length === 0; i++) run(room, [a], () => idle({ aimYaw: AWAY }), 1);
    const popAt = a.messages.findIndex((m) => m.t === "ability" && m.event === "pop");
    expect(popAt).toBeGreaterThan(0);
    expect(a.messages[popAt]).toMatchObject({ id, kind: "decoy" });
    const before = a.messages.slice(0, popAt);
    expect(before.some((m) => m.t === "shot" && m.id === botId)).toBe(true);
    expect(before.some((m) => m.t === "explode")).toBe(false); // it was shot, not blown up
  });
});

describe("Rail Shot", () => {
  const aimAt = (room: Room, target: Client) => { const t = where(room, target); return { targetX: t.x, targetY: t.y + 2.4, targetZ: t.z }; };

  it("plants the Longshot and charges, then fires one shot along its aim that hurts the mech there", () => {
    const { room, config, a, b } = duel("longshot", "arbiter");
    const rail = config.abilities.mechs.longshot as RailStats;
    const startX = where(room, a).x;
    const hpBefore = where(room, b).hp.reduce((s, h) => s + h, 0);
    run(room, [a, b], (c) => (c === a ? forward({ aimYaw: TOWARD_SECOND, ability: true, ...aimAt(room, b) }) : idle()), 1);
    run(room, [a, b], (c) => (c === a ? forward({ aimYaw: TOWARD_SECOND, ...aimAt(room, b) }) : idle()), Math.round(rail.chargeSeconds * 60) - 3);
    expect(Math.abs(where(room, a).x - startX)).toBeLessThan(0.01); // planted, though it is pushing forward
    expect(hitsOn(a, b.id)).toHaveLength(0); // nothing until the charge is done
    run(room, [a, b], (c) => (c === a ? idle({ aimYaw: TOWARD_SECOND, ...aimAt(room, b) }) : idle()), 10);
    expect(abilityMessages(b, "start")).toHaveLength(1); // the target saw the laser go up
    expect(abilityMessages(b, "hit")).toHaveLength(1); // and the beam
    expect(hitsOn(a, b.id)).toHaveLength(1);
    expect(hpBefore - where(room, b).hp.reduce((s, h) => s + h, 0)).toBeGreaterThan(rail.damage * 0.5);
  });

  it("stops at a wall in the way", () => {
    const wall = (c: RoomConfig): RoomConfig => {
      const map = c.mapFor("small", 0);
      const boxes = [...map.world.boxes, boxFromData({ name: "wall", color: "scrapSteel", center: [-18, 3, 0], size: [0.5, 6, 6] })];
      return { ...c, mapFor: () => ({ ...map, world: new World(boxes) }) };
    };
    const { room, config, a, b } = duel("longshot", "arbiter", wall);
    const rail = config.abilities.mechs.longshot as RailStats;
    run(room, [a, b], (c) => (c === a ? idle({ aimYaw: TOWARD_SECOND, ability: true, ...aimAt(room, b) }) : idle()), 1);
    run(room, [a, b], (c) => (c === a ? idle({ aimYaw: TOWARD_SECOND, ...aimAt(room, b) }) : idle()), Math.round(rail.chargeSeconds * 60) + 10);
    expect(abilityMessages(a, "hit")).toHaveLength(1); // it fired
    expect(hitsOn(a, b.id)).toHaveLength(0); // into the wall
  });

  it("breaks the charge when the Longshot is hit, and loses the shot", () => {
    const { room, config, a, b } = duel("longshot", "arbiter");
    const rail = config.abilities.mechs.longshot as RailStats;
    run(room, [a, b], (c) => (c === a ? idle({ aimYaw: TOWARD_SECOND, ability: true, ...aimAt(room, b) }) : idle({ aimYaw: Math.PI / 2, fire: true, ...aimAt(room, a) })), 1);
    run(room, [a, b], (c) => (c === a ? idle({ aimYaw: TOWARD_SECOND, ...aimAt(room, b) }) : idle({ aimYaw: Math.PI / 2, fire: true, ...aimAt(room, a) })), Math.round(rail.chargeSeconds * 60) + 10);
    expect(hitsOn(b, a.id).length).toBeGreaterThan(0); // the Arbiter's autocannon landed during the charge
    expect(abilityMessages(a, "hit")).toHaveLength(0); // so no beam
    expect(a.last().you.abilityCooldown).toBeGreaterThan(0); // and the cooldown is spent anyway
  });
});
