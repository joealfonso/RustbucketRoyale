import { describe, expect, it } from "vitest";
import chunksJson from "../../../data/chunks.json";
import botsJson from "../../../data/bots.json";
import mechJson from "../../../data/mech.json";
import tiersJson from "../../../data/tiers.json";
import propsJson from "../../../data/props.json";
import { Terrain, buildNavGrid, generateMap, parseBotConfig, parseChunkSet, parseMechStats, parsePropConfig, parseTiers, type Box } from "@rustbucket/shared";
import { Pathfinder } from "./Pathfinder";

const pathStats = parseBotConfig(botsJson).path;
const mech = parseMechStats(mechJson);
const box = (minX: number, minZ: number, maxX: number, maxZ: number, maxY = 5): Box => ({ minX, minZ, maxX, maxZ, minY: 0, maxY });

// Thin posts, one in each of the eight 8 m route cells round the one centred on (x, z), 2 m off the middle of each so
// a mech can walk straight out between them. Cells on the 200 m test square run from -100 in steps of 8.
function clearingPosts(x: number, z: number): Box[] {
  const posts: Box[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dz !== 0) posts.push(box(x + dx * 8 + 2, z + dz * 8 + 2, x + dx * 8 + 2.5, z + dz * 8 + 2.5));
  }
  return posts;
}

// A 200 m square of open ground, with whatever walls the test adds.
function finder(walls: Box[], meters = 200) {
  const nav = buildNavGrid(walls, meters, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height });
  return new Pathfinder(nav, pathStats);
}

// A round hill 12 m high in the middle of the 200 m square, its sides rising 40 cm a metre: well over a step from one
// nav cell to the next, but walkable, as every generated slope is.
function hill(): Terrain {
  const cell = 4, meters = 200, corners = meters / cell + 1;
  const heights = new Int32Array(corners * corners);
  for (let j = 0; j < corners; j++) {
    for (let i = 0; i < corners; i++) {
      const r = Math.hypot(i * cell - meters / 2, j * cell - meters / 2);
      heights[j * corners + i] = Math.max(0, Math.round(1200 - 40 * r));
    }
  }
  return new Terrain(meters, cell, heights, 0.5);
}

function hillFinder(walls: Box[]) {
  const nav = buildNavGrid(walls, 200, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height }, hill());
  return new Pathfinder(nav, pathStats);
}

// Flat dry ground with a rectangle of water 0.8 m deep (the surface 10 cm under the dry ground, so it stays dry).
function pondFinder(minX: number, minZ: number, maxX: number, maxZ: number) {
  const cell = 4, meters = 200, corners = meters / cell + 1;
  const heights = new Int32Array(corners * corners);
  for (let j = 0; j < corners; j++) {
    for (let i = 0; i < corners; i++) {
      const x = i * cell - meters / 2, z = j * cell - meters / 2;
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) heights[j * corners + i] = -80;
    }
  }
  const terrain = new Terrain(meters, cell, heights, 0.5, -10, 0.1);
  const nav = buildNavGrid([], meters, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height }, terrain);
  return new Pathfinder(nav, pathStats, terrain);
}

