import { describe, expect, it } from "vitest";
import weaponsJson from "../../../data/weapons.json";
import { FIRE_PRIMARY, FIRE_SECONDARY, createAltFireState, createAltShot, stepAltFire } from "./altFire";
import { createMechInput, type MechInput } from "./MechInput";
import { flightSteps, fromMechFrame, toMechFrame } from "./projectiles";
import { STEP } from "./protocol";
import { parseWeapons } from "./stats";
import { FireGate } from "./weapon";

const weapons = parseWeapons(weaponsJson).weapons;
const gun = (id: string) => weapons.find((w) => w.id === id)!;

describe("weapons.json, gate 18b", () => {
  it("has the rivet gun with its kinds, and the old guns are plain hitscan", () => {
    expect(gun("rivetGun").projectile.kind).toBe("rivet");
    expect(gun("rivetGun").secondary.kind).toBe("detonate");
    for (const id of ["autocannon", "scattergun", "spikeDriver"]) expect(gun(id).projectile.kind).toBe("hitscan");
  });

  it("refuses broken projectile and secondary blocks", () => {
    const withGun = (patch: Record<string, unknown>) => ({ start: "rivetGun", weapons: [{ ...(weaponsJson.weapons[3] as object), ...patch }] });
    expect(() => parseWeapons(withGun({ projectile: { kind: "rivet", fuseSeconds: 1, blastDamage: 1, blastRadius: 1, maxStuck: 0 } }))).toThrow(/maxStuck/);
    expect(() => parseWeapons(withGun({ projectile: { kind: "laser" } }))).toThrow(/kind/);
    expect(() => parseWeapons(withGun({ projectile: { kind: "hitscan" } }))).toThrow(/detonate needs a rivet/);
  });
});

describe("detonate trigger", () => {
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
});

describe("projectile helpers", () => {
  it("flight time is at least a step and grows with distance", () => {
    const rivets = gun("rivetGun");
    expect(flightSteps(0, rivets)).toBe(1);
    expect(flightSteps(rivets.projectileSpeed, rivets)).toBe(60);
  });

  it("a point in a mech's frame turns back to the same world point", () => {
    const local = { x: 0, y: 0, z: 0 }, back = { x: 0, y: 0, z: 0 };
    toMechFrame(3, 2, -4, 1, 0.5, 1, 0.8, local);
    fromMechFrame(local.x, local.y, local.z, 1, 0.5, 1, 0.8, back);
    expect(back.x).toBeCloseTo(3, 9); expect(back.y).toBeCloseTo(2, 9); expect(back.z).toBeCloseTo(-4, 9);
  });
});
