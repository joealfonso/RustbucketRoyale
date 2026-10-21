import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import weaponsJson from "../../../data/weapons.json";
import { FIRE_PRIMARY, FIRE_SECONDARY, createAltFireState, createAltShot, stepAltFire } from "./altFire";
import { createMechInput, type MechInput } from "./MechInput";
import { createMechState, startPull, stepMech, type MechState } from "./mechStep";
import { readSelf, writeSelf } from "./mechWire";
import { Predictor } from "./prediction";
import { flightSteps, fromMechFrame, reelPoint, toMechFrame } from "./projectiles";
import { STEP } from "./protocol";
import { parseMechStats, parseWeapons } from "./stats";
import { FireGate } from "./weapon";
import { World, boxFromData } from "./world";

const stats = parseMechStats(mechJson);
const weapons = parseWeapons(weaponsJson).weapons;
const gun = (id: string) => weapons.find((w) => w.id === id)!;
const ground = boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "#fff" });
const world = new World([ground]);

function standing(x = 0, z = 0): MechState {
  const s = createMechState(stats, x, 0, z, 0);
  for (let i = 0; i < 30; i++) stepMech(s, createMechInput(), stats, STEP, world);
  return s;
}

describe("weapons.json, gate 18b", () => {
  it("has the rivet gun and the harpoon with their kinds, and the old guns are plain hitscan", () => {
    expect(gun("rivetGun").projectile.kind).toBe("rivet");
    expect(gun("rivetGun").secondary.kind).toBe("detonate");
    expect(gun("magnetHarpoon").projectile.kind).toBe("harpoon");
    expect(gun("magnetHarpoon").secondary.kind).toBe("reel");
    for (const id of ["autocannon", "scattergun", "spikeDriver"]) expect(gun(id).projectile.kind).toBe("hitscan");
  });

  it("refuses broken projectile and secondary blocks", () => {
    const withGun = (patch: Record<string, unknown>) => ({ start: "rivetGun", weapons: [{ ...(weaponsJson.weapons[3] as object), ...patch }] });
    expect(() => parseWeapons(withGun({ projectile: { kind: "rivet", fuseSeconds: 1, blastDamage: 1, blastRadius: 1, maxStuck: 0 } }))).toThrow(/maxStuck/);
    expect(() => parseWeapons(withGun({ projectile: { kind: "laser" } }))).toThrow(/kind/);
    expect(() => parseWeapons(withGun({ projectile: { kind: "hitscan" } }))).toThrow(/detonate needs a rivet/);
    expect(() => parseWeapons(withGun({ secondary: { kind: "reel", shotsPerSecond: 0, speed: 1, maxSeconds: 1, standOffMeters: 0, climbMeters: 0, stopMeters: 0 } }))).toThrow(/shotsPerSecond/);
  });
});

describe("detonate and reel triggers", () => {
  const press = (on: boolean): MechInput => ({ ...createMechInput(), altFire: on });

  it("detonate goes off once per press of right-click, never while held, and fires no shot", () => {
    const state = createAltFireState(), gate = new FireGate(), out = createAltShot();
    const rivets = gun("rivetGun");
    let t = 0, detonations = 0;
    for (let i = 0; i < 60; i++) {
      t += STEP;
      if (stepAltFire(state, gate, press(true), rivets, t, STEP, 1, out)) {
        expect(out.mode).toBe(FIRE_SECONDARY);
        expect(out.detonate).toBe(true);
        expect(out.weapon.pellets).toBe(0);
        detonations++;
      }
    }
    expect(detonations).toBe(1);
    stepAltFire(state, gate, press(false), rivets, (t += STEP), STEP, 1, out);
    expect(stepAltFire(state, gate, press(true), rivets, (t += STEP), STEP, 1, out)).toBe(true);
    // Left-click rivets are untouched by a detonate.
    expect(stepAltFire(state, gate, { ...createMechInput(), fire: true }, rivets, (t += STEP), STEP, 1, out)).toBe(true);
    expect(out.mode).toBe(FIRE_PRIMARY);
    expect(out.detonate).toBe(false);
  });

  it("reel shares the harpoon's fire gate: one harpoon of either kind per cooldown", () => {
    const state = createAltFireState(), gate = new FireGate(), out = createAltShot();
    const harpoon = gun("magnetHarpoon");
    let t = 0, reels = 0, primaries = 0;
    for (let i = 0; i < Math.round(4 / STEP); i++) {
      t += STEP;
      const input = { ...createMechInput(), fire: true, altFire: i % 2 === 0 };
      if (stepAltFire(state, gate, input, harpoon, t, STEP, 1, out)) {
        if (out.reel) reels++;
        else primaries++;
      }
    }
    // 4 s at one harpoon per 2 s: two, whichever button.
    expect(reels + primaries).toBe(2);
    expect(reels).toBeGreaterThan(0);
  });
});

