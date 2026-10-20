import { describe, expect, it } from "vitest";
import hangarJson from "../../../../data/hangar.json";
import rosterJson from "../../../../data/roster.json";
import { bayCentres, bayOfMech, hazardStripes, hexEdges, loadingBayClear, parseHangar, stepToward, type Step } from "./layout";

const config = parseHangar(hangarJson);
const rosterIds = rosterJson.mechs.map((m) => m.id);

describe("hangar layout", () => {
  it("reads data/hangar.json", () => {
    expect(config.bays.order).toHaveLength(rosterIds.length);
  });

  it("refuses bays that overlap or a screen for a bay that is not there", () => {
    expect(() => parseHangar({ ...hangarJson, bays: { ...hangarJson.bays, halfWidth: 5 } })).toThrow(/overlap/);
    expect(() => parseHangar({ ...hangarJson, screens: [{ show: "bay", bay: 9, center: [0, 0, 0], size: [1, 1], turnDegrees: 0 }] })).toThrow(/bay 9/);
    expect(() => parseHangar({ ...hangarJson, bays: { ...hangarJson.bays, order: ["ironclad", "ironclad"] } })).toThrow(/twice/);
    expect(() => parseHangar({ ...hangarJson, loadingBay: { ...hangarJson.loadingBay, halfWidth: 4.2 } })).toThrow(/plate grid/);
  });

  it("spaces the bays evenly, centred on the loading bay, behind it", () => {
    const bays = bayCentres(config);
    expect(bays).toHaveLength(config.bays.order.length);
    const mid = bays.reduce((s, b) => s + b.x, 0) / bays.length;
    expect(mid).toBeCloseTo(config.loadingBay.x);
    for (let i = 1; i < bays.length; i++) expect(bays[i]!.x - bays[i - 1]!.x).toBeCloseTo(config.bays.spacing);
    for (const b of bays) expect(b.z).toBeLessThan(config.loadingBay.z - config.loadingBay.halfDepth);
    // Every bay fits inside the hall's walls.
    for (const b of bays) expect(Math.abs(b.x) + config.bays.halfWidth).toBeLessThan(config.hall.halfWidth);
  });

  it("gives every roster mech its own bay, and refuses a roster mech with none", () => {
    const bays = bayOfMech(config, rosterIds);
    expect(new Set(bays).size).toBe(rosterIds.length);
    expect(bays[rosterIds.indexOf("stiletto")]).toBe(0);
    expect(bays[rosterIds.indexOf("arbiter")]).toBe(3);
    expect(() => bayOfMech(config, [...rosterIds, "newcomer"])).toThrow(/newcomer/);
    expect(() => bayOfMech(config, rosterIds.slice(1))).toThrow(/not in the roster/);
  });

  it("walks a mech toward its goal at walking pace and stops on it", () => {
    const out: Step = { x: 0, z: 0, vx: 0, vz: 0 };
    stepToward(0, -10, 0, 0, 2, 0.5, out);
    expect(out).toEqual({ x: 0, z: -9, vx: 0, vz: 2 });
    stepToward(0, -0.5, 0, 0, 2, 0.5, out);
    expect(out.z).toBe(0);
    expect(out.vz).toBeCloseTo(1); // only the half metre that was left
    stepToward(0, -4, 0, 0, 0, 0.5, out); // held back: stays where it is
    expect(out).toEqual({ x: 0, z: -4, vx: 0, vz: 0 });
    stepToward(0, -4, 0, 0, 2, 0, out); // no time passed
    expect(out.z).toBe(-4);
    stepToward(0, 0, 0, 0, 2, 0.5, out);
    expect(out.vx).toBe(0);
    expect(out.vz).toBe(0);
  });

  it("holds a mech back until the loading bay is clear", () => {
    const at = { x: config.loadingBay.x, z: config.loadingBay.z };
    expect(loadingBayClear(config, [{ x: at.x + 1, z: at.z }])).toBe(false);
    expect(loadingBayClear(config, [{ x: at.x, z: at.z - config.walk.clearMeters - 0.1 }])).toBe(true);
    expect(loadingBayClear(config, [])).toBe(true);
  });

  it("cuts hazard stripes square at the ends of the band and keeps them inside it", () => {
    const stripes = hazardStripes(0, 0, 4, 0, 0.4, 0.45);
    expect(stripes.length).toBeGreaterThan(3);
    for (const s of stripes) {
      expect(s.length).toBeGreaterThanOrEqual(3);
      for (const [x, z] of s) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(4 + 1e-9);
        expect(Math.abs(z)).toBeLessThanOrEqual(0.2 + 1e-9);
      }
    }
  });

  it("lays a hexagon grid with every edge once, all inside its rectangle", () => {
    const one = hexEdges(1, [-1, -1], [1, 1]);
    expect(one).toHaveLength(6); // just the middle hexagon
    const edges = hexEdges(2, [-10, -8], [10, 8]);
    const keys = new Set(edges.map(([a, b, c, d]) => `${Math.round((a + c) * 100)},${Math.round((b + d) * 100)}`));
    expect(keys.size).toBe(edges.length);
    for (const [x0, z0, x1, z1] of edges) {
      expect(Math.hypot(x1 - x0, z1 - z0)).toBeCloseTo(2); // a regular hexagon's side equals its radius
      for (const x of [x0, x1]) expect(Math.abs(x)).toBeLessThanOrEqual(10 + 1e-6);
      for (const z of [z0, z1]) expect(Math.abs(z)).toBeLessThanOrEqual(8 + 1e-6);
    }
  });
});
