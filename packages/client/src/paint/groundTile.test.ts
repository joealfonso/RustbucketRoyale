import { describe, expect, it } from "vitest";
import paintJson from "../../../../data/paint.json";
import { BLEND, BLEND_MARGIN, DIRT, GRASS, ROCK, paintGround } from "./groundTile";
import { rng } from "../dressing/kinds";
import { parseGroundTileLook } from "./groundDetailLook";
import { Tile } from "./raster";

const look = parseGroundTileLook(paintJson.groundTile);
const size = 512;
const data = new Uint8Array(size * size * 4);
paintGround(new Tile(data, size, 0), look, rng(paintJson.seed), paintJson.seed);
const values = (channel: number) => Array.from({ length: size * size }, (_, i) => data[i * 4 + channel]! / 255);

describe("ground tile", () => {
  it("averages out to neutral in every detail channel, so fading the detail out leaves no lighter or darker band", () => {
    for (const [name, channel] of Object.entries({ DIRT, GRASS, ROCK })) {
      const v = values(channel);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      expect(Math.abs(mean - 0.5), `${name} mean ${mean.toFixed(3)}`).toBeLessThan(0.03);
    }
  });

  it("has marks in every channel, but leaves most of each untouched", () => {
    for (const [name, channel] of Object.entries({ DIRT, GRASS, ROCK })) {
      const v = values(channel);
      const marked = v.filter((x) => Math.abs(x - 0.5) > 0.04).length / v.length;
      expect(marked, `${name} marked share`).toBeGreaterThan(0.03);
      expect(marked, `${name} marked share`).toBeLessThan(0.6);
    }
  });

  it("spreads the blend noise across its band, inside the margin, so edges cross in clumps over the whole blend width", () => {
    const v = values(BLEND);
    expect(v.reduce((a, b) => Math.min(a, b))).toBeGreaterThanOrEqual(BLEND_MARGIN - 1 / 255);
    expect(v.reduce((a, b) => Math.max(a, b))).toBeLessThanOrEqual(1 - BLEND_MARGIN + 1 / 255);
    for (const [low, high] of [[0, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 1]]) {
      expect(v.filter((x) => x >= low! && x < high!).length / v.length, `blend ${low}..${high}`).toBeGreaterThan(0.1);
    }
  });

  it("tiles with no seam in the blend noise", () => {
    const at = (x: number, y: number) => data[(y * size + x) * 4 + BLEND]!;
    let edge = 0, inside = 0;
    for (let y = 0; y < size; y++) {
      edge += Math.abs(at(0, y) - at(size - 1, y));
      inside += Math.abs(at(size / 2, y) - at(size / 2 - 1, y));
    }
    expect(edge).toBeLessThan(inside * 2 + size);
  });
});
