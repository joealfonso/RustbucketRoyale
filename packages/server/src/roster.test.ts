import { describe, expect, it } from "vitest";
import { STEP, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Client, forward, idle, makeRoom, startMatch } from "./testClient";
import type { Room, RoomConfig } from "./Room";

const withRoster = (c: RoomConfig): RoomConfig => {
  const { roster, kitHitboxes } = loadRoomConfig({ roster: true });
  return { ...c, roster, kitHitboxes };
};
const rosterRoom = () => makeRoom(withRoster);
const mechIndex = (c: RoomConfig, id: string) => c.roster!.mechs.findIndex((m) => m.id === id);

function drive(room: Room, clients: Client[], count: number, input = idle): void {
  for (let i = 0; i < count; i++) {
    for (const c of clients) c.send(input());
    room.tick();
  }
}

const pick = (room: Room, c: Client, mech: unknown) => room.receive(c.id, JSON.stringify({ t: "mech", mech }));

describe("roster mechs", () => {
  it("deals people who have not picked a mech by player number", () => {
    const { room, config } = rosterRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    drive(room, [a, b], 3);
    expect(a.last().you.mech).toBe(a.id % 4);
    expect(b.last().you.mech).toBe(b.id % 4);
    expect(b.last().others.find((o) => o.id === a.id)?.mech).toBe(a.id % 4);
  });

  it("swaps at once in the lobby, and only waits for the next match once one is running", () => {
    const { room, config } = rosterRoom();
    const a = new Client(room, config);
    const b = new Client(room, config);
    const stiletto = mechIndex(config, "stiletto"), arbiter = mechIndex(config, "arbiter");
    pick(room, a, stiletto);
    drive(room, [a, b], 3);
    expect(a.last().you.mech).toBe(stiletto);

    startMatch(room, a);
    pick(room, a, arbiter);
    drive(room, [a, b], 30);
    expect(a.last().you.mech).toBe(stiletto); // no swapping mid fight

    room.leave(b.id); // the last opponent walks out, so the match ends once they are not back in time
    drive(room, [a], Math.ceil(config.net.rejoinGraceSeconds / STEP) + 60);
    startMatch(room, a);
    drive(room, [a], 3);
    expect(a.last().you.mech).toBe(arbiter);
  });

  it("ignores a mech number that is not in the roster, and any pick without a roster", () => {
    const { room, config } = rosterRoom();
    const a = new Client(room, config);
    drive(room, [a], 3);
    const before = a.last().you.mech;
    for (const bad of [4, -1, 1.5, "stiletto", null]) pick(room, a, bad);
    drive(room, [a], 3);
    expect(a.last().you.mech).toBe(before);

    const plain = makeRoom();
    const p = new Client(plain.room);
    pick(plain.room, p, 1);
    drive(plain.room, [p], 3);
    expect(p.last().you.mech).toBe(0);
  });

  it("fires each mech's shots from its own gun, Arbiter's two wrist guns in turn", () => {
    const { room, config } = rosterRoom();
    const shooter = new Client(room, config);
    const watcher = new Client(room, config);
    pick(room, shooter, mechIndex(config, "arbiter"));
    drive(room, [shooter, watcher], 5);
    const x = shooter.last().you.x;
    drive(room, [shooter, watcher], 40, () => idle({ fire: true, targetX: x, targetY: 2, targetZ: 200 }));
    const sides = watcher.messages.filter((m): m is Extract<ServerMessage, { t: "shot" }> => m.t === "shot" && m.id === shooter.id).map((m) => Math.sign(m.ox - x));
    expect(sides.length).toBeGreaterThanOrEqual(3);
    // Facing +z, the right wrist is world -x and the left +x: the shots swap sides every pull.
    for (let i = 1; i < sides.length; i++) expect(sides[i]).toBe(-sides[i - 1]!);
  });

  it("moves each mech at its own speed, and the client predicts it without correction", () => {
    const { room, config } = rosterRoom();
    const fast = new Client(room, config);
    const slow = new Client(room, config);
    pick(room, fast, mechIndex(config, "stiletto"));
    pick(room, slow, mechIndex(config, "cataclysm"));
    drive(room, [fast, slow], 30);
    fast.predictor.reconcile(fast.last().ack, fast.last().you, STEP); // learns its mech from the snapshot, as the real client does
    const start = [fast.last().you.z, slow.last().you.z];
    drive(room, [fast, slow], 90, () => forward());
    const fastMoved = fast.last().you.z - start[0]!;
    const slowMoved = slow.last().you.z - start[1]!;
    expect(fastMoved).toBeGreaterThan(slowMoved * 1.3);
    const snap = fast.last();
    expect(fast.predictor.reconcile(snap.ack, snap.you, STEP)).toBeLessThan(0.001);
  });
});
