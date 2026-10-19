import { describe, expect, it } from "vitest";
import { World, type Box } from "@rustbucket/shared";
import groundJson from "../../../data/ground.json";
import { parseShadowLook, shadowFootprint, shadowScale, shadowStrength, surfaceBelow, type Footprint } from "./contactShadows";

const look = parseShadowLook(groundJson.shadows);
const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box => ({ minX, minY, minZ, maxX, maxY, maxZ });
const out: Footprint = { x: 0, z: 0, y: 0, sizeX: 0, sizeZ: 0, soft: 0 };

describe("static contact shadows", () => {
  it("reach past a crate's footprint by a margin that grows with its height, within the limits", () => {
    expect(shadowFootprint(box(-1, 0, -1, 1, 2, 1), look.static, out)).toBe(true);
    const grow = Math.min(look.static.maxGrow, Math.max(look.static.minGrow, 2 * look.static.growPerMeter));
    expect(out.x).toBe(0);
    expect(out.sizeX).toBeCloseTo(2 + grow * 2);
    expect(out.sizeZ).toBeCloseTo(2 + grow * 2);
    expect(out.soft).toBeCloseTo(grow);
    shadowFootprint(box(0, 0, 0, 40, 100, 1), look.static, out);
    expect(out.soft).toBe(look.static.maxGrow);
    expect(out.sizeX).toBeCloseTo(40 + look.static.maxGrow * 2);
  });

  it("skip the floor, flat strips and anything stacked on top of another box", () => {
    expect(shadowFootprint(box(-500, -1, -500, 500, 0, 500), look.static, out)).toBe(false);
    expect(shadowFootprint(box(0, 0, 0, 10, 0.05, 10), look.static, out)).toBe(false);
    expect(shadowFootprint(box(0, 2.6, 0, 6, 5.2, 2.4), look.static, out)).toBe(false);
  });
});

describe("moving contact shadows", () => {
  it("are darkest and biggest on the ground, and shrink and fade to nothing as a mech rises", () => {
    const m = look.moving;
    expect(shadowStrength(0, m)).toBe(m.darkness);
    expect(shadowScale(0, m)).toBe(1);
    expect(shadowStrength(m.fadeHeight / 2, m)).toBeCloseTo(m.darkness / 2);
    expect(shadowScale(m.fadeHeight / 2, m)).toBeGreaterThan(m.minScale);
    expect(shadowStrength(m.fadeHeight * 3, m)).toBe(0);
    expect(shadowScale(m.fadeHeight * 3, m)).toBeCloseTo(m.minScale);
    expect(shadowStrength(-1, m)).toBe(m.darkness);
  });

  it("land on the highest surface below the mech: a box top it stands on or flies over, else the floor", () => {
    const world = new World([box(-50, -1, -50, 50, 0, 50), box(0, 0, 0, 6, 2.6, 2.4)]);
    const found: number[] = [];
    expect(surfaceBelow(world, 3, 2.6, 1, found)).toBeCloseTo(2.6);
    expect(surfaceBelow(world, 3, 10, 1, found)).toBeCloseTo(2.6);
    expect(surfaceBelow(world, 3, 1, 1, found)).toBe(0); // beside the box's top, below it: not on it
    expect(surfaceBelow(world, 20, 5, 20, found)).toBe(0);
    world.disable(1); // a broken prop no longer holds anything up
    expect(surfaceBelow(world, 3, 10, 1, found)).toBe(0);
  });
});

describe("shadow settings", () => {
  it("are checked on load", () => {
    expect(() => parseShadowLook({ ...groundJson.shadows, moving: { ...groundJson.shadows.moving, fadeHeight: 0 } })).toThrow();
    expect(() => parseShadowLook({ ...groundJson.shadows, static: { ...groundJson.shadows.static, minGrow: 5, maxGrow: 1 } })).toThrow();
    expect(() => parseShadowLook({ color: "soot" })).toThrow();
  });
});
