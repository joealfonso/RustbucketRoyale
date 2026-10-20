import { describe, expect, it } from "vitest";
import { World, addProp, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { CAUSE_RING, abilityCause, knockoutHow, noteCause, weaponCause } from "./knockout";
import { createTally, topStats } from "./matchStats";
import { Client, idle, makeRoom, startMatch } from "./testClient";
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
const where = (room: Room, c: Client) => room.inspect().find((p) => p.id === c.id)!;

function run(room: Room, clients: Client[], input: (c: Client) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c)); room.tick(); }
}
const knockouts = (c: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "eliminated" }> => m.t === "eliminated");
const result = (c: Client) => c.messages.find((m): m is Extract<ServerMessage, { t: "result" }> => m.t === "result");

// Everyone starts with the scattergun, and one pull of it is enough to finish a mech.
const deadlyScattergun = (c: RoomConfig): RoomConfig => {
  const start = c.weapons.weapons.findIndex((w) => w.id === "scattergun");
  return { ...c, weapons: { ...c.weapons, start, weapons: c.weapons.weapons.map((w, i) => (i === start ? { ...w, damage: 500 } : w)) } };
};

// The test range with extra props.
const withProps = (added: { type: string; x: number; z: number }[]) => (c: RoomConfig): RoomConfig => {
  const range = c.mapFor("small", 0);
  const boxes = [...range.world.boxes];
  const props = [...range.props];
  for (const p of added) addProp(boxes, props, c.props, c.props.types.findIndex((t) => t.id === p.type), p.x, p.z);
  const propOfBox = new Int32Array(boxes.length).fill(-1);
  for (const p of props) propOfBox[p.boxIndex] = p.id;
  return { ...c, mapFor: () => ({ ...range, world: new World(boxes), props, propOfBox }) };
};

function duel(first: string, second: string, patch: (c: RoomConfig) => RoomConfig = (c) => c) {
  const { room, config } = makeRoom((c) => patch(withRoster(c)));
  const a = new Client(room, config), b = new Client(room, config);
  pick(room, a, mechIndex(config, first));
  pick(room, b, mechIndex(config, second));
  startMatch(room, a);
  run(room, [a, b], (c) => idle({ aimYaw: c === a ? TOWARD_SECOND : Math.PI / 2 }), 30);
  return { room, config, a, b };
}

describe("the knockout card", () => {
  it("names the killer's mech and the last two things that hurt, oldest first", () => {
    const { room, config, a, b } = duel("stiletto", "arbiter", deadlyScattergun);
    const target = where(room, b);
    run(room, [a, b], (c) => idle({ aimYaw: TOWARD_SECOND, ability: c === a, targetX: target.x, targetY: target.y, targetZ: target.z }), 1);
    run(room, [a, b], () => idle({ aimYaw: TOWARD_SECOND }), 90); // the pounce lands on the Arbiter and hurts it
    expect(knockouts(b)).toHaveLength(0);
    const now = where(room, b);
    run(room, [a, b], (c) => idle({ aimYaw: TOWARD_SECOND, fire: c === a, targetX: now.x, targetY: now.y + 2.4, targetZ: now.z }), 30);

    expect(knockouts(b)[0]).toMatchObject({
      id: b.id, killerId: a.id, how: { causes: ["ability:pounce", "weapon:scattergun"], killerMech: mechIndex(config, "stiletto"), killerBot: false },
    });
  });

  it("puts a ring knockout down to the ring, with no killer", () => {
    // Both spawn far outside the first ring, so it starts hurting them at once.
    const farAway = (c: RoomConfig): RoomConfig => {
      const map = c.mapFor("small", 0);
      const spawns: [number, number, number][] = map.spawns.map((s, i) => [s[0] + 400 + i * 4, s[1], s[2]]);
      return { ...c, mapFor: () => ({ ...map, spawns }) };
    };
    const { room, config } = makeRoom(farAway);
    const a = new Client(room, config), b = new Client(room, config);
    startMatch(room, a);
    for (let i = 0; i < 120 * 60 && knockouts(a).length === 0; i++) run(room, [a, b], () => idle(), 1);
    expect(knockouts(a)[0]).toMatchObject({ killerId: null, how: { causes: ["ring"], killerMech: -1, killerBot: false } });
  });

  it("keeps the same cause once, and a new one pushes the oldest out", () => {
    const trail = { cause: 0, causeBefore: 0 };
    const weapons = loadRoomConfig().weapons;
    noteCause(trail, weaponCause(0));
    noteCause(trail, weaponCause(0));
    expect(knockoutHow(trail, null, weapons).causes).toEqual([`weapon:${weapons.weapons[0]!.id}`]);
    noteCause(trail, abilityCause("ram"));
    noteCause(trail, CAUSE_RING);
    expect(knockoutHow(trail, null, weapons)).toEqual({ killerMech: -1, killerBot: false, causes: ["ability:ram", "ring"] });
  });
});

