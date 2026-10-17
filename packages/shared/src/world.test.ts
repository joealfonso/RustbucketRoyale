import { describe, expect, it } from "vitest";
import { boxFromData, createRayHit, raycastBoxes } from "./world";

const wall = boxFromData({ name: "wall", center: [0, 1, -10], size: [4, 2, 2], color: "#fff" });

describe("raycastBoxes", () => {
  it("hits the near face with the right distance and normal", () => {
    const hit = createRayHit();
    expect(raycastBoxes(0, 1, 0, 0, 0, -1, 100, [wall], hit)).toBe(true);
    expect(hit.distance).toBeCloseTo(9);
    expect(hit.normalZ).toBe(1);
  });

  it("misses when pointing away or beyond max distance", () => {
    const hit = createRayHit();
    expect(raycastBoxes(0, 1, 0, 0, 0, 1, 100, [wall], hit)).toBe(false);
    expect(raycastBoxes(0, 1, 0, 0, 0, -1, 5, [wall], hit)).toBe(false);
  });

  it("returns the nearest of several boxes", () => {
    const near = boxFromData({ name: "near", center: [0, 1, -5], size: [4, 2, 2], color: "#fff" });
    const hit = createRayHit();
    raycastBoxes(0, 1, 0, 0, 0, -1, 100, [wall, near], hit);
    expect(hit.distance).toBeCloseTo(4);
  });
});
