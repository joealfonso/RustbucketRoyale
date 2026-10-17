import { describe, expect, it } from "vitest";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Room, RoomConfig } from "./Room";

// The human takes spawn slot 3. Three bots take slots 0 to 2, which are put 100, 400 and 600 m down the strip.
const spaced = (c: RoomConfig): RoomConfig => {
  const map = c.mapFor("small", 0);
  const human = map.spawns[3]!;
  const spawns = map.spawns.map((s, i): [number, number, number] => (i < 3 ? [human[0], 0.1, human[2] + [100, 400, 600][i]!] : s));
  return { ...c, mapFor: () => ({ ...map, spawns }) };
};

const tick = (room: Room, clients: Client[], count: number) => {
  for (let i = 0; i < count; i++) { for (const c of clients) c.send(idle()); room.tick(); }
};

describe("nearby only", () => {
  it("sends a mech only when it is within the interest range", () => {
    const { room, config } = makeRoom(spaced, "small", 3);
    const human = new Client(room, config);
    tick(room, [human], 6);
    const others = human.last().others;
    expect(others).toHaveLength(1);
    expect(Math.hypot(others[0]!.x - human.last().you.x, others[0]!.z - human.last().you.z)).toBeLessThan(config.net.interestRange);
  });

  it("sends a watcher what is near the mech it watches, not the whole map", () => {
    const { room, config } = makeRoom(spaced, "small", 3);
    const host = new Client(room, config);
    startMatch(room, host);
    const late = new Client(room, config); // arrives mid match, so can only watch
    tick(room, [host, late], 10);
    expect(late.last().health.dead).toBe(true);
    // With no say, it is shown the area round the nearest mech still standing, not all four.
    expect(late.last().others.length).toBeLessThan(4);
    expect(late.last().others.length).toBeGreaterThan(0);
  });

  it("tells a client about shots only when they are near enough to see them", () => {
    const { room, config } = makeRoom(spaced, "small", 3);
    const human = new Client(room, config);
    const shots = () => human.messages.filter((m) => m.t === "shot").length;
    // Bots are far from each other and far from the human at first. Nobody is near anyone, so no one shoots in view.
    tick(room, [human], 30);
    const before = shots();
    // Put a shot right next to the human: a person firing is always told about their own shots.
    human.send({ ...idle(), fire: true, targetX: 0, targetY: 2, targetZ: 100 });
    room.tick();
    expect(shots()).toBeGreaterThan(before);
  });

  it("does not send a far away bot fight to a player who cannot see it", () => {
    // Two bots 400 m from the human fight each other. The human should hear nothing about it.
    const { room, config } = makeRoom((c) => {
      const map = c.mapFor("small", 0);
      const human = map.spawns[2]!;
      const spawns = map.spawns.map((s, i): [number, number, number] => (i === 0 ? [human[0], 0.1, human[2] + 400] : i === 1 ? [human[0] + 6, 0.1, human[2] + 400] : s));
      return { ...c, mapFor: () => ({ ...map, spawns }) };
    }, "small", 2);
    const human = new Client(room, config);
    // Hold the human in place and watch the two bots shoot at each other far away.
    let farShots = 0;
    for (let i = 0; i < 60 * 10; i++) {
      human.send(idle()); room.tick();
      farShots += human.messages.filter((m) => m.t === "shot" && Math.hypot(m.ox - human.last().you.x, m.oz - human.last().you.z) > 300).length;
      human.messages.length = 0;
    }
    expect(farShots).toBe(0);
  });
});