describe("end of match stats", () => {
  it("credit the Stiletto that pounced into a pine with the tree and the longest pounce", () => {
    // A pine 10 m in front of the first spawn. A short match, so time runs out soon after the leap.
    const short = (c: RoomConfig): RoomConfig => ({ ...c, match: { ...c.match, matchSeconds: 4, resultsSeconds: 60 } });
    const { room, a, b } = duel("stiletto", "arbiter", (c) => short(withProps([{ type: "pine", x: -21, z: 10 }])(c)));
    run(room, [a, b], (c) => idle({ aimYaw: Math.PI, ability: c === a, targetX: -21, targetY: 0, targetZ: 10 }), 1);
    run(room, [a, b], () => idle({ aimYaw: Math.PI }), 90);
    expect(where(room, a).z).toBeGreaterThan(6); // it really leapt
    for (let i = 0; i < 10 * 60 && !result(a); i++) run(room, [a, b], () => idle(), 1);

    const stats = result(a)!.stats!;
    expect(stats.find((s) => s.kind === "longestPounce")).toMatchObject({ playerId: a.id });
    expect(stats.find((s) => s.kind === "longestPounce")!.value).toBeGreaterThan(6);
    expect(stats.find((s) => s.kind === "treesFelled")).toMatchObject({ playerId: a.id, value: 1 });
    expect(stats.length).toBeLessThanOrEqual(3);
    expect(stats.some((s) => s.kind === "mostDamage")).toBe(false); // nobody hurt anybody
  });

  it("start again from nothing each match", () => {
    const short = (c: RoomConfig): RoomConfig => ({ ...c, match: { ...c.match, matchSeconds: 4 } });
    const { room, a, b } = duel("stiletto", "arbiter", (c) => short(withProps([{ type: "pine", x: -21, z: 10 }])(c)));
    run(room, [a, b], (c) => idle({ aimYaw: Math.PI, ability: c === a, targetX: -21, targetY: 0, targetZ: 10 }), 1);
    const results = () => a.messages.filter((m): m is Extract<ServerMessage, { t: "result" }> => m.t === "result");
    for (let i = 0; i < 20 * 60 && results().length < 2; i++) run(room, [a, b], () => idle(), 1);
    expect(results()[0]!.stats!.length).toBeGreaterThan(0);
    expect(results()[1]!.stats).toEqual([]);
  });

  it("are sent most fun first, only when someone scored, and never more than three", () => {
    const tally = (change: Partial<ReturnType<typeof createTally>>) => ({ ...createTally(), ...change });
    const stats = topStats([
      { id: 1, tally: tally({ mostDamage: 300.4, propsSmashed: 2, barrelsSetOff: 1 }) },
      { id: 2, tally: tally({ mostDamage: 410.6, longestPounce: 18.26 }) },
    ]);
    expect(stats).toEqual([
      { kind: "longestPounce", playerId: 2, value: 18.3 },
      { kind: "barrelsSetOff", playerId: 1, value: 1 },
      { kind: "propsSmashed", playerId: 1, value: 2 },
    ]);
    expect(topStats([{ id: 1, tally: createTally() }])).toEqual([]);
  });
});
