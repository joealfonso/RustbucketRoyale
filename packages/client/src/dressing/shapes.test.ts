import { describe, expect, it } from "vitest";
import type { MeshData } from "./shapes";
import { box, cylinder, merge, mirrorX, prism, triangles, turn, wedge } from "./shapes";

// Every triangle's winding agrees with its stored normal, and points away from the solid's centre.
function facesOut(m: MeshData, centre: [number, number, number]): boolean {
  for (let t = 0; t < m.indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => { const i = m.indices[t + k]! * 3; return [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!]; });
    const u = [0, 1, 2].map((i) => p[1]![i]! - p[0]![i]!), v = [0, 1, 2].map((i) => p[2]![i]! - p[0]![i]!);
    const c = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const i0 = m.indices[t]! * 3;
    const n = [m.normals[i0]!, m.normals[i0 + 1]!, m.normals[i0 + 2]!];
    const mid = [0, 1, 2].map((i) => (p[0]![i]! + p[1]![i]! + p[2]![i]!) / 3);
    if (c[0]! * n[0]! + c[1]! * n[1]! + c[2]! * n[2]! <= 0) return false;
    if ((mid[0]! - centre[0]) * n[0]! + (mid[1]! - centre[1]) * n[1]! + (mid[2]! - centre[2]) * n[2]! <= 0) return false;
  }
  return true;
}

describe("shapes", () => {
  it("make closed solids that face outward", () => {
    expect(facesOut(box([1, 2, 3], [2, 1, 4]), [1, 2, 3])).toBe(true);
    expect(facesOut(box([1, 2, 3], [2, 1, 4], 0.2), [1, 2, 3])).toBe(true);
    expect(facesOut(cylinder([0, 1, 0], 0.5, 2, "z", 10), [0, 1, 0])).toBe(true);
    expect(facesOut(cylinder([0, 1, 0], 0.5, 2, "x", 6, 0.2), [0, 1, 0])).toBe(true);
    expect(facesOut(wedge([0, 1, 0], [1, 1, 2], 0.5), [0, 1, -0.2])).toBe(true);
    expect(facesOut(prism([[0, 0], [1, 0], [0.5, 1]], "y", 0, 2), [0.33, 1, 0.5])).toBe(true);
  });

  it("stay facing outward for thin plates with a big bevel, which is clamped", () => {
    expect(facesOut(box([0, 1, 0], [0.12, 1.4, 0.9], 0.1), [0, 1, 0])).toBe(true);
    expect(facesOut(box([0, 1, 0], [1.2, 0.08, 0.6], 0.2), [0, 1, 0])).toBe(true);
  });

  it("stay facing outward when turned and mirrored", () => {
    expect(facesOut(turn(box([0, 0, 0], [1, 2, 3], 0.1), [0.4, 1.1, -0.3], [0, 0, 0], [5, 0, 0]), [5, 0, 0])).toBe(true);
    expect(facesOut(mirrorX(box([2, 0, 0], [1, 1, 1], 0.1)), [-2, 0, 0])).toBe(true);
  });

  it("keep triangle counts low: a bevelled box is 60 triangles, merging adds them up", () => {
    expect(triangles(box([0, 0, 0], [1, 1, 1]))).toBe(12);
    expect(triangles(box([0, 0, 0], [1, 1, 1], 0.1))).toBe(60);
    expect(triangles(merge(box([0, 0, 0], [1, 1, 1]), box([2, 0, 0], [1, 1, 1])))).toBe(24);
  });
});
