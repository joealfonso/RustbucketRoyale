import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CELL, COLUMNS, FRAMES, paintSpriteSheet, ROWS } from "./spriteArt";
import { SpritePool } from "./sprites";

const look = { colors: ["#ffffff", "#888888", "#000000"] as [string, string, string], growSteps: 4 };

describe("SpritePool", () => {
  it("recycles the oldest sprite once its cap is reached, as scorch marks do", () => {
    let cap = 4;
    const pool = new SpritePool(new THREE.Scene(), look, (c) => c, 16, () => cap);
    const first = [1, 2, 3, 4].map(() => pool.spawn());
    expect(pool.spawn()).toBe(first[0]);
    cap = 0;
    expect(pool.spawn()).toBeNull();
  });

  it("draws only the sprites alive this frame, and one-frame sprites only for that frame", () => {
    const pool = new SpritePool(new THREE.Scene(), look, (c) => c, 8, () => 8, 4);
    const geometry = pool.mesh.geometry as THREE.InstancedBufferGeometry;
    const s = pool.spawn()!;
    s.life = 0.5;
    pool.draw();
    pool.update(0.1, new THREE.Vector3());
    expect(geometry.instanceCount).toBe(2);
    pool.update(0.1, new THREE.Vector3());
    expect(geometry.instanceCount).toBe(1);
    pool.update(1, new THREE.Vector3());
    expect(geometry.instanceCount).toBe(0);
  });
});

describe("paintSpriteSheet", () => {
  it("paints every frame it names with some shape and some empty edge", () => {
    const data = paintSpriteSheet();
    const width = COLUMNS * CELL;
    expect(data.length).toBe(width * ROWS * CELL * 4);
    const last = FRAMES.streak.first + FRAMES.streak.count;
    for (let frame = 0; frame < last; frame++) {
      let inside = 0;
      const cx = (frame % COLUMNS) * CELL, cy = Math.floor(frame / COLUMNS) * CELL;
      for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) if (data[((cy + j) * width + cx + i) * 4 + 3]! > 127) inside++;
      expect(inside, `frame ${frame}`).toBeGreaterThan(CELL * CELL * 0.03);
      expect(inside, `frame ${frame}`).toBeLessThan(CELL * CELL * 0.95);
    }
  });
});
