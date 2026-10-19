import { describe, expect, it } from "vitest";
import { World, ZONE_ARMS, ZONE_TORSO, boxFromData, createMechInput, createMechState, type MechInput, type RamStats, type ServerMessage } from "@rustbucket/shared";
import { Bot } from "./Bot";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom, startMatch, tickRoom } from "./testClient";
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
    const { room, a, b } = duel("cataclysm", "arbiter");
    const startX = where(room, a).x;
    run(room, [a, b], (c) => idle({ aimYaw: TOWARD_SECOND, ability: true }), 60);
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
});
