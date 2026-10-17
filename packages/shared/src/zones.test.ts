import { describe, expect, it } from "vitest";
import zonesJson from "../../../data/zones.json";
import {
  ZONE_ARMS, ZONE_LEGS, ZONE_TORSO, applyDamage, createHealth, createZoneHit, isDestroyed, parseZones, raycastMech,
} from "./zones";

const set = parseZones(zonesJson);
const hit = createZoneHit();

// A mech at the origin facing -Z (yaw 0). Shoot from in front at various heights.
const shoot = (y: number, x = 0, yaw = 0, oz = -20, dz = 1) => raycastMech(x, y, oz, 0, 0, dz, 100, 0, 0, 0, yaw, set, hit);

describe("raycastMech", () => {
  it("hits legs low, torso in the middle", () => {
    expect(shoot(0.8)).toBe(true);
    expect(hit.zone).toBe(ZONE_LEGS);
    expect(shoot(2.4)).toBe(true);
    expect(hit.zone).toBe(ZONE_TORSO);
  });

  it("hits an arm from the side and misses above the head", () => {
    expect(shoot(2.4, -1.2)).toBe(true);
    expect(hit.zone).toBe(ZONE_ARMS);
    expect(shoot(4)).toBe(false);
  });

  it("turns the zones with the mech", () => {
    // Facing +X (yaw -90 degrees): the gun arm, which stuck out the front, now sits at world z = 1.2.
    expect(raycastMech(30, 2.4, 1.2, -1, 0, 0, 100, 0, 0, 0, -Math.PI / 2, set, hit)).toBe(true);
    expect(hit.zone).toBe(ZONE_ARMS);
  });

  it("respects the maximum distance", () => {
    expect(raycastMech(0, 2.4, -20, 0, 0, 1, 5, 0, 0, 0, 0, set, hit)).toBe(false);
  });
});

describe("damage", () => {
  it("takes hit points off a zone and never goes below zero", () => {
    const hp = createHealth(set);
    expect(applyDamage(hp, set, ZONE_ARMS, 25)).toBe(25);
    expect(hp[ZONE_ARMS]).toBe(35);
    expect(applyDamage(hp, set, ZONE_ARMS, 500)).toBe(35);
    expect(hp[ZONE_ARMS]).toBe(0);
  });

  it("lets armor soak damage first and only the rest reach the hit points", () => {
    const hp = createHealth(set);
    const armor = [0, 0, 30];
    expect(applyDamage(hp, set, ZONE_TORSO, 50, armor)).toBe(50);
    expect(armor[ZONE_TORSO]).toBe(0);
    expect(hp[ZONE_TORSO]).toBe(80);
    expect(applyDamage(hp, set, ZONE_TORSO, 10, armor)).toBe(10);
    expect(hp[ZONE_TORSO]).toBe(70);
  });

  it("the mech is only destroyed when the torso is gone", () => {
    const hp = createHealth(set);
    applyDamage(hp, set, ZONE_LEGS, 999);
    applyDamage(hp, set, ZONE_ARMS, 999);
    expect(isDestroyed(hp)).toBe(false);
    applyDamage(hp, set, ZONE_TORSO, 999);
    expect(isDestroyed(hp)).toBe(true);
  });

  it("rejects a malformed zone file", () => {
    expect(() => parseZones({ zones: [] })).toThrow();
    expect(() => parseZones({ zones: [{ name: "legs" }, { name: "arms" }, { name: "torso" }] })).toThrow();
  });
});
