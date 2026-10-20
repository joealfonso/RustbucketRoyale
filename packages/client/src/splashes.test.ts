import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Terrain, World, type Box } from "@rustbucket/shared";
import waterJson from "../../../data/water.json";
import { AXIS, FLAT, type Sprite, type SpritePool } from "./fx/sprites";
import { Projectiles } from "./projectiles";
import { Splashes, waterCrossing, wadingAt } from "./splashes";
import { parseWaterLook } from "./waterLook";

// A 40 m square, dry ground at 0 with a pond in the middle (corners within 10 m of the centre 1.5 m down) and the
// water standing 0.5 m down.
function pond(): Terrain {
  const cells = 10, cell = 4, n = cells + 1;
  const heights = new Int32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    heights[j * n + i] = Math.hypot(i * cell - 20, j * cell - 20) < 10 ? -150 : 0;
  }
  return new Terrain(cells * cell, cell, heights, 0.5, -50, 0.1);
}

const look = parseWaterLook(waterJson);

// Stands in for a sprite pool: hands out fresh sprites and keeps them for the test to look at.
function fakePool(): { pool: SpritePool; spawned: Sprite[] } {
  const spawned: Sprite[] = [];
  const pool = { spawn: () => { const s = { mode: 0 } as Sprite; spawned.push(s); return s; } } as unknown as SpritePool;
  return { pool, spawned };
}

describe("wading", () => {
  it("is standing in the pond, not on dry ground, flying over it, or on a map with no water", () => {
    const terrain = pond();
    expect(wadingAt(terrain, 0, terrain.heightAt(0, 0), 0)).toBe(true);
    expect(wadingAt(terrain, -18, 0, -18)).toBe(false);
    expect(wadingAt(terrain, 0, 3, 0)).toBe(false);
    expect(wadingAt(Terrain.flat(40, 4), 0, 0, 0)).toBe(false);
    expect(wadingAt(null, 0, 0, 0)).toBe(false);
  });
});

describe("waterCrossing", () => {
  const terrain = pond();
  const down = Math.SQRT1_2;

  it("finds where a shot going down into the pond crosses the surface", () => {
    // From 4.5 m over the pond at 45 degrees: 5 m drop to the water level.
    const t = waterCrossing(terrain, -2, 4.5, 0, down, -down, 0, 20);
    expect(t).toBeCloseTo(5 / down);
    expect(4.5 - down * t).toBeCloseTo(terrain.waterLevel);
  });

  it("finds nothing for a shot that stops short of the water, stays level, or crosses the level over dry ground", () => {
    expect(waterCrossing(terrain, -2, 4.5, 0, down, -down, 0, 3)).toBe(-1);
    expect(waterCrossing(terrain, -2, 4.5, 0, 1, 0, 0, 20)).toBe(-1);
    expect(waterCrossing(terrain, -18, 4.5, -18, 0, -1, 0, 20)).toBe(-1);
    expect(waterCrossing(Terrain.flat(40, 4), 0, 4.5, 0, 0, -1, 0, 20)).toBe(-1);
  });
});

describe("splashes", () => {
  it("lay a ripple ring on the surface and throw spray up from it", () => {
    const { pool, spawned } = fakePool();
    new Splashes(pool, look.splashes).wade(3, -0.5, 4);
    expect(spawned.length).toBe(1 + look.splashes.wade.drops);
    const [ring, ...drops] = spawned;
    expect(ring!.mode).toBe(FLAT);
    expect(ring!.y).toBeCloseTo(-0.5 + look.splashes.lift);
    expect(ring!.size1).toBe(look.splashes.wade.ringMeters);
    for (const d of drops) {
      expect(d.mode).toBe(AXIS);
      expect(d.vy).toBeGreaterThanOrEqual(look.splashes.wade.dropSpeed[0]);
      expect(d.gravity).toBe(look.splashes.gravity);
    }
  });

  it("are bigger for a landing than for a step", () => {
    const step = fakePool(), land = fakePool();
    new Splashes(step.pool, look.splashes).wade(0, 0, 0);
    new Splashes(land.pool, look.splashes).landing(0, 0, 0);
    expect(land.spawned[0]!.size1).toBeGreaterThan(step.spawned[0]!.size1);
    expect(land.spawned.length).toBeGreaterThan(step.spawned.length);
  });
});

describe("a tracer through water", () => {
  const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box => ({ minX, minY, minZ, maxX, maxY, maxZ });
  const tracerLook = { pool: 4, length: 2, width: 0.1, core: "#ffffff", coreShare: 0.4 };

  function fire(world: World, ox: number, oz: number) {
    const tracer = new Projectiles(new THREE.Scene(), tracerLook, "#ffffff", "#ffffff", () => 4);
    const splashes: number[][] = [], impacts: number[][] = [];
    tracer.onWater = (x, y, z) => splashes.push([x, y, z]);
    tracer.onImpact = (x, y, z) => impacts.push([x, y, z]);
    const d = Math.SQRT1_2;
    tracer.spawn(ox, 4.5, oz, d, -d, 0, 200, 1, false);
    for (let i = 0; i < 60; i++) tracer.update(1 / 60, world);
    return { splashes, impacts };
  }

  it("splashes where it crosses the surface and throws no sparks off the bed", () => {
    const terrain = pond();
    const world = new World([box(-30, -30, -30, 30, -29, 30)], 16, terrain);
    const { splashes, impacts } = fire(world, -6, 0);
    expect(splashes.length).toBe(1);
    const [x, y, z] = splashes[0]!;
    expect(y).toBeCloseTo(terrain.waterLevel);
    expect(x).toBeCloseTo(-6 + 5); // a 5 m drop at 45 degrees
    expect(z).toBeCloseTo(0);
    expect(impacts.length).toBe(0);
  });

  it("hits dry ground with sparks and no splash", () => {
    const terrain = pond();
    const world = new World([box(-30, -30, -30, 30, -29, 30)], 16, terrain);
    const { splashes, impacts } = fire(world, -19, -18);
    expect(splashes.length).toBe(0);
    expect(impacts.length).toBe(1);
  });
});
