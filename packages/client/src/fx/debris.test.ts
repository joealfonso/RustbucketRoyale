import { describe, expect, it } from "vitest";
import explosionFxJson from "../../../../data/explosionFx.json";
import { chunkScale, stepChunk, type Chunk } from "./debris";

const physics = explosionFxJson.chunks;
const DT = 1 / 60;
const chunk = (): Chunk => ({ x: 0, y: 1, z: 0, vx: 4, vy: 6, vz: 0, rx: 0, rz: 0, spin: 5, floor: 0, hills: false, rest: 0, age: 0, life: 5, size: 0.3, bounced: false });

describe("stepChunk", () => {
  it("falls, bounces once off the ground with less speed, then lies still on its second landing", () => {
    const c = chunk();
    let landings = 0, wasBounced = false, bounceSpeed = 0, rising = false;
    for (let i = 0; i < 600 && !(c.vx === 0 && c.vy === 0); i++) {
      const before = c.vy;
      stepChunk(c, DT, physics);
      if (c.bounced && !wasBounced) { landings++; bounceSpeed = c.vy; expect(c.vy).toBeLessThan(-before); }
      if (c.bounced && c.vy > 0) rising = true;
      wasBounced = c.bounced;
      expect(c.y).toBeGreaterThanOrEqual(c.floor);
    }
    expect(landings).toBe(1);
    expect(rising).toBe(true);
    expect(bounceSpeed).toBeGreaterThan(0);
    expect(c.vx).toBe(0); expect(c.vy).toBe(0); expect(c.spin).toBe(0);
    expect(c.y).toBe(c.floor);
    const x = c.x;
    stepChunk(c, DT, physics);
    expect(c.x).toBe(x);
  });
});

describe("chunkScale", () => {
  it("is full size, then shrinks in steps at the end of its life, then nothing", () => {
    const c = chunk();
    c.age = 1; expect(chunkScale(c, 0.25)).toBe(c.size);
    c.age = 4.5; expect(chunkScale(c, 0.25)).toBeLessThan(c.size);
    c.age = 5; expect(chunkScale(c, 0.25)).toBe(0);
  });
});