// Whether any leg of the route passes over the rectangle.
function crosses(start: [number, number], path: number[], minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  let x = start[0], z = start[1];
  for (let i = 0; i < path.length; i += 2) {
    for (let t = 0; t <= 1; t += 0.02) {
      const px = x + (path[i]! - x) * t, pz = z + (path[i + 1]! - z) * t;
      if (px > minX && px < maxX && pz > minZ && pz < maxZ) return true;
    }
    x = path[i]!; z = path[i + 1]!;
  }
  return false;
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

  it("goes straight over a hill, which is walkable ground, not a wall", () => {
    const path: number[] = [];
    expect(hillFinder([]).findPath(-80, 0, 80, 0, path)).toBe(true);
    expect(path).toEqual([80, 0]);
  });

  it("still goes round a wall that stands on a hill", () => {
    const wall: Box = { minX: -2, maxX: 2, minZ: -40, maxZ: 40, minY: 0, maxY: 17 };
    const path: number[] = [];
    expect(hillFinder([wall]).findPath(-50, 0, 50, 0, path)).toBe(true);
    expect(path.length).toBeGreaterThan(2);
    let x = -50, z = 0;
    for (let i = 0; i < path.length; i += 2) {
      for (let t = 0; t <= 1; t += 0.02) {
        const px = x + (path[i]! - x) * t, pz = z + (path[i + 1]! - z) * t;
        expect(px > -2 && px < 2 && pz > -40 && pz < 40, `crosses the wall at ${px.toFixed(1)},${pz.toFixed(1)}`).toBe(false);
      }
      x = path[i]!; z = path[i + 1]!;
    }
  });

  it("goes round a pond when going round is only a little further", () => {
    const path: number[] = [];
    expect(pondFinder(-20, -20, 20, 20).findPath(-60, 0, 60, 0, path)).toBe(true);
    expect(path.slice(-2)).toEqual([60, 0]);
    // Inside the pond's shore by a few metres: the coarse cells along the very edge are mostly dry.
    expect(crosses([-60, 0], path, -16, -16, 16, 16)).toBe(false);
    expect(length([-60, 0], path)).toBeLessThan(160); // round the side, not off round the map
  });

  it("wades straight through when going round the water is far", () => {
    // A long channel with a gap of dry ground only at the far ends of the map.
    const path: number[] = [];
    expect(pondFinder(-8, -88, 8, 88).findPath(-60, 0, 60, 0, path)).toBe(true);
    expect(path.slice(-2)).toEqual([60, 0]);
    expect(length([-60, 0], path)).toBeLessThan(140);
  });

  it("on a dry map, routes are what they were before water", () => {
    const path: number[] = [];
    const nav = buildNavGrid([], 200, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height }, hill());
    expect(new Pathfinder(nav, pathStats, hill()).findPath(-80, 0, 80, 0, path)).toBe(true);
    expect(path).toEqual([80, 0]);
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

  it("says whether a route goes all the way, or stops where the search ran out of cells", () => {
    const wall = box(-5, -60, 5, 60);
    const path: number[] = [];
    const f = finder([wall]);
    f.findPath(-50, 0, 50, 0, path);
    expect(f.reachedGoal).toBe(true);
    const short = new Pathfinder(buildNavGrid([wall], 200, 0, 0, { cellMeters: 2, stepHeight: mech.stepHeight, mechHeight: mech.height }), { ...pathStats, maxNodes: 20 });
    expect(short.findPath(-50, 0, 50, 0, path)).toBe(true);
    expect(short.reachedGoal).toBe(false);
  });

  it("does not say a route goes all the way when the goal is cut off and it only goes as near as it can", () => {
    // A thin post in each of the eight coarse cells round the one centred on (8, 8): on the route grid that cell is
    // sealed in, though a mech walks out between the posts.
    const posts = clearingPosts(8, 8);
    const path: number[] = [];
    const f = finder(posts);
    f.findPath(8, 8, 8, 90, path); // from inside the clearing out
    expect(f.reachedGoal).toBe(false);
    f.findPath(8, 90, 8, 8, path); // from outside in
    expect(f.reachedGoal).toBe(false);
  });

  it("tells whether a straight walk is clear, ignoring the cell the walk starts in", () => {
    const f = finder([box(-5, -60, 5, 60)]);
    expect(f.canWalkStraight(-50, 0, -10, 40)).toBe(true);
    expect(f.canWalkStraight(-50, 0, 50, 0)).toBe(false);
    expect(f.canWalkStraight(-6, 0, -40, 0)).toBe(true); // standing right against the wall, walking away from it
  });

  it("with a heuristic weight above 1, looks at clearly fewer cells on a real large map for routes only a little longer", () => {
    const map = generateMap(7, "large", parseChunkSet(chunksJson), parseTiers(tiersJson), mech, parsePropConfig(propsJson));
    const exact = new Pathfinder(map.nav, { ...pathStats, heuristicWeight: 1 });
    const eager = new Pathfinder(map.nav, { ...pathStats, heuristicWeight: 1.5 });
    let seed = 7;
    const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 1800 - 900;
    const path: number[] = [];
    let compared = 0, ratio = 0, eagerWhole = 0, exactWhole = 0, eagerCells = 0, exactCells = 0;
    for (let i = 0; i < 150; i++) {
      const a = next(), b = next(), c = next(), d = next();
      exact.findPath(a, b, c, d, path);
      exactCells += exact.cellsSearched;
      const exactLength = length([a, b], path);
      eager.findPath(a, b, c, d, path);
      eagerCells += eager.cellsSearched;
      const eagerLength = length([a, b], path);
      if (exact.reachedGoal) exactWhole++;
      if (eager.reachedGoal) eagerWhole++;
      if (exact.reachedGoal && eager.reachedGoal && exactLength > 0) { ratio += eagerLength / exactLength; compared++; }
    }
    expect(eagerWhole).toBeGreaterThanOrEqual(exactWhole);
    expect(ratio / compared).toBeLessThan(1.1);
    // Under half before the outcrops (gate 15a); with more rock to route round, the saving is about a third.
    expect(eagerCells).toBeLessThan(exactCells * 0.75);
  });

  // Cost is counted in cells looked at, not milliseconds: a clock is at the mercy of whatever else the computer is doing
  // (the whole suite runs in parallel), and a cell count is the same everywhere. How fast each cell is gets watched by
  // the soak's tick budget. On seed 5 a search looks at about 460 cells on average, about 1.2 ms on a MacBook Air M4.
  it("is cheap on a real large map, across the whole of it, and nearly always finds a way", () => {
    const chunks = parseChunkSet(chunksJson);
    const tiers = parseTiers(tiersJson);
    const map = generateMap(5, "large", chunks, tiers, mech, parsePropConfig(propsJson));
    const f = new Pathfinder(map.nav, pathStats);
    const path: number[] = [];
    let found = 0, cells = 0;
    for (let i = 0; i < 20; i++) {
      const a = map.spawns[i % map.spawns.length]!, b = map.spawns[(i * 7 + 3) % map.spawns.length]!;
      if (f.findPath(a[0], a[2], b[0], b[2], path)) found++;
      cells += f.cellsSearched;
    }
    // A spawn can sit in a pocket that the coarse grid closes off. Then the bot just heads straight, which is fine.
    expect(found).toBeGreaterThanOrEqual(18);
    expect(cells / 20).toBeLessThan(1000);
  });
});
