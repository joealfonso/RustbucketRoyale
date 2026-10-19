import { describe, expect, it } from "vitest";
import propsJson from "../../../../data/props.json";
import { box, merge } from "../dressing/shapes";
import { PROP_MODELS } from "./index";
import { standIn } from "./standIn";

const bounds = (positions: number[]) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((v, i) => { min[i % 3] = Math.min(min[i % 3]!, v); max[i % 3] = Math.max(max[i % 3]!, v); });
  return { min, max };
};

describe("far stand-in", () => {
  it("is one box wrapping the whole model, in the paint with the most surface", () => {
    const pieces = [
      { paint: "deepRust", mesh: box([0, 0.5, 0], [2, 1, 2]) },
      { paint: "sparkYellow", mesh: box([0, 1.1, 0], [0.2, 0.2, 0.2]) },
    ];
    const [first, ...extra] = standIn(pieces);
    const s = first!;
    expect(extra).toHaveLength(0);
    expect(s.paint).toBe("deepRust");
    expect(s.mesh.indices.length / 3).toBe(12);
    const { min, max } = bounds(s.mesh.positions);
    expect(min).toEqual([-1, 0, -1]);
    expect(max.map((v) => +v.toFixed(6))).toEqual([1, 1.2, 1]);
  });

  it("ignores paint hidden inside the model", () => {
    // A dark core of stacked slabs, more surface (59 m²) than the thin orange plates over its sides and top (42 m²).
    const plates = [box([0, 1.5, 0], [2, 0.05, 2]), box([1, 0.75, 0], [0.05, 1.5, 2]), box([-1, 0.75, 0], [0.05, 1.5, 2]),
      box([0, 0.75, 1], [2, 1.5, 0.05]), box([0, 0.75, -1], [2, 1.5, 0.05])];
    const core = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => box([0, 0.15 + k * 0.17, 0], [1.8, 0.12, 1.8]));
    expect(standIn([{ paint: "deepRust", mesh: merge(...core) }, { paint: "rustOrange", mesh: merge(...plates) }])[0]!.paint).toBe("rustOrange");
  });

  it("keeps a barrel's hazard bands on its far box, just proud of it, where the data puts them", () => {
    const bands = { paint: "soot", at: [0.2, 0.75], thickness: 0.1 };
    const [body, ...rest] = standIn([{ paint: "sparkYellow", mesh: box([0, 1, 0], [1, 2, 1]) }], bands);
    expect(body!.paint).toBe("sparkYellow");
    expect(rest.map((r) => r.paint)).toEqual(["soot"]); // both rings in one piece, one draw
    const rings = rest[0]!.mesh;
    expect(rings.indices.length / 3).toBe(24);
    const { min, max } = bounds(rings.positions);
    expect(+min[1]!.toFixed(6)).toBe(0.3); // the low ring, 0.4 up and 0.2 thick
    expect(+max[1]!.toFixed(6)).toBe(1.6); // the high ring, 1.5 up
    expect(max[0]).toBeGreaterThan(0.5); // stands out past the body, so it never shares its pixels
  });

  for (const type of propsJson.types) {
    it(`fits inside the ${type.id}'s box in one of its paints`, () => {
      const size = type.size as [number, number, number];
      const { intact } = PROP_MODELS[type.id]!(size, 1);
      const s = standIn(intact)[0]!;
      expect(intact.map((p) => p.paint)).toContain(s.paint);
      const { min, max } = bounds(s.mesh.positions);
      const slack = 0.06;
      expect(min[0]).toBeGreaterThan(-size[0] / 2 - slack);
      expect(min[1]).toBeGreaterThan(-slack);
      expect(max[1]).toBeLessThan(size[1] + slack);
      expect(max[2]).toBeLessThan(size[2] / 2 + slack);
    });
  }
});
