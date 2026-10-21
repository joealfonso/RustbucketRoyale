import * as THREE from "three";
import { describe, expect, it } from "vitest";
import diveJson from "../../../data/dive.json";
import { parseDive } from "./dive";
import { DropSprites } from "./fx/dropSprites";
import { SpeedLines } from "./speedLines";

const dive = parseDive(diveJson);

describe("SpeedLines", () => {
  it("draws no streaks below their speed and more of them the faster you fall", () => {
    const sprites = new DropSprites(new THREE.Scene(), (c) => (c.startsWith("#") ? c : "#808080"), dive.toon);
    const lines = new SpeedLines(dive.speedLines, sprites);
    const geometry = sprites.streaks.mesh.geometry as THREE.InstancedBufferGeometry;
    const camera = new THREE.Vector3(0, 200, 0);
    const drawn = (fall: number) => { lines.update(camera, 0, -fall, 0, 0.016); sprites.update(0.016, camera); return geometry.instanceCount; };
    expect(drawn(dive.speedLines.fromSpeed - 1)).toBe(0);
    const some = drawn((dive.speedLines.fromSpeed + dive.speedLines.fullSpeed) / 2);
    const all = drawn(dive.speedLines.fullSpeed + 10);
    expect(some).toBeGreaterThan(0);
    expect(all).toBeGreaterThan(some);
    expect(all).toBeLessThanOrEqual(dive.speedLines.count);
  });
});
