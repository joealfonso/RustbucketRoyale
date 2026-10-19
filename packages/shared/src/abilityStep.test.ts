import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import abilitiesJson from "../../../data/abilities.json";
import { parseAbilities, type AbilityStats, type PounceStats, type RamStats } from "./abilities";
import { createMechInput, type MechInput } from "./MechInput";
import { createMechState, stepMech, type MechState } from "./mechStep";
import { writeSelf } from "./mechWire";
import { Predictor } from "./prediction";
import { parseMechStats } from "./stats";
import { World, boxFromData } from "./world";

const stats = parseMechStats(mechJson);
const abilities = parseAbilities(abilitiesJson);
const ram = abilities.mechs.ironclad as RamStats;
const pounce = abilities.mechs.stiletto as PounceStats;
const DT = 1 / 60;
const ground = boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "#fff" });
const flat = new World([ground]);

function steps(s: MechState, input: MechInput, count: number, ability: AbilityStats | null, world = flat): void {
  for (let i = 0; i < count; i++) stepMech(s, input, stats, DT, world, ability);
}

// A mech standing on the ground at the origin, facing -Z.
function standing(): MechState {
  const s = createMechState(stats, 0, 0, 0, 0);
  steps(s, createMechInput(), 6, null);
  return s;
}

const press = (extra: Partial<MechInput> = {}): MechInput => ({ ...createMechInput(), ability: true, ...extra });

describe("shield ram", () => {
  it("charges straight ahead at its speed for its time, then lets go of the speed", () => {
    const s = standing();
    steps(s, press(), 1, ram);
    expect(s.vz).toBeCloseTo(-ram.speed);
    expect(s.vx).toBeCloseTo(0);
    expect(s.abilityCooldown).toBe(ram.cooldownSeconds);
    expect(s.abilityTime).toBeGreaterThan(0);

    const charge = Math.round(ram.activeSeconds / DT);
    steps(s, press(), charge, ram);
    expect(s.abilityTime).toBe(0);
    expect(-s.z).toBeGreaterThan(ram.speed * ram.activeSeconds - 1);
    expect(-s.z).toBeLessThan(ram.speed * ram.activeSeconds + 1);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(stats.runSpeed + 1e-6);
  });

  it("goes where you look, not where you steer", () => {
    const s = standing();
    steps(s, press({ aimYaw: Math.PI / 2, moveX: 1 }), 2, ram);
    expect(s.vx).toBeCloseTo(-ram.speed);
    expect(s.vz).toBeCloseTo(0);
  });

  it("cannot start again until the cooldown is over, even with the key held", () => {
    const s = standing();
    steps(s, press(), Math.round((ram.cooldownSeconds - 0.5) / DT), ram);
    expect(s.abilityTime).toBe(0);
    expect(s.abilityCooldown).toBeGreaterThan(0);
    steps(s, createMechInput(), Math.round(1 / DT), ram);
    expect(s.abilityCooldown).toBe(0);
    steps(s, press(), 1, ram);
    expect(s.abilityTime).toBeGreaterThan(0);
  });

  it("does nothing in the air, on broken legs, or for a mech without an ability", () => {
    const flying = createMechState(stats, 0, 5, 0, 0);
    steps(flying, press(), 1, ram);
    expect([flying.abilityTime, flying.abilityCooldown]).toEqual([0, 0]);

    const crawler = standing();
    crawler.crawling = true;
    steps(crawler, press(), 1, ram);
    expect([crawler.abilityTime, crawler.abilityCooldown]).toEqual([0, 0]);

    const plain = standing();
    steps(plain, press(), 1, null);
    expect([plain.abilityTime, plain.abilityCooldown]).toEqual([0, 0]);
  });

  it("ends early against a wall instead of grinding into it", () => {
    const wall = boxFromData({ name: "w", center: [0, 2, -6], size: [20, 4, 1], color: "#fff" });
    const world = new World([ground, wall]);
    const s = standing();
    steps(s, press(), Math.round(0.4 / DT), ram, world);
    expect(s.abilityTime).toBe(0);
    expect(s.z).toBeGreaterThan(-5.5 + stats.halfWidth - 1e-3);
  });

  it("ends on the same step whether or not its time left went through a snapshot's rounding", () => {
    // A 0.7 s charge is a whole number of steps, so its last step sits within rounding of zero. The client rewinds
    // to the snapshot's float32 copy of the time left; it must still end the charge on the step the server does.
    const idle = createMechInput();
    for (let snapshotAt = 0; snapshotAt < 42; snapshotAt++) {
      const exact = standing(), rounded = standing();
      steps(exact, press(), 1, ram); steps(rounded, press(), 1, ram);
      for (let i = 0; i < 50; i++) {
        if (i === snapshotAt) rounded.abilityTime = Math.fround(rounded.abilityTime);
        steps(exact, idle, 1, ram); steps(rounded, idle, 1, ram);
        expect(rounded.abilityTime > 0, `snapshot at ${snapshotAt}, step ${i}`).toBe(exact.abilityTime > 0);
      }
    }
  });

  it("blocks a dash while charging", () => {
    const s = standing();
    steps(s, press(), 1, ram);
    steps(s, press({ dash: true, moveX: 1 }), 1, ram);
    expect(s.dashTime).toBe(0);
    expect(s.vz).toBeCloseTo(-ram.speed);
  });
});

