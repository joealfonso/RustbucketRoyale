import { describe, expect, it } from "vitest";
import chunksJson from "../../../data/chunks.json";
import botsJson from "../../../data/bots.json";
import mechJson from "../../../data/mech.json";
import tiersJson from "../../../data/tiers.json";
import propsJson from "../../../data/props.json";
import { buildNavGrid, generateMap, parseBotConfig, parseChunkSet, parseMechStats, parsePropConfig, parseTiers, type Box } from "@rustbucket/shared";
import { Pathfinder } from "./Pathfinder";

const pathStats = parseBotConfig(botsJson).path;
const mech = parseMechStats(mechJson);
const box = (minX: number, minZ: number, maxX: number, maxZ: number, maxY = 5): Box => ({ minX, minZ, maxX, maxZ, minY: 0, maxY });

// A 200 m square of open ground, with whatever walls the test adds.
function finder(walls: Box[], meters = 200) {
  const nav = buildNavGrid(walls, meters, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height });
  return new Pathfinder(nav, pathStats);
}

function length(start: [number, number], path: number[]): number {
  let total = 0, x = start[0], z = start[1];
  for (let i = 0; i < path.length; i += 2) { total += Math.hypot(path[i]! - x, path[i + 1]! - z); x = path[i]!; z = path[i + 1]!; }
  return total;
}

describe("Pathfinder", () => {
  it("goes straight over open ground, in one leg", () => {
    const path: number[] = [];
    expect(finder([]).findPath(-80, -80, 80, 70, path)).toBe(true);
    expect(path).toEqual([80, 70]);
  });

  it("goes round a long wall instead of through it", () => {
    const wall = box(-5, -60, 5, 60);
    const f = finder([wall]);
    const path: number[] = [];
    expect(f.findPath(-50, 0, 50, 0, path)).toBe(true);
    expect(path.length).toBeGreaterThan(2); // more than one leg
    // Every leg avoids the wall.
    let x = -50, z = 0;
    for (let i = 0; i < path.length; i += 2) {
      for (let t = 0; t <= 1; t += 0.02) {
        const px = x + (path[i]! - x) * t, pz = z + (path[i + 1]! - z) * t;
        expect(px > -5 && px < 5 && pz > -60 && pz < 60, `crosses the wall at ${px.toFixed(1)},${pz.toFixed(1)}`).toBe(false);
      }
      x = path[i]!; z = path[i + 1]!;
    }
    expect(length([-50, 0], path)).toBeLessThan(220); // a sensible detour, not a wander
    expect(path.at(-2)).toBe(50);
  });

  it("finds its way out of a pocket with one opening", () => {
    // A U shaped enclosure open to the left, with the start inside and the goal to the right outside.
    const walls = [box(-30, 20, 30, 24), box(-30, -24, 30, -20), box(26, -24, 30, 24)];
    const path: number[] = [];
    expect(finder(walls).findPath(0, 0, 70, 0, path)).toBe(true);
    expect(path.at(-2)).toBeCloseTo(70, 0);
  });

  it("starts from, and aims at, a spot inside a blocked cell by using the nearest open one", () => {
    const wall = box(-3, -3, 3, 3);
    const path: number[] = [];
    expect(finder([wall]).findPath(0, 0, 60, 0, path)).toBe(true);
    expect(finder([wall]).findPath(60, 0, 0, 0, path)).toBe(true);
  });

  it("heads as near as it can when the goal is walled in completely", () => {
    const ring = [box(-30, 28, 30, 34), box(-30, -34, 30, -28), box(-34, -34, -28, 34), box(28, -34, 34, 34)];
    const path: number[] = [];
    const ok = finder(ring).findPath(-80, 0, 0, 0, path);
    expect(ok).toBe(true);
    const last = [path.at(-2)!, path.at(-1)!];
    expect(Math.hypot(last[0]! - 0, last[1]! - 0)).toBeLessThan(45); // right outside the walls, which end 34 m out
  });

  it("with a heuristic weight, takes a route no longer than that many times the shortest", () => {
    const walls = [box(-5, -60, 5, 60), box(30, -90, 36, 20), box(-40, 40, -34, 95)];
    const shortest: number[] = [], weighted: number[] = [];
    const nav = buildNavGrid(walls, 200, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height });
    new Pathfinder(nav, { ...pathStats, heuristicWeight: 1 }).findPath(-60, 80, 70, -70, shortest);
    new Pathfinder(nav, { ...pathStats, heuristicWeight: 2 }).findPath(-60, 80, 70, -70, weighted);
    expect(weighted.slice(-2)).toEqual([70, -70]);
    expect(length([-60, 80], weighted)).toBeLessThanOrEqual(length([-60, 80], shortest) * 2);
  });

  it("allows a set number of searches per tick, then more on the next", () => {
    const f = finder([]);
    const path: number[] = [];
    for (let i = 0; i < pathStats.searchesPerTick; i++) {
      expect(f.canSearch()).toBe(true);
      f.findPath(-80, -80, 80, 70, path);
    }
    expect(f.canSearch()).toBe(false);
    f.newTick();
    expect(f.canSearch()).toBe(true);
  });

  it("is quick on a real large map, across the whole of it, and nearly always finds a way", () => {
    const chunks = parseChunkSet(chunksJson);
    const tiers = parseTiers(tiersJson);
    const map = generateMap(5, "large", chunks, tiers, mech, parsePropConfig(propsJson));
    const f = new Pathfinder(map.nav, pathStats);
    const path: number[] = [];
    const started = Date.now();
    let found = 0;
    for (let i = 0; i < 20; i++) {
      const a = map.spawns[i % map.spawns.length]!, b = map.spawns[(i * 7 + 3) % map.spawns.length]!;
      if (f.findPath(a[0], a[2], b[0], b[2], path)) found++;
    }
    const perSearch = (Date.now() - started) / 20;
    // A spawn can sit in a pocket that the coarse grid closes off. Then the bot just heads straight, which is fine.
    expect(found).toBeGreaterThanOrEqual(18);
    expect(perSearch).toBeLessThan(15);
  });
});
