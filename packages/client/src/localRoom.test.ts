import { describe, expect, it } from "vitest";
import { createMechInput, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { LocalRoom, practiceOptions } from "./localRoom";
import { NetClient } from "./net";

// Practice drives the server's own Room through the same NetClient online play uses, with the packed messages passing
// through an in-memory stand-in for the WebSocket. These tick the room by hand instead of on its clock.

// The shooting range (data/greybox.json): a crate at (-6, 18), barrels at (3, 18) and (6, 18), a junk pile at (14, 18).
// The one person in a room stands on the first spawn, (-21, 0, 0), facing +Z.
const CRATE = 0, BARREL_A = 1, BARREL_B = 2, JUNK = 3;
type Snapshot = Extract<ServerMessage, { t: "snapshot" }>;

const arrived = () => new Promise((resolve) => setTimeout(resolve, 0)); // lets the room's messages reach the client

async function practice(tier = "range", seed = 7) {
  const local = new LocalRoom({ tier, seed, bots: 0, difficulty: "mixed" });
  const net = new NetClient("practice", 20, null, local.connect);
  const welcome = await net.welcome;
  const broken: number[] = [];
  const blasts: number[] = [];
  const snapshots: Snapshot[] = [];
  const states: string[] = [];
  const results: unknown[] = [];
  net.onPropDestroyed = (id) => broken.push(id);
  net.onExplode = () => blasts.push(1);
  net.onSnapshot = (s) => snapshots.push(s);
  net.onRoom = (r) => states.push(r.state);
  net.onResult = (r) => results.push(r);
  let seq = 0;
  // One input per tick, as the page sends one per sim step.
  const play = async (input: MechInput, ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      net.sendInput(++seq, input, false);
      local.room.tick();
    }
    await arrived();
  };
  return { local, net, welcome, broken, blasts, snapshots, states, results, play };
}

const shootAt = (x: number, z: number): MechInput => ({ ...createMechInput(), aimYaw: Math.PI, fire: true, targetX: x, targetY: 1, targetZ: z });

describe("offline practice runs the server's room in the page", () => {
  it("builds the map the address asked for, with live tuning", async () => {
    const { welcome } = await practice("small", 1234);
    expect(welcome).toMatchObject({ tier: "small", seed: 1234, code: "PRACTICE", tuning: true });
  });

  it("breaks a crate from the client's shots, sent through the in-memory connection", async () => {
    const { broken, play } = await practice();
    await play(shootAt(-6, 18), 90);
    expect(broken).toContain(CRATE);
    expect(broken).not.toContain(JUNK);
  });

  it("a shot barrel goes off and sets off the one next to it", async () => {
    const { broken, blasts, play } = await practice();
    await play(shootAt(3, 18), 90);
    expect(broken).toEqual(expect.arrayContaining([BARREL_A, BARREL_B]));
    expect(blasts.length).toBeGreaterThanOrEqual(2);
  });

  it("a grenade thrown at the barrels sets them off", async () => {
    const { broken, play } = await practice();
    // A throw falls a little short of where it is aimed, so this one is aimed past them.
    await play({ ...createMechInput(), aimYaw: Math.PI, grenade: true, targetX: 9, targetY: 0, targetZ: 22.5 }, 1);
    await play({ ...createMechInput(), aimYaw: Math.PI }, 240);
    expect(broken).toEqual(expect.arrayContaining([BARREL_A, BARREL_B]));
  });

  it("the tuning panel tunes the room, which tells the page", async () => {
    const { net, play } = await practice();
    const tuned: [string, string, number][] = [];
    net.onTuned = (file, path, value) => tuned.push([file, path, value]);
    net.sendTune("mech", "walkSpeed", 9);
    await play({ ...createMechInput(), aimYaw: Math.PI }, 1);
    expect(tuned).toEqual([["mech", "walkSpeed", 9]]);
  });

  it("R puts you back on your spawn", async () => {
    const { local, snapshots, play } = await practice();
    await play({ ...createMechInput(), aimYaw: Math.PI, moveY: 1 }, 60);
    expect(snapshots.at(-1)!.you.z).toBeGreaterThan(3);
    local.respawn();
    await play({ ...createMechInput(), aimYaw: Math.PI }, 6);
    expect(Math.abs(snapshots.at(-1)!.you.z)).toBeLessThan(0.5);
  });

  it("stays a lobby on the range, which has no ring for a match", async () => {
    const { net, states, play } = await practice();
    net.sendStart();
    await play({ ...createMechInput(), aimYaw: Math.PI }, 30);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((s) => s === "lobby")).toBe(true);
  });

  it("a match started alone runs on rather than ending or being won at once", async () => {
    const { local, net, states, results, play } = await practice("small", 99);
    net.sendStart();
    const countdownTicks = Math.ceil(5 * 60) + 30; // data/match.json countdownSeconds, at 60 ticks a second
    await play({ ...createMechInput(), aimYaw: Math.PI }, countdownTicks + 120);
    expect(states).toContain("active");
    expect(local.room.matchState).toBe("active");
    expect(results).toEqual([]);
  });

  it("has no bots unless the address asks for them", () => {
    expect(practiceOptions(new URLSearchParams("offline&tier=small&seed=5"))).toMatchObject({ tier: "small", seed: 5, bots: 0 });
    expect(practiceOptions(new URLSearchParams("offline&tier=small&bots=3")).bots).toBe(3);
    const crowded = new LocalRoom(practiceOptions(new URLSearchParams("offline&tier=small&seed=5&bots=3")));
    expect(crowded.room.inspect().filter((p) => p.bot)).toHaveLength(3);
  });
});
