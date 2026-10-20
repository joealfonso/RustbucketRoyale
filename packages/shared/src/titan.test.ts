import { describe, expect, it } from "vitest";
import titanJson from "../../../data/titan.json";
import { createGrenade, stepGrenade } from "./grenade";
import { STEP } from "./protocol";
import { aimCar, parseTitanConfig, titanHitBoxes } from "./titan";
import { World } from "./world";
import { createZoneHit, raycastMech } from "./zones";

const raw = () => JSON.parse(JSON.stringify(titanJson)) as Record<string, unknown>;

describe("the Junk Titan's data", () => {
  it("loads, with its hit boxes flattened into one list and each box's zone", () => {
    const config = parseTitanConfig(raw());
    expect(config.tiers).toEqual(["medium", "large"]);
    expect(config.zoneMultipliers).toHaveLength(3);
    expect(config.boxes.length).toBe(config.boxZone.length);
    expect(new Set(config.boxZone)).toEqual(new Set([0, 1, 2]));
  });

  it("refuses a bad file", () => {
    expect(() => parseTitanConfig({ ...raw(), hp: 0 })).toThrow(/hp/);
    expect(() => parseTitanConfig({ ...raw(), tiers: "medium" })).toThrow(/tiers/);
    const zones = raw().zones as { name: string }[];
    expect(() => parseTitanConfig({ ...raw(), zones: [zones[0], zones[1]] })).toThrow(/zones/);
    expect(() => parseTitanConfig({ ...raw(), fall: { ...(raw().fall as object), contents: ["cake"] } })).toThrow(/contents/);
  });

  it("is hit through the boxes measured from its model when there are some, its own boxes when not", () => {
    const config = parseTitanConfig(raw());
    const kits = { kits: { titan: { hitboxes: { legs: [{ center: [0, 1, 0], size: [1, 2, 1] }], arms: [], torso: [{ center: [0, 8, 0], size: [2, 2, 2] }] } } } };
    const measured = titanHitBoxes(config, kits);
    expect(measured.boxes).toHaveLength(2);
    expect(measured.boxZone).toEqual([0, 2]);
    expect(titanHitBoxes(config, null).boxes).toBe(config.boxes);
    expect(titanHitBoxes({ ...config, kit: null }, kits).boxes).toBe(config.boxes);
  });

  it("is hit through its boxes like a mech: a shot at its chest from the front hits the core", () => {
    const config = parseTitanConfig(raw());
    const hit = createZoneHit();
    // Facing yaw 0 is forward along -z, so a shot from -z travelling +z meets its front.
    expect(raycastMech(0, 7.5, -50, 0, 0, 1, 100, 0, 0, 0, 0, config, hit)).toBe(true);
    expect(hit.zone).toBe(2);
    expect(raycastMech(1.8, 1, -50, 0, 0, 1, 100, 0, 0, 0, 0, config, hit)).toBe(true);
    expect(hit.zone).toBe(0);
  });
});

describe("a thrown car", () => {
  it("lands on its aim point on the step its fuse runs out, flown by the grenade step", () => {
    const config = parseTitanConfig(raw());
    const world = new World([]);
    for (const [tx, ty, tz] of [[60, 0, 30], [-12, 3, 9], [0, -4, -79]] as const) {
      const car = createGrenade();
      aimCar(5, 11, -2, tx, ty, tz, config.throw.flightSeconds, config.car, STEP, car);
      let steps = 0;
      while (!stepGrenade(car, config.car, STEP, world)) steps++;
      expect(steps + 1).toBe(Math.round(config.throw.flightSeconds / STEP));
      expect(car.x).toBeCloseTo(tx, 6);
      expect(car.y).toBeCloseTo(ty, 6);
      expect(car.z).toBeCloseTo(tz, 6);
    }
  });

  it("goes up in a lob before it comes down", () => {
    const config = parseTitanConfig(raw());
    const car = createGrenade();
    aimCar(0, 11, 0, 80, 0, 0, config.throw.flightSeconds, config.car, STEP, car);
    let top = car.y;
    while (!stepGrenade(car, config.car, STEP, new World([]))) top = Math.max(top, car.y);
    expect(top).toBeGreaterThan(20);
  });
});
