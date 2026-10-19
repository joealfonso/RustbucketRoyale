import { describe, expect, it } from "vitest";
import backdropJson from "../../../../data/backdrop.json";
import tiersJson from "../../../../data/tiers.json";
import { backdropLayout, parseBackdrop } from "./layout";
import { backdropPieces } from "./shapes";

const config = parseBackdrop(backdropJson.backdrop);
const sizes = Object.values(tiersJson.tiers).map((t) => t.meters);

describe("backdrop", () => {
  it("is the same every time for a map size", () => {
    for (const meters of sizes) {
      const edge = meters / 2 + tiersJson.edgeWallThickness;
      expect(JSON.stringify(backdropLayout(config, meters, edge))).toBe(JSON.stringify(backdropLayout(config, meters, edge)));
    }
  });

  it("puts more round a bigger map", () => {
    const count = (meters: number) => backdropLayout(config, meters, meters / 2 + 2).length;
    expect(count(2000)).toBeGreaterThan(count(1000));
    expect(count(1000)).toBeGreaterThan(count(300));
  });

  it("never reaches inside the edge wall, mesh and all", () => {
    for (const meters of sizes) {
      const edge = meters / 2 + tiersJson.edgeWallThickness;
      for (const item of backdropLayout(config, meters, edge)) {
        for (const piece of backdropPieces(config, item)) {
          const p = piece.mesh.positions;
          for (let i = 0; i < p.length; i += 3) {
            expect(Math.max(Math.abs(p[i]!), Math.abs(p[i + 2]!))).toBeGreaterThan(edge + config.clearMeters - 1e-6);
          }
        }
      }
    }
  });

  it("breaks the horizon line: heights vary and some things stand tall", () => {
    const heights = backdropLayout(config, 1000, 502).map((i) => i.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(100);
  });
});
