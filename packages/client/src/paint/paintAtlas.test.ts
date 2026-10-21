import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import paintJson from "../../../../data/paint.json";
import { atlasLayers, buildPaintAtlas, cellSteps, surfaceLayer, SURFACE_LAYERS, type PaintAtlas } from "./paintAtlas";
import { PaintKit } from "./paintKit";
import { parsePaintLook, type PaintLook } from "./paintLook";
import { CHIP, MARK, RUST, RUST_LIGHT, SHADE, TAPE } from "./marks";

const look = parsePaintLook(paintJson);
const small: PaintLook = { ...look, tileSize: 128 };
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const layerBytes = (atlas: PaintAtlas, index: number) => atlas.data.subarray(index * atlas.size * atlas.size * 4, (index + 1) * atlas.size * atlas.size * 4);
// The shipped atlas takes a few hundred milliseconds to paint, so the tests that need it share one.
let shippedAtlas: PaintAtlas | null = null;
const shipped = () => (shippedAtlas ??= buildPaintAtlas(look));

describe("paint atlas", () => {
  it("paints the same pixels every run from the same seed, and different ones from another seed", () => {
    const a = buildPaintAtlas(small), b = buildPaintAtlas(small);
    expect(digest(a.data)).toBe(digest(b.data));
    expect(digest(buildPaintAtlas({ ...small, seed: small.seed + 1 }).data)).not.toBe(digest(a.data));
  });

  it("is one RGBA layer per material, then the further variants of metal, concrete and wood, tileSize square", () => {
    const atlas = buildPaintAtlas({ ...small, variants: 2 });
    expect(atlas.layers.map((l) => `${l.name}${l.variant}`)).toEqual(["metal0", "concrete0", "wood0", "ground0", "metal1", "concrete1", "wood1"]);
    expect(atlas.size).toBe(128);
    expect(atlas.data.length).toBe(128 * 128 * 4 * 7);
    expect(buildPaintAtlas({ ...small, variants: 1 }).layers).toHaveLength(4);
    // surfaceLayer is the index rule the shader repeats.
    atlas.layers.forEach((l, i) => l.name !== "ground" && expect(surfaceLayer(l.name, l.variant)).toBe(i));
  });

  it("paints at 1024 a side, within 40 MB of GPU memory with its mips", () => {
    expect(look.tileSize).toBe(1024);
    const bytes = (look.tileSize * look.tileSize * 4 * atlasLayers(look).length * 4) / 3;
    expect(bytes).toBeLessThanOrEqual(40 * 1048576);
  });

  it("paints each variant differently, and every variant of a material with the same joints", () => {
    const atlas = buildPaintAtlas({ ...small, variants: 2 });
    for (const layer of SURFACE_LAYERS) expect(digest(layerBytes(atlas, surfaceLayer(layer, 1)))).not.toBe(digest(layerBytes(atlas, surfaceLayer(layer, 0))));
  });

  it("keeps the joints a cell may start on whole, so cells always meet at a seam", () => {
    const atlas = shipped(), n = atlas.size, band = 4;
    atlas.layers.forEach(({ name }, index) => {
      if (name === "ground") return;
      const shade = (x: number, y: number) => atlas.data[index * n * n * 4 + ((((y % n) + n) % n) * n + (((x % n) + n) % n)) * 4 + SHADE]! / 255;
      const darkest = (values: number[]) => Math.min(...values);
      const [across, up] = cellSteps(look, name);
      for (let i = 0; i < across; i++) {
        const x = Math.round((i / across) * n);
        // Where it crosses a level joint, that joint's light lip may cross it too: the same at every cell's edge.
        const nearLevel = (y: number) => Array.from({ length: up + 1 }, (_, j) => Math.abs(y - (j / up) * n)).some((d) => d < band * 3);
        for (let y = 0; y < n; y++) if (!nearLevel(y)) expect(darkest(Array.from({ length: band * 2 + 1 }, (_, k) => shade(x - band + k, y))), `${name} upright joint ${i} at row ${y}`).toBeLessThan(0.36);
      }
      for (let j = 0; j < up; j++) {
        const y = Math.round((j / up) * n);
        for (let x = 0; x < n; x++) expect(darkest(Array.from({ length: band * 2 + 1 }, (_, k) => shade(x, y - band + k))), `${name} level joint ${j} at column ${x}`).toBeLessThan(0.36);
      }
    });
  });

  it("paints the atlas in place where there is no worker, filling the shared texture", () => {
    const kit = new PaintKit((c) => c, { ...small, variants: 2 });
    expect(kit.texture.image.width).toBe(128);
    expect(kit.texture.image.depth).toBe(7);
    expect(kit.buildMs).toBeGreaterThan(0);
  });

  it("leaves most of each surface alone, so the palette still rules, but has every kind of mark somewhere", () => {
    const atlas = shipped(), n = atlas.size;
    for (const layer of atlas.layers.flatMap((l, i) => (l.name === "ground" ? [] : [i]))) {
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
      if (atlas.layers[layer]!.name === "metal") expect(share(tape), "metal tape").toBeGreaterThan(0.0005);
    }
  });

  it("tiles with no seam: the first and last columns and rows differ no more than neighbours inside", () => {
    const atlas = shipped(), n = atlas.size;
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
    expect(() => parsePaintLook({ ...look, variants: 0 })).toThrow(/variants/);
    expect(() => parsePaintLook({ ...look, variants: 1.5 })).toThrow(/variants/);
    expect(() => parsePaintLook({ ...look, anisotropy: 32 })).toThrow(/anisotropy/);
    expect(() => parsePaintLook({ ...look, cellTone: 0.5 })).toThrow(/cellTone/);
    expect(() => parsePaintLook({ ...look, farTone: { meters: 0, strength: 0.05 } })).toThrow(/farTone/);
    expect(() => parsePaintLook({ ...look, farTone: undefined })).toThrow(/farTone/);
    expect(() => parsePaintLook({ ...look, metal: { ...look.metal, brushWidth: [0.006, 0.003] } })).toThrow(/brushWidth/);
    expect(() => parsePaintLook({ ...look, wood: { ...look.wood, grainWidth: 0.001 } })).toThrow(/grainWidth/);
    expect(() => parsePaintLook({ ...look, wood: { ...look.wood, studs: 0 } })).toThrow(/studs/);
  });
});
