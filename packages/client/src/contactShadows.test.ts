import { describe, expect, it } from "vitest";
import { Terrain, World, type Box } from "@rustbucket/shared";
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

describe("contact shadows on the hills", () => {
  // A 40 m map, 4 m cells, rising 0.5 m per metre along x from -10 m at its west edge.
  const corners = 11;
  const heights = new Int32Array(corners * corners);
  for (let j = 0; j < corners; j++) for (let i = 0; i < corners; i++) heights[j * corners + i] = Math.round((i * 4 - 20) * 50);
  const terrain = new Terrain(40, 4, heights, 0.5);

  it("go under a box standing on a raised pad, at the pad, and skip one stacked on it", () => {
    expect(shadowFootprint(box(-1, 5, -1, 1, 7, 1), look.static, out, 5)).toBe(true);
    expect(out.y).toBe(5);
    expect(shadowFootprint(box(-1, 7, -1, 1, 9, 1), look.static, out, 5)).toBe(false);
    // A box in a valley below 0 is still on the ground there.
    expect(shadowFootprint(box(-1, -6, -1, 1, -4, 1), look.static, out, -6)).toBe(true);
    expect(out.y).toBe(-6);
  });

  it("land on the hillside under a mech, or on a box top above it", () => {
    const world = new World([box(-30, -30, -30, 30, -29, 30), box(8, 0, -2, 12, 9, 2)], 16, terrain);
    const found: number[] = [];
    expect(surfaceBelow(world, -15, 20, 3, found)).toBeCloseTo(terrain.heightAt(-15, 3));
    expect(surfaceBelow(world, 10, 12, 0, found)).toBeCloseTo(9);
    expect(surfaceBelow(world, 10, 8, 0, found)).toBeCloseTo(terrain.heightAt(10, 0));
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
