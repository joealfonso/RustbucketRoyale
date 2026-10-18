import { describe, expect, it } from "vitest";
import { loadTuningRaws } from "./config";
import { Client, idle, makeRoom } from "./testClient";
import { Room, type RoomConfig } from "./Room";

const withTuning = (c: RoomConfig): RoomConfig => ({ ...c, tuningRaws: loadTuningRaws() });
const tune = (room: Room, c: Client, file: string, path: string, value: number) => room.receive(c.id, JSON.stringify({ t: "tune", file, path, value }));
const tuned = (c: Client) => c.messages.filter((m) => m.t === "tuned");

function walk(room: Room, c: Client, ticks: number): number {
  for (let i = 0; i < ticks; i++) { c.send(idle({ moveY: 1 })); room.tick(); }
  const you = c.last().you;
  return Math.hypot(you.vx, you.vz);
}

describe("live tuning in a room", () => {
  it("changes the number for everyone in the room, and the server moves mechs with it", () => {
    const { room, config } = makeRoom(withTuning);
    const a = new Client(room, config), b = new Client(room, config);
    expect(a.messages.find((m) => m.t === "welcome")).toMatchObject({ tuning: true });
    tune(room, a, "mech", "walkSpeed", 3);
    expect(tuned(a)).toEqual([{ t: "tuned", file: "mech", path: "walkSpeed", value: 3 }]);
    expect(tuned(b)).toHaveLength(1);
    expect(walk(room, a, 120)).toBeCloseTo(3, 1);
  });

  it("is ignored by a server started without DEV_TUNING", () => {
    const { room, config } = makeRoom();
    const a = new Client(room, config);
    expect(a.messages.find((m) => m.t === "welcome")).toMatchObject({ tuning: false });
    tune(room, a, "mech", "walkSpeed", 3);
    expect(tuned(a)).toHaveLength(0);
    expect(walk(room, a, 120)).toBeCloseTo(config.mech.walkSpeed, 1);
  });

  it("refuses a bad value, and tells someone who joins later what changed before", () => {
    const { room, config } = makeRoom(withTuning);
    const a = new Client(room, config);
    tune(room, a, "zones", "damagedBelowFraction", 5);
    tune(room, a, "weapons", "weapons.0.damage", 40);
    expect(tuned(a)).toHaveLength(1);
    const late = new Client(room, config);
    expect(tuned(late)).toEqual([{ t: "tuned", file: "weapons", path: "weapons.0.damage", value: 40 }]);
  });

  it("keeps each room's changes to itself", () => {
    // The real server hands every room the same config object, so the second room is built from the first one's.
    const one = makeRoom(withTuning);
    const twoRoom = new Room("TWO", "small", one.config, 0);
    const a = new Client(one.room, one.config), b = new Client(twoRoom, one.config);
    tune(one.room, a, "mech", "walkSpeed", 3);
    expect(walk(twoRoom, b, 120)).toBeCloseTo(one.config.mech.walkSpeed, 1);
    expect(one.config.mech.walkSpeed).not.toBe(3);
  });
});
