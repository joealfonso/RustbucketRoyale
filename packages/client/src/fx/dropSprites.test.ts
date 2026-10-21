import * as THREE from "three";
import { describe, expect, it } from "vitest";
import diveJson from "../../../../data/dive.json";
import { DropSprites, parseDropSprites } from "./dropSprites";
import { CELL, COLUMNS, FRAMES, paintSpriteSheet } from "./spriteArt";

describe("drop sprites", () => {
  it("accepts the shipped toon settings and refuses a broken pool", () => {
    expect(() => parseDropSprites(diveJson.toon)).not.toThrow();
    expect(() => parseDropSprites({ ...diveJson.toon, fire: { ...diveJson.toon.fire, inkWidth: 2 } })).toThrow(/inkWidth/);
    expect(() => parseDropSprites({ ...diveJson.toon, smoke: { ...diveJson.toon.smoke, colors: ["a", "b"] } })).toThrow(/colors/);
  });

  it("draws its pools inked, and costs no draw call while a pool is empty", () => {
    const sprites = new DropSprites(new THREE.Scene(), (c) => (c.startsWith("#") ? c : "#808080"), parseDropSprites(diveJson.toon));
    const material = sprites.smoke.mesh.material as THREE.ShaderMaterial;
    expect(material.defines.INKED).toBeDefined();
    sprites.update(0.016, new THREE.Vector3());
    expect(sprites.smoke.mesh.visible).toBe(false);
    const s = sprites.smoke.spawn()!;
    s.life = 1; s.x = 100;
    sprites.update(0.016, new THREE.Vector3());
    expect(sprites.smoke.mesh.visible).toBe(true);
  });

  it("paints how far in from the edge each pixel is, for the ink line", () => {
    const data = paintSpriteSheet();
    const width = COLUMNS * CELL;
    const frame = FRAMES.smoke.first;
    const cx = (frame % COLUMNS) * CELL, cy = Math.floor(frame / COLUMNS) * CELL;
    const at = (i: number, j: number) => ((cy + j) * width + cx + i) * 4;
    expect(data[at(0, 0) + 2]).toBe(0); // the corner is outside the puff
    expect(data[at(CELL / 2, CELL / 2) + 2]).toBeGreaterThan(200); // the middle is deep inside
  });
});