describe("the harpoon pull", () => {
  it("moves the mech at the pull's velocity, ignoring keys and gravity, and stops short of the point", () => {
    const s = standing();
    expect(startPull(s, 0, 0, -30, 25, 2, 5, 0)).toBe(true);
    const input: MechInput = { ...createMechInput(), moveY: -1, jet: true };
    let steps = 0;
    while (s.pullTime > 0 && steps < 200) { stepMech(s, input, stats, STEP, world); steps++; }
    expect(s.z).toBeCloseTo(-25, 0);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    // Let go, it slides on at no more than a run.
    expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(stats.runSpeed + 1e-6);
  });

  it("ends early against a wall", () => {
    const wall = boxFromData({ name: "w", center: [0, 3, -10], size: [20, 6, 1], color: "#fff" });
    const walled = new World([ground, wall]);
    const s = standing();
    startPull(s, 0, 0, -60, 25, 3, 0, 0);
    for (let i = 0; i < 60; i++) stepMech(s, createMechInput(), stats, STEP, walled);
    expect(s.pullTime).toBe(0);
    expect(s.z).toBeGreaterThan(-10);
  });

  it("does nothing when already within the stop distance, and caps at maxSeconds", () => {
    const s = standing();
    expect(startPull(s, 0, 0, -3, 25, 1, 5, 0)).toBe(false);
    expect(startPull(s, 0, 0, -300, 25, 0.5, 0, 2)).toBe(true);
    expect(s.pullTime).toBeCloseTo(0.5, 5);
    expect(s.pullVy).toBeCloseTo(2, 3);
  });

  it("survives the snapshot: a client replaying from the server's numbers lands on the same spot", () => {
    const server = standing();
    startPull(server, 10, 2, -20, 26, 0.6, 5, 3);
    for (let i = 0; i < 5; i++) stepMech(server, createMechInput(), stats, STEP, world);
    const client = createMechState(stats, 0, 0, 0, 0);
    readSelf(client, writeSelf(server));
    for (let i = 0; i < 40; i++) { stepMech(server, createMechInput(), stats, STEP, world); stepMech(client, createMechInput(), stats, STEP, world); }
    expect(client.x).toBe(server.x);
    expect(client.y).toBe(server.y);
    expect(client.z).toBe(server.z);
  });

  it("a reel booked in prediction starts on the same step in every replay, matching a server that starts it there", () => {
    const start = standing();
    const predictor = new Predictor(() => stats, world, start.x, start.y, start.z, 0);
    const server = standing();
    const input = createMechInput();
    for (let i = 0; i < 3; i++) { predictor.step(input, STEP); stepMech(server, input, stats, STEP, world); }
    predictor.pullAfter(predictor.seq + 4, 5, 6, -30, 30, 1.2, 1, 0);
    let seq = 3;
    for (let i = 0; i < 10; i++) {
      predictor.step(input, STEP);
      stepMech(server, input, stats, STEP, world);
      seq++;
      if (seq === 7) startPull(server, 5, 6, -30, 30, 1.2, 1, 0);
    }
    expect(predictor.state.z).toBeCloseTo(server.z, 9);
    // A snapshot from before the pull started: the replay starts it again at its step, so no correction.
    const early = standing();
    for (let i = 0; i < 5; i++) stepMech(early, input, stats, STEP, world);
    const error = predictor.reconcile(5, writeSelf(early), STEP);
    expect(error).toBeLessThan(1e-4);
  });
});

describe("projectile helpers", () => {
  it("flight time is at least a step and grows with distance", () => {
    const harpoon = gun("magnetHarpoon");
    expect(flightSteps(0, harpoon)).toBe(1);
    expect(flightSteps(harpoon.projectileSpeed, harpoon)).toBe(60);
  });

  it("a point in a mech's frame turns back to the same world point", () => {
    const local = { x: 0, y: 0, z: 0 }, back = { x: 0, y: 0, z: 0 };
    toMechFrame(3, 2, -4, 1, 0.5, 1, 0.8, local);
    fromMechFrame(local.x, local.y, local.z, 1, 0.5, 1, 0.8, back);
    expect(back.x).toBeCloseTo(3, 9); expect(back.y).toBeCloseTo(2, 9); expect(back.z).toBeCloseTo(-4, 9);
  });

  it("a reel aims off the wall and above where it hit", () => {
    const reel = gun("magnetHarpoon").secondary;
    if (reel.kind !== "reel") throw new Error("harpoon should reel");
    const out = { x: 0, y: 0, z: 0 };
    reelPoint(0, 5, -20, 0, 0, 1, reel, out);
    expect(out).toEqual({ x: 0, y: 5 + reel.climbMeters, z: -20 + reel.standOffMeters });
  });
});
