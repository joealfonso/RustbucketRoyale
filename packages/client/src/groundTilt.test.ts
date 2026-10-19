import { describe, expect, it } from "vitest";
import { Terrain } from "@rustbucket/shared";
import { groundTilt, onHills } from "./groundTilt";

// 40 m across, 4 m cells, rising 0.5 m per metre along +x and falling 0.25 along +z.
const corners = 11;
const heights = new Int32Array(corners * corners);
for (let j = 0; j < corners; j++) for (let i = 0; i < corners; i++) heights[j * corners + i] = Math.round(((i * 4 - 20) * 0.5 - (j * 4 - 20) * 0.25) * 100);
const terrain = new Terrain(40, 4, heights, 0.5);

describe("marks on the hills", () => {
  it("lean with the slope under them", () => {
    const tilt = { x: 0, z: 0 };
    groundTilt(terrain, 3, -5, terrain.heightAt(3, -5), tilt, [0, 0, 0]);
    expect(tilt.x).toBeCloseTo(0.5);
    expect(tilt.z).toBeCloseTo(-0.25);
  });

  it("lie level on a roof, and anywhere on a map with no hills", () => {
    const tilt = { x: 9, z: 9 };
    groundTilt(terrain, 3, -5, terrain.heightAt(3, -5) + 4, tilt, [0, 0, 0]);
    expect(tilt).toEqual({ x: 0, z: 0 });
    tilt.x = 9;
    groundTilt(null, 3, -5, 0, tilt, [0, 0, 0]);
    expect(tilt).toEqual({ x: 0, z: 0 });
    expect(onHills(null, 0, 0, 0)).toBe(false);
    expect(onHills(terrain, 0, 0, terrain.heightAt(0, 0) + 0.1)).toBe(true);
  });
});
