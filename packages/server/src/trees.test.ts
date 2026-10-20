import { describe, expect, it } from "vitest";
import { World, addProp, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Client, idle, makeRoom, startMatch } from "./testClient";
import type { Room, RoomConfig } from "./Room";

// Pines on the test range, which already has four props (ids 0 to 3), so the first prop added here is id 4. The
// first player spawns at (-21, 0, 0) facing +Z, the second at (-15, 0, 0).
const FIRST_ADDED = 4;

// The test range with extra props, and every match on a fresh world so broken ones come back.
const withProps = (added: { type: string; x: number; z: number }[], patch: (c: RoomConfig) => RoomConfig = (c) => c) => (base: RoomConfig): RoomConfig => {
  const c = patch(base);
  const range = c.mapFor("small", 0);
  const boxes = [...range.world.boxes];
  const props = [...range.props];
  for (const p of added) addProp(boxes, props, c.props, c.props.types.findIndex((t) => t.id === p.type), p.x, p.z);
  const propOfBox = new Int32Array(boxes.length).fill(-1);
  for (const p of props) propOfBox[p.boxIndex] = p.id;
  return { ...c, mapFor: () => ({ ...range, world: new World(boxes), props, propOfBox }) };
};
const withRoster = (c: RoomConfig): RoomConfig => {
  const { roster, kitHitboxes } = loadRoomConfig({ roster: true });
  return { ...c, roster, kitHitboxes };
};
const pick = (room: Room, c: Client, id: string, config: RoomConfig) =>
  room.receive(c.id, JSON.stringify({ t: "mech", mech: config.roster!.mechs.findIndex((m) => m.id === id) }));

function run(room: Room, clients: Client[], input: (c: Client) => MechInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) { for (const c of clients) c.send(input(c)); room.tick(); }
}
const broken = (c: Client) => c.messages.filter((m): m is Extract<ServerMessage, { t: "prop" }> => m.t === "prop").map((m) => m.id);
const where = (room: Room, c: Client) => room.inspect().find((p) => p.id === c.id)!;

describe("trees", () => {
  it("fall to gunfire like crates and leave nothing behind", () => {
    const { room, config } = makeRoom(withProps([{ type: "pine", x: -21, z: 10 }, { type: "pine", x: -15, z: 10 }]));
    const a = new Client(room, config), b = new Client(room, config);
    // Each shoots the trunk in front of it, low down.
    run(room, [a, b], (c) => idle({ fire: true, targetX: c === a ? -21 : -15, targetY: 1.5, targetZ: 10 }), 60 * 4);
    expect(broken(a)).toEqual(expect.arrayContaining([FIRST_ADDED, FIRST_ADDED + 1]));
    expect(a.snapshots().every((s) => s.pickups.length === 0)).toBe(true);
    // And once down they no longer stop shots.
    const last = a.messages.filter((m): m is Extract<ServerMessage, { t: "shot" }> => m.t === "shot" && m.id === a.id).at(-1)!;
    expect(last.length).toBeGreaterThan(11);
  });

  it("are smashed by a Shield Ram, one after another, without stopping it", () => {
    const { room, config } = makeRoom((c) => withProps([{ type: "pine", x: -21, z: 6 }, { type: "pine", x: -21, z: 11 }])(withRoster(c)));
    const a = new Client(room, config), b = new Client(room, config);
    pick(room, a, "ironclad", config);
    startMatch(room, a);
    run(room, [a, b], () => idle(), 30);
    run(room, [a, b], (c) => idle({ ability: c === a }), 1);
    run(room, [a, b], () => idle(), 60);
    expect(broken(b)).toEqual(expect.arrayContaining([FIRST_ADDED, FIRST_ADDED + 1]));
    expect(where(room, a).z).toBeGreaterThan(13); // charged on through both
  });

  it("are felled by a Pounce that lands at their foot, and one out of reach of the slam stands", () => {
    const near = { type: "pine", x: -21, z: 13.5 }, far = { type: "pine", x: -26, z: 12 };
    const { room, config } = makeRoom((c) => withProps([near, far])(withRoster(c)));
    const a = new Client(room, config), b = new Client(room, config);
    pick(room, a, "stiletto", config);
    startMatch(room, a);
    run(room, [a, b], () => idle(), 30);
    run(room, [a, b], (c) => idle({ ability: c === a, targetX: -21, targetY: 0, targetZ: 12 }), 1);
    run(room, [a, b], () => idle(), 90);
    expect(broken(b)).toContain(FIRST_ADDED);
    expect(broken(b)).not.toContain(FIRST_ADDED + 1);
  });

  it("take a blast at their foot in full, not measured from 6 m up the trunk", () => {
    // A pine with just enough life left for a barrel going off 1.5 m away to finish it. Measured from the middle of
    // the trunk, the blast would be over 6 m away and do a third as much.
    const lowPine = (c: RoomConfig): RoomConfig => ({ ...c, props: { ...c.props, types: c.props.types.map((t) => (t.id === "pine" ? { ...t, hp: 50 } : t)) } });
    const { room, config } = makeRoom(withProps([{ type: "barrel", x: -21, z: 12 }, { type: "pine", x: -19.5, z: 12 }], lowPine));
    const a = new Client(room, config), b = new Client(room, config);
    run(room, [a, b], (c) => idle(c === a ? { fire: true, targetX: -21, targetY: 1, targetZ: 12 } : {}), 60);
    expect(broken(b)).toEqual(expect.arrayContaining([FIRST_ADDED, FIRST_ADDED + 1]));
  });
});
