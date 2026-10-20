import { describe, expect, it } from "vitest";
import chunksJson from "../../../data/chunks.json";
import tiersJson from "../../../data/tiers.json";
import propsJson from "../../../data/props.json";
import mechJson from "../../../data/mech.json";
import { createMechInput } from "./MechInput";
import { createMechState, stepMech } from "./mechStep";
import { parseMechStats } from "./stats";
import { Terrain } from "./terrain";
import { TERRAIN_HIT, World, createRayHit } from "./world";
import { generateMap, parseChunkSet, parseTiers, validateMap } from "./generation";
import { parsePropConfig } from "./props";

const stats = parseMechStats(mechJson);
const tiers = parseTiers(tiersJson);
const STEP = 1 / 60;

// A single straight ramp along +x: 0 m at x = -40, rising 0.5 m per metre, up to 20 m at x = 0, flat after.
function ramp(): Terrain {
  const meters = 80, cell = 4, n = meters / cell + 1;
  const heights = new Int32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = Math.min(2000, i * cell * 50);
  return new Terrain(meters, cell, heights, 0.5);
}

describe("terrain", () => {
  it("gives the height between corners on the same two triangles the mesh is drawn with", () => {
    const t = ramp();
    expect(t.heightAt(-40, 0)).toBeCloseTo(0);
    expect(t.heightAt(-30, 5)).toBeCloseTo(5);
    expect(t.heightAt(10, -10)).toBeCloseTo(20);
    expect(t.heightAt(-999, 0)).toBeCloseTo(0); // outside: the nearest edge
  });

  it("stops a ray at a hillside and reports which way the slope faces", () => {
    const world = new World([], 16, ramp());
    const hit = createRayHit();
    // Level, 10 m up, heading up the ramp: it meets the slope where the ground reaches 10 m, at x = -20.
    expect(world.raycast(-38, 10, 0, 1, 0, 0, 100, hit)).toBe(true);
    expect(hit.index).toBe(TERRAIN_HIT);
    expect(hit.distance).toBeCloseTo(18, 1);
    expect(hit.normalX).toBeLessThan(0);
    expect(hit.normalY).toBeGreaterThan(0);
    expect(world.raycast(-38, 30, 0, 1, 0, 0, 100, hit)).toBe(false); // over the top of the hill
  });

  it("lets a mech walk up a slope and back down without leaving the ground", () => {
    const world = new World([], 16, ramp());
    const s = createMechState(stats, -35, 2.5, 0, Math.PI / 2);
    const up = { ...createMechInput(), moveY: 1, aimYaw: -Math.PI / 2 };
    let airborne = 0;
    for (let i = 0; i < 60 * 3; i++) { stepMech(s, up, stats, STEP, world); if (i > 30 && !s.grounded) airborne++; }
    expect(s.x).toBeGreaterThan(-20);
    expect(s.y).toBeCloseTo(world.groundAt(s.x, s.z), 3);
    const down = { ...up, aimYaw: Math.PI / 2 };
    for (let i = 0; i < 60 * 2; i++) { stepMech(s, down, stats, STEP, world); if (!s.grounded) airborne++; }
    expect(airborne).toBe(0);
    expect(s.y).toBeCloseTo(world.groundAt(s.x, s.z), 3);
  });
});

