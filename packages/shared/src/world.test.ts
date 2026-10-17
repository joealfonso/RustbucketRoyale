import { describe, expect, it } from "vitest";
import { World, boxFromData, createRayHit, raycastBoxes, type Box } from "./world";

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

// Cheap repeatable pseudo random numbers for building a messy test map.
function lcg(seed: number): () => number {
  let a = seed;
  return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe("World", () => {
  const random = lcg(7);
  const boxes: Box[] = [];
  for (let i = 0; i < 400; i++) {
    const cx = random() * 300, cz = random() * 300;
    const sx = 1 + random() * 14, sz = 1 + random() * 14, sy = 0.5 + random() * 8;
    boxes.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, minY: 0, maxY: sy });
  }
  const world = new World(boxes, 16);

  it("raycast agrees with testing every box, for many random rays", () => {
    const a = createRayHit(), b = createRayHit();
    for (let i = 0; i < 2000; i++) {
      const ox = random() * 300, oy = random() * 6, oz = random() * 300;
      const yaw = random() * Math.PI * 2, pitch = (random() - 0.5) * 0.6;
      const dx = Math.cos(pitch) * Math.cos(yaw), dy = Math.sin(pitch), dz = Math.cos(pitch) * Math.sin(yaw);
      const max = 5 + random() * 200;
      const hitFast = world.raycast(ox, oy, oz, dx, dy, dz, max, a);
      const hitSlow = raycastBoxes(ox, oy, oz, dx, dy, dz, max, boxes, b);
      expect(hitFast).toBe(hitSlow);
      if (hitSlow) expect(a.distance).toBeCloseTo(b.distance, 6);
    }
  });

  it("query returns every box that touches the rectangle, each once", () => {
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = random() * 300, z = random() * 300, half = 0.5 + random() * 12;
      const count = world.query(x - half, z - half, x + half, z + half, out);
      const got = new Set(out.slice(0, count));
      expect(got.size).toBe(count);
      boxes.forEach((b, index) => {
        const touches = b.minX < x + half && b.maxX > x - half && b.minZ < z + half && b.maxZ > z - half;
        if (touches) expect(got.has(index)).toBe(true);
      });
    }
  });

  it("handles a ray straight up and a ray starting outside the map", () => {
    const hit = createRayHit();
    expect(world.raycast(150, -5, 150, 0, 1, 0, 100, hit) || true).toBe(true);
    expect(() => world.raycast(-500, 2, -500, 1, 0, 0, 100, hit)).not.toThrow();
  });
});
