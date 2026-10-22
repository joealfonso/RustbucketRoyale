import { describe, expect, it } from "vitest";
import mechJson from "../../../../data/mech.json";
import tiersJson from "../../../../data/tiers.json";
import backdropJson from "../../../../data/backdrop.json";
import dressingJson from "../../../../data/dressing.json";
import chunksJson from "../../../../data/chunks.json";
import { generateMap, parseChunkSet, parseMechStats, parseTiers } from "@rustbucket/shared";
import { propConfig } from "../loadMap";
import { farBay, nearBay, planBay } from "./edgeBay";
import { edgeBoxIndices, edgeChunks, edgeRuns, parseBarrier, parseEdgeVariety, runToWorld } from "./edgeLayout";
import { seedOf } from "./kinds";
import { turn } from "./shapes";

const config = { ...parseBarrier(backdropJson.barrier), variety: parseEdgeVariety(dressingJson.edge) };
const mech = parseMechStats(mechJson);
// Every tier is an island now, with no edge wall; a tier still gets one when its island section is taken out.
const walled = parseTiers(tiersJson);
for (const t of Object.values(walled.terrain!.tiers)) delete t.island;
const buildPlayMap = (tier: string, seed: number, m: typeof mech) => ({ ...generateMap(seed, tier, parseChunkSet(chunksJson), walled, m, propConfig), seed });

