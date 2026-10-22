import { describe, expect, it } from "vitest";
import { Terrain, type Box } from "@rustbucket/shared";
import { WaterWakes, wakeDistance } from "./waterWakes";

// A 40 m square, the west half 1.5 m under ground level 0 with the water at -0.5, the east half dry.
function westPond(): Terrain {
  const cells = 10, cell = 4, n = cells + 1;
  const heights = new Int32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = i * cell < 18 ? -150 : 0;
  return new Terrain(cells * cell, cell, heights, 0.5, -50, 0.1);
}

const box = (x: number, z: number, half: number, minY: number, maxY: number): Box => ({ minX: x - half, minY, minZ: z - half, maxX: x + half, maxY, maxZ: z + half });

describe("water wakes", () => {
  it("keeps only the boxes that cross the water's surface over water", () => {
    const wakes = new WaterWakes(8, 100);
    wakes.setStill([
      box(-10, 0, 1, -1.5, 2), // in the pond, through the surface
      box(-10, 10, 1, -1.5, -0.8), // sunk under the surface
      box(12, 0, 1, 0, 2), // on dry ground
    ], westPond());
    wakes.begin();
    wakes.finish(0, 0);
    expect(wakes.count).toBe(1);
    expect(wakes.shapes[0]).toBe(-10);
  });

  it("puts mechs first, then the nearest boxes, up to its size, allocating nothing new", () => {
    const wakes = new WaterWakes(3, 100);
    wakes.setStill([box(-16, -16, 1, -1.5, 2), box(-12, 0, 1, -1.5, 2), box(-16, 16, 1, -1.5, 2)], westPond());
    const shapes = wakes.shapes;
    wakes.begin();
    wakes.addCircle(-5, 0, 1.3);
    wakes.finish(-12, 2);
    expect(wakes.shapes).toBe(shapes);
    expect(wakes.count).toBe(3);
    expect([...shapes.slice(0, 4)]).toEqual([-5, 0, -1.3, 0].map(Math.fround));
    expect(shapes[4]).toBe(-12); // the box nearest the camera
    wakes.begin();
    for (let i = 0; i < 5; i++) wakes.addCircle(i, 0, 1);
    wakes.finish(0, 0);
    expect(wakes.count).toBe(3);
  });

  it("skips boxes too far from the camera", () => {
    const wakes = new WaterWakes(4, 5);
    wakes.setStill([box(-16, -16, 1, -1.5, 2)], westPond());
    wakes.begin();
    wakes.finish(15, 15);
    expect(wakes.count).toBe(0);
  });

  it("measures the distance to a circle's or a box's edge", () => {
    const wakes = new WaterWakes(2, 100);
    wakes.begin();
    wakes.addCircle(0, 0, 2);
    expect(wakeDistance(wakes.shapes, 0, 5, 0, 0.4)).toBeCloseTo(3);
    expect(wakeDistance(wakes.shapes, 0, 1, 0, 0.4)).toBeCloseTo(-1);
    const shapes = new Float32Array([0, 0, 4, 1]);
    expect(wakeDistance(shapes, 0, 0, 3, 0.4)).toBeCloseTo(2); // beside the long side
    expect(wakeDistance(shapes, 0, 6, 0, 0.4)).toBeCloseTo(2); // past the end
    expect(wakeDistance(shapes, 0, 0, 0, 0.4)).toBeLessThan(0);
  });
});
