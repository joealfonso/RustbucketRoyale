import { describe, expect, it } from "vitest";
import { checkBuilder, sampleBoxes, triangleCount } from "./builderChecks";
import { container } from "./container";

describe("container", () => {
  it("keeps the builder rules for the real container size", () => {
    expect(checkBuilder(container, sampleBoxes([[12, 2.6, 2.6]]))).toEqual([]);
  });

  it("has a corner casting at each of the box's eight corners, the points a crane lifts it by", () => {
    for (const b of sampleBoxes([[12, 2.6, 2.6]], 4)) {
      const ps = container(b).flatMap((p) => p.mesh.positions);
      for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
        let near = false;
        for (let i = 0; i < ps.length && !near; i += 3) near = Math.hypot(ps[i]! - x, ps[i + 1]! - y, ps[i + 2]! - z) < 0.01;
        expect(near).toBe(true);
      }
    }
  });

  it("gives a longer container more ribs", () => {
    const [long] = sampleBoxes([[12, 2.6, 2.6]], 1);
    const [short] = sampleBoxes([[6, 2.6, 2.6]], 1);
    expect(triangleCount(container(long!))).toBeGreaterThan(triangleCount(container(short!)));
  });
});