describe("edge barrier", () => {
  it("finds the four edge walls on every tier and cuts them into whole bays", () => {
    for (const tier of ["small", "medium", "large"] as const) {
      const map = buildPlayMap(tier, 7, mech);
      const edges = edgeBoxIndices(map.boxes, map.meters);
      expect(edges).toHaveLength(4);
      const runs = edgeRuns(map.boxes, edges, config.bayMeters);
      const meters = tiersJson.tiers[tier].meters, thick = tiersJson.edgeWallThickness;
      const bays = runs.reduce((n, r) => n + r.bays, 0);
      // Two runs span the corners too, so the whole edge is a little over four sides.
      expect(bays).toBe(2 * Math.round((meters + 2 * thick) / config.bayMeters) + 2 * Math.round(meters / config.bayMeters));
      for (const run of runs) expect(Math.abs(run.bayLength - config.bayMeters)).toBeLessThan(config.bayMeters / 2);
      const chunks = edgeChunks(runs, config.baysPerChunk);
      expect(chunks.reduce((n, c) => n + c.bayCount, 0)).toBe(bays);
    }
  });

  it("each run's frame lands its corners on its wall box, with w pointing into the map", () => {
    const map = buildPlayMap("small", 3, mech);
    for (const run of edgeRuns(map.boxes, edgeBoxIndices(map.boxes, map.meters), config.bayMeters)) {
      const b = map.boxes[run.box]!;
      for (const [u, w] of [[0, 0], [run.length, run.thickness]]) {
        const [x, , z] = runToWorld(run, u!, 0, w!);
        expect(x).toBeGreaterThanOrEqual(b.minX - 1e-6); expect(x).toBeLessThanOrEqual(b.maxX + 1e-6);
        expect(z).toBeGreaterThanOrEqual(b.minZ - 1e-6); expect(z).toBeLessThanOrEqual(b.maxZ + 1e-6);
      }
      const outer = runToWorld(run, run.length / 2, 0, 0), inner = runToWorld(run, run.length / 2, 0, run.thickness);
      expect(Math.hypot(inner[0], inner[2])).toBeLessThan(Math.hypot(outer[0], outer[2]));
    }
  });

  it("keeps every near and far piece inside its wall box, the same for the same seed", () => {
    const map = buildPlayMap("medium", 11, mech);
    const runs = edgeRuns(map.boxes, edgeBoxIndices(map.boxes, map.meters), config.bayMeters);
    const slack = 0.06;
    runs.forEach((run, r) => {
      const b = map.boxes[run.box]!;
      const inside = (x: number, y: number, z: number) =>
        x >= b.minX - slack && x <= b.maxX + slack && y >= b.minY - slack && y <= b.maxY + slack && z >= b.minZ - slack && z <= b.maxZ + slack;
      // The first bays, the last, and enough in between that breaches, bales and leaners all turn up.
      for (const bay of [0, 1, ...Array.from({ length: 12 }, (_, i) => Math.floor(((i + 1) * run.bays) / 14)), run.bays - 1]) {
        const plan = () => planBay(config, seedOf(map.seed, r * 1000 + bay), bay * run.bayLength, run.bayLength, run.height, run.thickness);
        expect(JSON.stringify(nearBay(config, plan()))).toBe(JSON.stringify(nearBay(config, plan())));
        for (const piece of nearBay(config, plan())) {
          const m = turn(piece.mesh, [0, run.yaw, 0], [0, 0, 0], run.origin);
          for (let i = 0; i < m.positions.length; i += 3) expect(inside(m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!)).toBe(true);
        }
        for (const f of farBay(config, plan())) {
          for (const corner of [-0.5, 0.5]) {
            const [u, y, w] = f.up
              ? [f.centre[0] + corner * f.size[0], f.centre[1], f.centre[2] + corner * f.size[1]]
              : [f.centre[0] + corner * f.size[0], f.centre[1] + corner * f.size[1], f.centre[2]];
            expect(inside(...runToWorld(run, u, y, w))).toBe(true);
          }
        }
      }
    });
  });

  it("covers every column of the wall face up to the fence, so no gap shows through except a breach", () => {
    let breaches = 0;
    for (let seed = 0; seed < 60; seed++) {
      const plan = planBay(config, seed, 0, 24, 40, 2);
      const columnWidth = plan.length / plan.columns;
      for (let column = 0; column < plan.columns; column++) {
        const sheets = plan.sheets.filter((s) => s.column === column);
        const u = plan.u0 + (column + 0.5) * columnWidth;
        const inHole = plan.breach !== null && u > plan.breach.u0 && u < plan.breach.u1;
        // A breach column starts where the hole's top is, and the core above the hole starts there too.
        expect(sheets[0]!.y0).toBe(inHole ? plan.breach!.height : 0);
        sheets.forEach((s, i) => { if (i > 0) expect(s.y0).toBe(sheets[i - 1]!.y1); });
        expect(sheets[sheets.length - 1]!.y1).toBeCloseTo(plan.wallTop, 6);
      }
      // The seams must not line up into the rows of a building.
      const tops = (column: number) => plan.sheets.filter((s) => s.column === column).map((s) => s.y1.toFixed(2)).join();
      expect(new Set(Array.from({ length: plan.columns }, (_, c) => tops(c))).size).toBeGreaterThan(1);
      if (plan.breach) {
        breaches++;
        // Nothing stacked in the hole, and it ends at posts, so the posts at its sides still stand.
        expect(plan.containers.length + plan.bales.length).toBe(0);
        expect(((plan.breach.u1 - plan.breach.u0) / (2 * columnWidth)) % 1).toBeCloseTo(0, 6);
      }
    }
    expect(breaches).toBeGreaterThan(0);
  });

  it("varies from bay to bay: breaches, bales, plates, leaners and vines all turn up, from the seed alone", () => {
    const plans = Array.from({ length: 80 }, (_, seed) => planBay(config, seed, 0, 24, 40, 2));
    expect(plans.some((p) => p.breach)).toBe(true);
    expect(plans.some((p) => p.bales.length > 0)).toBe(true);
    expect(plans.some((p) => p.plates)).toBe(true);
    expect(plans.some((p) => p.leaners.length > 0)).toBe(true);
    expect(plans.some((p) => p.vines.length > 0)).toBe(true);
    expect(plans.some((p) => p.braced !== null)).toBe(true);
    expect(plans.some((p) => p.leaners.some((l) => l.kind === "shore"))).toBe(true);
    // Raised columns break the top line, built up past the fence line but never above the wall's box.
    const raised = plans.flatMap((p) => p.raised);
    expect(raised.length).toBeGreaterThan(0);
    for (const lift of raised) { expect(lift.top).toBeGreaterThan(37); expect(lift.top).toBeLessThanOrEqual(40); }
    expect(new Set(plans.map((p) => p.girderLift.toFixed(2))).size).toBeGreaterThan(40);
    expect(JSON.stringify(planBay(config, 7, 0, 24, 40, 2))).toBe(JSON.stringify(planBay(config, 7, 0, 24, 40, 2)));
    // Without the variety the plain bay is unchanged by it: same sheets, same containers.
    const plain = { ...config, variety: undefined };
    for (const seed of [1, 2, 3]) {
      const a = planBay(plain, seed, 0, 24, 40, 2), b = planBay(config, seed, 0, 24, 40, 2);
      if (!b.breach) expect(b.sheets).toEqual(a.sheets);
    }
  });

  it("stays within a modest triangle budget per bay", () => {
    for (let seed = 0; seed < 200; seed++) {
      const plan = planBay(config, seed, 0, 24, 40, 2);
      const triangles = nearBay(config, plan).reduce((n, p) => n + p.mesh.indices.length / 3, 0);
      expect(triangles).toBeLessThan(4000);
      expect(farBay(config, plan).length).toBeLessThan(90);
    }
  });
});
