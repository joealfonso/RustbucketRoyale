import { Tile, TileNoise } from "./raster";

// What each channel of a surface layer means, read by paintChunk.ts. The ground layer has its own (groundTile.ts).
// SHADE: brightness, 0.5 leaves the colour alone, darker below, lighter above (brush marks, seams, rivets, grain).
// RUST: 0 none, RUST_LIGHT a rust streak in the light rust colour, RUST_DARK its deep rust core.
// GRIME: dirt and soot, shown above one half.
// MARK: below WEAR_TOP a soft wear field (how likely a box edge is chipped there), CHIP for paint knocked off down to
// the bare material, TAPE for a strip of tape. Kept in one channel so the atlas is one RGBA texture.
export const SHADE = 0, RUST = 1, GRIME = 2, MARK = 3;
export const RUST_LIGHT = 0.62, RUST_DARK = 0.92;
export const WEAR_TOP = 0.45, CHIP = 0.66, TAPE = 1;

export type Random = () => number;
export const between = (random: Random, a: number, b: number) => a + (b - a) * random();
export const pick = <T>(random: Random, items: readonly T[]) => items[Math.floor(random() * items.length)]!;

// The soft wear field that goes in MARK before any marks, one byte a pixel. Every surface layer can share one.
export function wearField(size: number, seed: number): Uint8Array {
  const coarse = new TileNoise(6, seed), fine = new TileNoise(17, seed + 1);
  const out = new Uint8Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size, y = (py + 0.5) / size;
      out[py * size + px] = Math.round((coarse.at(x, y) * 0.65 + fine.at(x, y) * 0.35) * WEAR_TOP * 255);
    }
  }
  return out;
}

// The starting state of a surface layer: no marks, and the wear field in MARK.
export function blankSurface(tile: Tile, wear: Uint8Array): void {
  tile.fill(SHADE, 0.5);
  tile.fill(RUST, 0);
  tile.fill(GRIME, 0);
  tile.copy(MARK, wear);
}

// Brush marks: short flat strokes a few shades either side of the paint, all leaning near `angle`, inside a box.
// Flat values, not blurred noise, so they read as paint laid on with a brush (DESIGN.md, "visible brush marks").
export function brushStrokes(tile: Tile, random: Random, count: number, box: { x0: number; y0: number; x1: number; y1: number }, angle: number, spread: number, length: [number, number], width: [number, number], levels: readonly number[]): void {
  for (let i = 0; i < count; i++) {
    const x = between(random, box.x0, box.x1), y = between(random, box.y0, box.y1);
    const a = angle + (random() - 0.5) * 2 * spread, l = between(random, length[0], length[1]) / 2, w = between(random, width[0], width[1]);
    const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    const value = pick(random, levels);
    // Thin where the brush lands and lifts, full in the middle.
    tile.stroke(x - dx, y - dy, x, y, w * 0.35, w, SHADE, value);
    tile.stroke(x, y, x + dx, y + dy, w, w * 0.2, SHADE, value);
  }
}

// A rust streak running down from a point (a rivet, a hole, a seam), wobbling a little, thinning as it goes, with a
// deep rust core where the water comes out.
export function rustStreak(tile: Tile, random: Random, x: number, y: number, length: number, width: number): void {
  const points: [number, number][] = [];
  const steps = 5;
  let wx = x;
  for (let i = 0; i <= steps; i++) {
    points.push([wx, y - (length * i) / steps]);
    wx += (random() - 0.5) * width * 1.2;
  }
  tile.line(points, width, width * 0.2, RUST, RUST_LIGHT, "max");
  tile.blob(x, y, width * 1.3, 0.3, random, RUST, RUST_DARK, "max", 6);
}

// A chip: a ragged flake of paint gone, showing what is under it.
export function chip(tile: Tile, random: Random, x: number, y: number, r: number): void {
  tile.blob(x, y, r, 0.45, random, MARK, CHIP, "max");
}

// A crack: a jagged line wandering from a point, sometimes splitting in two. Returns its points, for chips along it.
export function crack(tile: Tile, random: Random, x: number, y: number, angle: number, length: number, width: number, channel: number, value: number, mode: "set" | "max" | "min", depth = 0): [number, number][] {
  const points: [number, number][] = [[x, y]];
  const step = length / 9;
  let a = angle, px = x, py = y;
  for (let i = 0; i < 9; i++) {
    a += (random() - 0.5) * 1.1;
    px += Math.cos(a) * step;
    py += Math.sin(a) * step;
    points.push([px, py]);
    if (depth < 1 && i > 2 && random() < 0.18) crack(tile, random, px, py, a + (random() < 0.5 ? 0.9 : -0.9), length * 0.45, width * 0.7, channel, value, mode, depth + 1);
  }
  tile.line(points, width, width * 0.4, channel, value, mode);
  return points;
}