describe("generated hills", () => {
  const mech = { halfWidth: stats.halfWidth, height: stats.height, stepHeight: stats.stepHeight };
  const build = (seed: number, tier: string) => generateMap(seed, tier, parseChunkSet(chunksJson), tiers, mech, parsePropConfig(propsJson));

  for (const tier of ["small", "medium"]) {
    it(`${tier}: never steeper than the limit, and everything built stands on level ground`, () => {
      for (const seed of [1, 2, 3]) {
        const map = build(seed, tier);
        const t = map.terrain;
        const limit = tiers.terrain!.maxRisePercent / 100 + 1e-6;
        // Worst first, then one check: an expect per corner is far too slow on a medium map.
        let steepest = 0;
        for (let j = 0; j < t.corners; j++) for (let i = 0; i + 1 < t.corners; i++) {
          steepest = Math.max(steepest, Math.abs(t.corner(i + 1, j) - t.corner(i, j)) / t.cell, Math.abs(t.corner(j, i + 1) - t.corner(j, i)) / t.cell);
        }
        expect(steepest).toBeLessThanOrEqual(limit);
        const unlevel: number[] = [];
        map.boxes.forEach((b, k) => {
          if (k < 5 || map.propOfBox[k]! >= 0 || map.kindNames[map.kinds[k]!] === "boulder") return; // ground slab, edge walls, props and boulders sit on slopes
          const ground = [[b.minX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ], [b.maxX, b.minZ]].map(([x, z]) => t.heightAt(x!, z!));
          if (Math.max(...ground) - Math.min(...ground) >= 0.01) unlevel.push(k);
        });
        expect(unlevel, `${tier} seed ${seed}: boxes not on level ground`).toEqual([]);
        expect(t.maxHeight - t.minHeight).toBeGreaterThan(4); // there really are hills
      }
    });
  }

  it("is the same hills from the same seed, and different hills from another", () => {
    expect(build(7, "medium").terrain.heights).toEqual(build(7, "medium").terrain.heights);
    expect(build(7, "medium").terrain.heights).not.toEqual(build(8, "medium").terrain.heights);
  });

  it("keeps the map's edge at ground level and stands spawns and props on the ground", () => {
    const map = build(4, "small");
    const t = map.terrain;
    for (let i = 0; i < t.corners; i++) expect([t.corner(i, 0), t.corner(0, i), t.corner(i, t.corners - 1), t.corner(t.corners - 1, i)]).toEqual([0, 0, 0, 0]);
    for (const [x, y, z] of map.spawns) expect(y).toBeCloseTo(t.heightAt(x, z) + 0.05, 5);
    for (const p of map.props) expect(map.boxes[p.boxIndex]!.minY).toBeLessThanOrEqual(t.heightAt(p.x, p.z) + 1e-9);
  });

  it("keeps the arena flat", () => {
    const map = build(1, "arena");
    expect(map.terrain.maxHeight).toBe(0);
    expect(map.terrain.minHeight).toBe(0);
  });
});

describe("water", () => {
  const mech = { halfWidth: stats.halfWidth, height: stats.height, stepHeight: stats.stepHeight };
  const build = (seed: number, tier: string) => generateMap(seed, tier, parseChunkSet(chunksJson), tiers, mech, parsePropConfig(propsJson));

  for (const tier of ["small", "medium"]) {
    it(`${tier}: floods about its share of the lowest ground, never deeper than a wade, and keeps buildings level`, () => {
      const share = tiers.terrain!.tiers[tier]!.waterShare!;
      for (const seed of [1, 2]) {
        const map = build(seed, tier);
        const t = map.terrain;
        let wet = 0, deepest = 0;
        for (let k = 0; k < t.heights.length; k++) {
          const depth = t.waterLevel - t.heights[k]! / 100;
          if (depth > 0) { wet++; deepest = Math.max(deepest, depth); }
        }
        expect(wet / t.heights.length).toBeGreaterThan(share * 0.5);
        expect(wet / t.heights.length).toBeLessThan(share * 3);
        expect(deepest).toBeLessThanOrEqual(tiers.terrain!.water.maxDepthMeters + 1e-9);
        map.boxes.forEach((b, k) => {
          if (k < 5 || map.propOfBox[k]! >= 0 || map.kindNames[map.kinds[k]!] === "boulder") return;
          const ground = [[b.minX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ], [b.maxX, b.minZ]].map(([x, z]) => t.heightAt(x!, z!));
          expect(Math.max(...ground) - Math.min(...ground), `${tier} seed ${seed} box ${k}`).toBeLessThan(0.01);
          expect(b.minY).toBeGreaterThanOrEqual(Math.min(...ground) - 0.01); // nothing sunk under the raised bed
        });
      }
    });
  }

  it("is the same water from the same seed", () => {
    expect(build(5, "medium").terrain.waterLevel).toBe(build(5, "medium").terrain.waterLevel);
  });

  it("leaves the arena dry", () => {
    expect(build(1, "arena").terrain.waterLevel).toBe(-Infinity);
  });

  it("slows a wading mech to its share of walking speed, and not one jetting over the water", () => {
    // A flat bed 0.8 m under the water everywhere.
    const n = 21, heights = new Int32Array(n * n).fill(-80);
    const world = new World([], 16, new Terrain(80, 4, heights, 0.5, 0, 0.1));
    const s = createMechState(stats, 0, -0.8, 0, Math.PI);
    const walk = { ...createMechInput(), moveY: 1, aimYaw: Math.PI };
    for (let i = 0; i < 60; i++) stepMech(s, walk, stats, STEP, world);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(stats.walkSpeed * stats.waterSpeedMultiplier, 3);
    const dry = new World([], 16, Terrain.flat(80, 4));
    const d = createMechState(stats, 0, 0, 0, Math.PI);
    for (let i = 0; i < 60; i++) stepMech(d, walk, stats, STEP, dry);
    expect(Math.hypot(d.vx, d.vz)).toBeCloseTo(stats.walkSpeed, 3);
  });
});

