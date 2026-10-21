import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import weaponsJson from "../../../data/weapons.json";
import { FIRE_NONE, FIRE_PRIMARY, FIRE_SECONDARY, chargeShare, createAltFireState, createAltShot, stepAltFire, type AltFireState, type AltShot } from "./altFire";
import { createMechInput, type MechInput } from "./MechInput";
import { createMechState, stepMech } from "./mechStep";
import { parseMechStats, parseWeapons, type WeaponStats } from "./stats";
import { FireGate } from "./weapon";
import { World, boxFromData } from "./world";

const DT = 1 / 60;
const weapons = parseWeapons(weaponsJson).weapons;
const gun = (id: string) => weapons.find((w) => w.id === id)!;

// Steps both triggers for `seconds` and counts what fired.
function hold(state: AltFireState, gate: FireGate, weapon: WeaponStats, input: MechInput, clock: { t: number }, seconds: number, out: AltShot = createAltShot()) {
  const shots = { primary: 0, secondary: 0, last: out };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    clock.t += DT;
    if (stepAltFire(state, gate, input, weapon, clock.t, DT, 1, out)) {
      if (out.mode === FIRE_PRIMARY) shots.primary++;
      else shots.secondary++;
    }
  }
  return shots;
}

const alt = (): MechInput => ({ ...createMechInput(), altFire: true });
const fire = (): MechInput => ({ ...createMechInput(), fire: true });

describe("windup (autocannon)", () => {
  const ac = gun("autocannon");
  const sec = ac.secondary;
  if (sec.kind !== "windup") throw new Error("autocannon should wind up");

  it("starts at the gun's own rate and climbs to the top rate over windupSeconds", () => {
    const state = createAltFireState(), gate = new FireGate(), clock = { t: 0 };
    const early = hold(state, gate, ac, alt(), clock, 0.5).secondary;
    hold(state, gate, ac, createMechInput(), clock, 3); // let it cool and spin down
    hold(state, gate, ac, alt(), clock, sec.windupSeconds);
    expect(state.windup).toBeCloseTo(1, 6);
    const fast = hold(state, gate, ac, alt(), clock, 0.5).secondary;
    expect(early).toBeLessThanOrEqual(Math.ceil(ac.shotsPerSecond * 0.5 * 1.4));
    expect(fast).toBeGreaterThanOrEqual(Math.floor(ac.shotsPerSecond * sec.maxRateMultiplier * 0.5 * 0.85));
    expect(fast).toBeGreaterThan(early * 1.5);
  });

  it("overheats at full heat and locks both triggers until the vent ends", () => {
    const state = createAltFireState(), gate = new FireGate(), clock = { t: 0 };
    let held = 0;
    while (state.overheat === 0 && held < 30) { hold(state, gate, ac, alt(), clock, DT); held += DT; }
    expect(state.overheat).toBeGreaterThan(0);
    // Long enough to be a fight, short enough to be a choice: a few seconds of the right button from cold.
    expect(held).toBeGreaterThan(1.5);
    expect(held).toBeLessThan(6);
    expect(state.heat).toBe(1);
    // Locked: neither the right nor the left button fires.
    const both = { ...alt(), fire: true };
    const locked = hold(state, gate, ac, both, clock, sec.overheatSeconds * 0.8);
    expect(locked.primary + locked.secondary).toBe(0);
    hold(state, gate, ac, createMechInput(), clock, sec.overheatSeconds * 0.3);
    expect(state.overheat).toBe(0);
    expect(state.heat).toBe(0);
    expect(hold(state, gate, ac, fire(), clock, 0.5).primary).toBeGreaterThan(0);
  });

  it("cools when the right button is up, so short bursts never overheat", () => {
    const state = createAltFireState(), gate = new FireGate(), clock = { t: 0 };
    for (let i = 0; i < 10; i++) {
      hold(state, gate, ac, alt(), clock, 1);
      hold(state, gate, ac, createMechInput(), clock, 1.5);
    }
    expect(state.overheat).toBe(0);
    expect(state.heat).toBeLessThan(0.5);
  });

  it("lays its own spread over the gun's", () => {
    const state = createAltFireState(), gate = new FireGate(), out = createAltShot();
    expect(stepAltFire(state, gate, alt(), ac, DT, DT, 1, out)).toBe(true);
    expect(out.mode).toBe(FIRE_SECONDARY);
    expect(out.weapon.spreadDegrees).toBe(sec.spreadDegrees);
    expect(out.weapon.damage).toBe(ac.damage);
  });
});

