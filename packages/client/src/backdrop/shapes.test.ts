import { describe, expect, it } from "vitest";
import backdropJson from "../../../../data/backdrop.json";
import tiersJson from "../../../../data/tiers.json";
import { backdropLayout, parseBackdrop, seaLayout } from "./layout";
import { backdropPieces } from "./shapes";

const config = parseBackdrop(backdropJson.backdrop);
const meters = tiersJson.tiers.medium.meters;
const heaps = [...backdropLayout(config, meters, meters / 2 + 2), ...seaLayout(config.sea, meters)].filter((item) => item.kind === "heap");

describe("backdrop heaps", () => {
  it("are rounded mounds: unit normals, every triangle facing out the way its corners say", () => {
    expect(heaps.length).toBeGreaterThan(10);
    for (const item of heaps) {
      const body = backdropPieces(config, item)[0]!.mesh;
      const p = body.positions, n = body.normals;
      for (let k = 0; k < n.length; k += 3) expect(Math.hypot(n[k]!, n[k + 1]!, n[k + 2]!)).toBeCloseTo(1, 5);
      for (let t = 0; t < body.indices.length; t += 3) {
        const [a, b, c] = [body.indices[t]!, body.indices[t + 1]!, body.indices[t + 2]!].map((i) => i * 3);
        const u = [p[b!]! - p[a!]!, p[b! + 1]! - p[a! + 1]!, p[b! + 2]! - p[a! + 2]!], v = [p[c!]! - p[a!]!, p[c! + 1]! - p[a! + 1]!, p[c! + 2]! - p[a! + 2]!];
        const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        if (Math.hypot(...cross) < 1e-6) continue;
        const along = [a, b, c].reduce((sum: number, i) => sum + cross[0]! * n[i!]! + cross[1]! * n[i! + 1]! + cross[2]! * n[i! + 2]!, 0);
        expect(along).toBeGreaterThan(0);
      }
    }
  });

  it("share corners between faces, so the bands sweep across them instead of breaking at every facet", () => {
    for (const item of heaps) {
      const body = backdropPieces(config, item)[0]!.mesh;
      // A flat-shaded hull has three corners per triangle or more; a smooth mound reuses each about six times.
      expect(body.indices.length / (body.positions.length / 3)).toBeGreaterThan(5);
    }
  });
});
