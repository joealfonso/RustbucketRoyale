import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { parseWeapons } from "@rustbucket/shared";
import weaponsJson from "../../../data/weapons.json";
import weaponFxJson from "../../../data/weaponFx.json";
import { SlotRing } from "./fx/flipbook";
import { SpritePool } from "./fx/sprites";
import { capFor, flashFrame, nearestFamily, parseWeaponFx, sparkVelocity, usesAltLook, weaponFxFor } from "./weaponFxData";

const config = parseWeaponFx(weaponFxJson);

describe("weapon effects data", () => {
  it("has a look for every weapon in weapons.json, in its order", () => {
    const weapons = parseWeapons(weaponsJson).weapons;
    const fx = weaponFxFor(config, weapons);
    expect(fx).toHaveLength(weapons.length);
    weapons.forEach((w, i) => expect(fx[i]).toBe(config.weapons[w.id]));
  });

  it("refuses a weapon without a look", () => {
    expect(() => weaponFxFor(config, [{ id: "laserPointer" }])).toThrow(/laserPointer/);
  });

  it("refuses a bad file", () => {
    expect(() => parseWeaponFx({ ...weaponFxJson, lowShare: 2 })).toThrow(/lowShare/);
    const noFrames = JSON.parse(JSON.stringify(weaponFxJson));
    noFrames.weapons.autocannon.flash.frames = [];
    expect(() => parseWeaponFx(noFrames)).toThrow(/frames/);
  });
});

describe("flash flipbook", () => {
  it("steps through whole frames by age, then ends", () => {
    expect(flashFrame(0, 0.03, 3)).toBe(0);
    expect(flashFrame(0.029, 0.03, 3)).toBe(0);
    expect(flashFrame(0.031, 0.03, 3)).toBe(1);
    expect(flashFrame(0.065, 0.03, 3)).toBe(2);
    expect(flashFrame(0.09, 0.03, 3)).toBe(-1);
    expect(flashFrame(Infinity, 0.03, 3)).toBe(-1);
  });
});

describe("pools", () => {
  it("keeps the low setting's share of a pool, never none", () => {
    expect(capFor(48, "normal", 0.5)).toBe(48);
    expect(capFor(48, "low", 0.5)).toBe(24);
    expect(capFor(1, "low", 0.1)).toBe(1);
  });

  it("hands out slots in turn and reuses the oldest when full", () => {
    const ring = new SlotRing();
    const cap = capFor(8, "low", 0.5);
    const taken = Array.from({ length: 6 }, () => ring.take(cap));
    expect(taken).toEqual([0, 1, 2, 3, 0, 1]);
  });
});

describe("sparks", () => {
  const out = { x: 0, y: 0, z: 0 };

  it("fly off the face they hit, at up to the given speed", () => {
    for (let a = 0; a < 1; a += 0.1) for (let b = 0; b < 1; b += 0.1) {
      sparkVelocity(1, 0, 0, 10, 0.8, 0, a, b, 0.5, out);
      expect(out.x).toBeGreaterThan(0);
      expect(Math.hypot(out.x, out.y, out.z)).toBeLessThanOrEqual(10 + 1e-9);
      expect(Math.hypot(out.x, out.y, out.z)).toBeGreaterThanOrEqual(6 - 1e-9);
    }
  });

  it("are kicked upward by lift", () => {
    sparkVelocity(1, 0, 0, 10, 0, 0.5, 0.5, 0, 1, out);
    expect(out.y).toBeGreaterThan(0);
  });

  it("fall under gravity once they fly", () => {
    const pool = new SpritePool(new THREE.Scene(), { colors: ["#ffffff", "#ffcc00", "#884400"], growSteps: 3 }, (c) => c, 4, () => 4);
    const s = pool.spawn()!;
    s.life = 1; s.vx = 5; s.vy = 0; s.gravity = 24;
    pool.update(0.1, new THREE.Vector3());
    expect(s.vy).toBeCloseTo(-2.4);
    expect(s.y).toBeLessThan(0);
    expect(s.x).toBeCloseTo(0.5);
  });
});

describe("grit colours", () => {
  it("picks the family nearest the surface colour", () => {
    expect(nearestFamily("#c4622d", ["#5e7f3a", "#c4622d", "#6e7b80"])).toBe(1);
    expect(nearestFamily("#707c82", ["#5e7f3a", "#c4622d", "#6e7b80"])).toBe(2);
  });
});

describe("right-click looks (gate 18a)", () => {
  it("has a named alt look for every weapon, with the look its kind needs", () => {
    const weapons = parseWeapons(weaponsJson).weapons;
    for (const [i, fx] of weaponFxFor(config, weapons).entries()) {
      expect(fx.alt.name.length).toBeGreaterThan(0);
      const kind = weapons[i]!.secondary.kind;
      if (kind === "windup") { expect(fx.alt.glow).toBeDefined(); expect(fx.alt.vent).toBeDefined(); }
      if (kind === "charge") { expect(fx.alt.glow).toBeDefined(); expect(fx.alt.pin).toBeDefined(); }
    }
  });

  it("refuses a weapon with no alt look", () => {
    const raw = JSON.parse(JSON.stringify(weaponFxJson));
    delete raw.weapons.autocannon.alt;
    expect(() => parseWeaponFx(raw)).toThrow(/autocannon.alt/);
  });

  it("draws a partial charge as a plain spike and everything else right-click in the alt look", () => {
    expect(usesAltLook("charge", 0.6)).toBe(false);
    expect(usesAltLook("charge", 1)).toBe(true);
    expect(usesAltLook("slug", 1)).toBe(true);
    expect(usesAltLook("windup", 1)).toBe(true);
    expect(usesAltLook("windup", -1)).toBe(false);
  });
});