describe("slug (scattergun)", () => {
  const sg = gun("scattergun");
  const sec = sg.secondary;
  if (sec.kind !== "slug") throw new Error("scattergun should fire a slug");

  it("fires one heavy, tight, long shot at its own rate", () => {
    const state = createAltFireState(), gate = new FireGate(), out = createAltShot();
    expect(stepAltFire(state, gate, alt(), sg, DT, DT, 1, out)).toBe(true);
    expect(out.mode).toBe(FIRE_SECONDARY);
    expect(out.weapon).toMatchObject({ pellets: 1, damage: sec.damage, spreadDegrees: sec.spreadDegrees, maxAimDistance: sec.maxAimDistance });
    expect(out.share).toBe(1);
    const shots = hold(state, gate, sg, alt(), { t: DT }, 10).secondary;
    expect(shots).toBeGreaterThanOrEqual(Math.floor(sec.shotsPerSecond * 10) - 1);
    expect(shots).toBeLessThanOrEqual(Math.ceil(sec.shotsPerSecond * 10));
  });

  it("leaves the pellets alone on the left button", () => {
    const out = createAltShot();
    stepAltFire(createAltFireState(), new FireGate(), fire(), sg, DT, DT, 1, out);
    expect(out.mode).toBe(FIRE_PRIMARY);
    expect(out.weapon.pellets).toBe(sg.pellets);
  });
});

describe("charge (spike driver)", () => {
  const sd = gun("spikeDriver");
  const sec = sd.secondary;
  if (sec.kind !== "charge") throw new Error("spike driver should charge");

  const chargeFor = (seconds: number) => {
    const state = createAltFireState(), gate = new FireGate(), clock = { t: 0 }, out = createAltShot();
    expect(hold(state, gate, sd, alt(), clock, seconds, out).secondary).toBe(0); // nothing while held
    const share = chargeShare(state, sd);
    expect(hold(state, gate, sd, createMechInput(), clock, DT, out).secondary).toBe(1); // fires on release
    return { out, share };
  };

  it("scales damage from minDamageShare to full with the charge", () => {
    const tap = chargeFor(DT);
    expect(tap.out.share).toBeCloseTo(sec.minDamageShare, 1);
    const half = chargeFor(sec.chargeSeconds / 2);
    expect(half.share).toBeCloseTo(0.5, 1);
    expect(half.out.weapon.damage).toBeCloseTo(sd.damage * (sec.minDamageShare + (1 - sec.minDamageShare) * 0.5), 0);
    expect(half.out.pierce).toBe(0);
    expect(half.out.pinSeconds).toBe(0);
  });

  it("pierces and pins at full charge, and holds there", () => {
    const full = chargeFor(sec.chargeSeconds * 3);
    expect(full.share).toBe(1);
    expect(full.out.share).toBe(1);
    expect(full.out.weapon.damage).toBe(sd.damage);
    expect(full.out.pierce).toBe(sec.pierceMechs);
    expect(full.out.pinSeconds).toBe(sec.pinSeconds);
    expect(full.out.pinSpeedShare).toBe(sec.pinSpeedShare);
  });

  it("drops the charge when the gun changes", () => {
    const state = createAltFireState(), gate = new FireGate(), clock = { t: 0 };
    hold(state, gate, sd, alt(), clock, 1);
    expect(state.charge).toBeGreaterThan(0);
    const out = createAltShot();
    stepAltFire(state, gate, createMechInput(), gun("autocannon"), clock.t + DT, DT, 1, out);
    expect(out.mode).toBe(FIRE_NONE);
    expect(state.charge).toBe(0);
  });
});

describe("pin in the mech step", () => {
  const stats = parseMechStats(mechJson);
  const world = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "#fff" })]);
  const walk = { ...createMechInput(), moveY: 1 };

  it("slows walking to the pin's share, then wears off", () => {
    const s = createMechState(stats, 0, 0, 0, 0);
    for (let i = 0; i < 60; i++) stepMech(s, createMechInput(), stats, DT, world);
    s.pinTime = 1; s.pinSpeed = 0.25;
    for (let i = 0; i < 30; i++) stepMech(s, walk, stats, DT, world);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(stats.walkSpeed * 0.25, 1);
    for (let i = 0; i < 90; i++) stepMech(s, walk, stats, DT, world);
    expect(s.pinTime).toBe(0);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(stats.walkSpeed, 1);
  });
});

describe("weapons.json secondaries", () => {
  it("refuses a missing or broken secondary", () => {
    const copy = () => JSON.parse(JSON.stringify(weaponsJson));
    const none = copy(); delete none.weapons[0].secondary;
    expect(() => parseWeapons(none)).toThrow(/kind/);
    const kind = copy(); kind.weapons[0].secondary.kind = "laser";
    expect(() => parseWeapons(kind)).toThrow(/kind/);
    const zero = copy(); zero.weapons[2].secondary.chargeSeconds = 0;
    expect(() => parseWeapons(zero)).toThrow(/chargeSeconds/);
    const share = copy(); share.weapons[2].secondary.pinSpeedShare = 2;
    expect(() => parseWeapons(share)).toThrow(/pinSpeedShare/);
  });
});