describe("pounce", () => {
  // Steps until the leap is over and returns how many steps it took.
  function leap(s: MechState, target: [number, number], extra: Partial<MechInput> = {}): number {
    steps(s, press({ targetX: target[0], targetZ: target[1], ...extra }), 1, pounce);
    expect(s.abilityTime).toBeGreaterThan(0);
    expect(s.grounded).toBe(false);
    let count = 1;
    while (s.abilityTime > 0 && count < 600) { steps(s, { ...createMechInput(), ...extra }, 1, pounce); count++; }
    return count;
  }

  it("comes down near an aim point in range and is over on landing", () => {
    const s = standing();
    const target: [number, number] = [6, -12];
    leap(s, target);
    expect(s.grounded).toBe(true);
    expect(s.abilityTime).toBe(0);
    expect(Math.hypot(s.x - target[0], s.z - target[1])).toBeLessThan(1.5);
    expect(s.abilityCooldown).toBeGreaterThan(0);
  });

  it("never reaches past its range, however far away the aim point is", () => {
    const s = standing();
    leap(s, [0, -500]);
    expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(pounce.maxRange + 0.5);
    expect(s.z).toBeLessThan(-5);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
  });

  it("leaps ahead when the aim point is at its own feet", () => {
    const s = standing();
    leap(s, [0.5, 0.5]);
    expect(s.z).toBeLessThan(-5);
  });

  it("cannot be steered or jetted in the air", () => {
    const s = standing();
    steps(s, press({ targetX: 0, targetZ: -12 }), 1, pounce);
    const vx = s.vx, vz = s.vz;
    steps(s, { ...createMechInput(), moveX: 1, jet: true }, 10, pounce);
    expect(s.jetting).toBe(false);
    expect(s.vx).toBe(vx);
    expect(s.vz).toBe(vz);
  });
});

describe("ability determinism and prediction", () => {
  // A fixed, varied input sequence: walking, turning, both abilities fired more than once.
  function inputAt(i: number): MechInput {
    return { ...createMechInput(), moveY: i % 90 < 60 ? 1 : 0, moveX: i % 50 < 10 ? 1 : 0, aimYaw: i * 0.01, ability: i % 120 === 30 || i % 500 === 400, targetX: 10 * Math.cos(i), targetZ: 10 * Math.sin(i) };
  }

  it("gives identical states for the same inputs, every time", () => {
    for (const ability of [ram, pounce]) {
      const a = createMechState(stats, 0, 0, 0, 0), b = createMechState(stats, 0, 0, 0, 0);
      for (let i = 0; i < 1200; i++) {
        stepMech(a, inputAt(i), stats, DT, flat, ability);
        stepMech(b, inputAt(i), stats, DT, flat, ability);
      }
      expect(a).toEqual(b);
      expect(a.abilityCooldown).toBeGreaterThan(0); // the abilities really were used
    }
  });

  it("lets the client replay a ram or a leap in flight with no correction", () => {
    for (const ability of [ram, pounce]) {
      const server = createMechState(stats, 0, 0, 0, 0);
      const client = new Predictor(() => stats, flat, 0, 0, 0, 0, () => ability);
      for (let i = 0; i < 40; i++) {
        stepMech(server, inputAt(i), stats, DT, flat, ability);
        client.step(inputAt(i), DT);
      }
      const ack = writeSelf(server);
      for (let i = 40; i < 50; i++) client.step(inputAt(i), DT);
      expect(client.state.abilityTime).toBeGreaterThan(0);
      expect(client.reconcile(40, ack, DT)).toBeLessThan(1e-9);
    }
  });
});
