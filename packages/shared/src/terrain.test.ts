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
import { generateMap, parseChunkSet, parseTiers } from "./generation";
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
        for (let j = 0; j < t.corners; j++) for (let i = 0; i + 1 < t.corners; i++) {
          expect(Math.abs(t.corner(i + 1, j) - t.corner(i, j)) / t.cell).toBeLessThanOrEqual(limit);
          expect(Math.abs(t.corner(j, i + 1) - t.corner(j, i)) / t.cell).toBeLessThanOrEqual(limit);
        }
        map.boxes.forEach((b, k) => {
          if (k < 5 || map.propOfBox[k]! >= 0) return; // ground slab, edge walls, props (props sit on slopes)
          const ground = [[b.minX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ], [b.maxX, b.minZ]].map(([x, z]) => t.heightAt(x!, z!));
          expect(Math.max(...ground) - Math.min(...ground), `${tier} seed ${seed} box ${k}`).toBeLessThan(0.01);
        });
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