describe("woods and boulders", () => {
  const mech = { halfWidth: stats.halfWidth, height: stats.height, stepHeight: stats.stepHeight };
  const props = parsePropConfig(propsJson);
  const build = (seed: number, tier: string) => generateMap(seed, tier, parseChunkSet(chunksJson), tiers, mech, props);
  const isTree = (type: number) => props.types[type]!.scenery === true;

  it("grows trees on dry open ground, standing on it, and the same trees from the same seed", () => {
    const map = build(11, "medium");
    const t = map.terrain;
    const trees = map.props.filter((p) => isTree(p.type));
    expect(trees.length).toBeGreaterThan(200);
    for (const p of trees) {
      const b = map.boxes[p.boxIndex]!;
      expect(t.waterDepthAt(p.x, p.z)).toBe(0);
      expect(b.minY).toBeLessThanOrEqual(t.heightAt(p.x, p.z) + 1e-9);
      expect(b.maxY - b.minY).toBeGreaterThan(8);
    }
    const again = build(11, "medium").props.filter((p) => isTree(p.type));
    expect(again.map((p) => [p.x, p.z])).toEqual(trees.map((p) => [p.x, p.z]));
  });

  it("keeps trees and boulders off buildings, other props and each other", () => {
    const map = build(2, "medium");
    const boulder = map.kindNames.indexOf("boulder");
    const scenery = map.boxes.map((_, k) => map.kinds[k] === boulder || (map.propOfBox[k]! >= 0 && isTree(map.props[map.propOfBox[k]!]!.type)));
    let checked = 0;
    const near: number[] = [];
    map.boxes.forEach((a, i) => {
      if (!scenery[i]) return;
      const count = map.world.query(a.minX, a.minZ, a.maxX, a.maxZ, near);
      for (let k = 0; k < count; k++) {
        const j = near[k]!;
        if (j === i || j <= 4) continue; // the ground slab and edge walls
        const b = map.boxes[j]!;
        const overlap = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
        expect(overlap, `box ${i} overlaps box ${j}`).toBe(false);
      }
      checked++;
    });
    expect(checked).toBeGreaterThan(100);
  });

  it("does not count trunks as walls for bot routes, but does count boulders", () => {
    const map = build(11, "medium");
    const grid = map.nav;
    const cellOf = (x: number, z: number) => Math.floor((z - grid.originZ) / grid.cell) * grid.cols + Math.floor((x - grid.originX) / grid.cell);
    const tree = map.props.find((p) => isTree(p.type))!;
    expect(grid.top[cellOf(tree.x, tree.z)]! - grid.ground[cellOf(tree.x, tree.z)]!).toBeLessThan(stats.stepHeight);
    const boulder = map.boxes.find((_, k) => map.kinds[k] === map.kindNames.indexOf("boulder"))!;
    const c = cellOf((boulder.minX + boulder.maxX) / 2, (boulder.minZ + boulder.maxZ) / 2);
    expect(grid.top[c]! - grid.ground[c]!).toBeGreaterThan(stats.stepHeight);
  });

  it("leaves the trees out of the crate and barrel density checks", () => {
    const map = build(2, "large");
    expect(map.props.filter((p) => isTree(p.type)).length).toBeGreaterThan(1000);
    // Over a thousand trees would blow the prop density limit if they counted.
    expect(validateMap(map, tiers, mech, props).problems.filter((p) => p.includes("density"))).toEqual([]);
  });
});

