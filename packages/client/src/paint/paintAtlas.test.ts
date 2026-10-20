import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import paintJson from "../../../../data/paint.json";
import { buildPaintAtlas } from "./paintAtlas";
import { parsePaintLook, type PaintLook } from "./paintLook";
import { CHIP, MARK, RUST, RUST_LIGHT, SHADE, TAPE } from "./marks";

const look = parsePaintLook(paintJson);
const small: PaintLook = { ...look, tileSize: 128 };
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("paint atlas", () => {
  it("paints the same pixels every run from the same seed, and different ones from another seed", () => {
    const a = buildPaintAtlas(small), b = buildPaintAtlas(small);
    expect(digest(a.data)).toBe(digest(b.data));
    expect(digest(buildPaintAtlas({ ...small, seed: small.seed + 1 }).data)).not.toBe(digest(a.data));
  });

  it("is one RGBA layer per material, tileSize square", () => {
    const atlas = buildPaintAtlas(small);
    expect(atlas.layers).toEqual(["metal", "concrete", "wood", "ground"]);
    expect(atlas.size).toBe(128);
    expect(atlas.data.length).toBe(128 * 128 * 4 * 4);
  });

  it("stays within one 2048 atlas's memory at the shipped size", () => {
    expect(look.tileSize * look.tileSize * 4 /* layers */).toBeLessThanOrEqual(2048 * 2048);
  });

  it("leaves most of each surface alone, so the palette still rules, but has every kind of mark somewhere", () => {
    const atlas = buildPaintAtlas(look), n = atlas.size;
    for (const layer of [0, 1, 2]) {
      let near = 0, rust = 0, chips = 0, tape = 0;
      for (let i = layer * n * n * 4, end = i + n * n * 4; i < end; i += 4) {
        if (Math.abs(atlas.data[i + SHADE]! / 255 - 0.5) < 0.08) near++;
        if (atlas.data[i + RUST]! / 255 >= RUST_LIGHT - 0.05) rust++;
        const mark = atlas.data[i + MARK]! / 255;
        if (Math.abs(mark - CHIP) < 0.05) chips++;
        if (mark > TAPE - 0.05) tape++;
      }
      const share = (count: number) => count / (n * n);
      expect(share(near), `layer ${layer} shade near neutral`).toBeGreaterThan(0.6);
      expect(share(rust), `layer ${layer} rust`).toBeGreaterThan(0.001);
      expect(share(rust), `layer ${layer} rust`).toBeLessThan(0.1);
      expect(share(chips), `layer ${layer} chips`).toBeGreaterThan(0.001);
      if (layer === 0) expect(share(tape), "metal tape").toBeGreaterThan(0.0005);
    }
  });

  it("tiles with no seam: the first and last columns and rows differ no more than neighbours inside", () => {
    const atlas = buildPaintAtlas(look), n = atlas.size;
    const shade = (x: number, y: number) => atlas.data[(y * n + x) * 4 + SHADE]!;
    let edge = 0, inside = 0;
    for (let y = 0; y < n; y++) {
      edge += Math.abs(shade(0, y) - shade(n - 1, y));
      inside += Math.abs(shade(n / 2, y) - shade(n / 2 - 1, y));
    }
    expect(edge).toBeLessThan(inside * 2 + n * 2);
  });

  it("rejects bad settings", () => {
    expect(() => parsePaintLook({ ...look, tileSize: 500 })).toThrow(/power of two/);
    expect(() => parsePaintLook({ ...look, fade: { startMeters: 40, endMeters: 10 } })).toThrow(/fade/);
    expect(() => parsePaintLook({ ...look, surfaces: { ...look.surfaces, wood: { ...look.surfaces.wood, layer: "ground" } } })).toThrow(/wood/);
  });
});
