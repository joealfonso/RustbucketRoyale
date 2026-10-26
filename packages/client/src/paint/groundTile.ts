import type { GroundTileLook } from "./groundDetailLook";
import { between, crack, pick, type Random } from "./marks";
import { TileNoise, type Tile } from "./raster";

// The close-range ground detail, seen from above: one kind of ground per channel, so the shader gets all three from the
// same read and picks between them by the ground's own patches (groundDetail.ts). Brightness channels, 0.5 leaves the
// ground alone; flat shapes with hard edges like everything else.
// DIRT (R): grit, pebbles and a few stones (pale inside a darker rim), and cracks.
// GRASS (G): blade strokes in tufts, with dark soil specks and a few pebbles between them.
// ROCK (B): flat facets a shade lighter or darker, fissures and mineral specks.
// BLEND (A): ragged clumpy noise spread across 0..1. Where two kinds of ground meet, the shader compares it with how
//   far across the edge a spot is, so the detail crosses each edge in clumps instead of a straight line.
// Everything is small (millimetres to centimetres on a 3 m tile) and sparse, because the shader reads the tile twice
// at two sizes and adds them. Sizes are in tile widths, so the same marks paint at any tileSize; the thinnest are
// about 1 pixel at 512 and 2 at 1024.
export const DIRT = 0, GRASS = 1, ROCK = 2, BLEND = 3;

// The blend noise stays this far inside 0..1, so the shader's softened step never shows a kind of ground outside its band.
export const BLEND_MARGIN = 0.08;

export function paintGround(tile: Tile, look: GroundTileLook, random: Random, seed: number): void {
  for (const channel of [DIRT, GRASS, ROCK]) tile.fill(channel, 0.5);
  paintDirt(tile, look, random);
  paintGrass(tile, look, random);
  paintRock(tile, look, random);
  paintBlend(tile, look, seed);
}

function paintDirt(tile: Tile, look: GroundTileLook, random: Random): void {
  for (let i = 0; i < look.grit; i++) tile.disc(random(), random(), between(random, 0.0007, 0.0017), DIRT, random() < 0.55 ? 0.38 : 0.62);
  for (let i = 0; i < look.pebbles + look.stones; i++) {
    const stone = i >= look.pebbles;
    const x = random(), y = random(), r = stone ? between(random, 0.012, 0.02) : between(random, 0.003, 0.009);
    tile.blob(x, y, r * 1.25, 0.25, random, DIRT, 0.3);
    tile.blob(x, y, r, 0.25, random, DIRT, pick(random, [0.6, 0.64, 0.44]));
    if (stone) crack(tile, random, x - r * 0.5, y, between(random, -0.5, 0.5), r * 1.1, 0.0012, DIRT, 0.34, "set");
  }
  for (let i = 0; i < look.cracks; i++) crack(tile, random, random(), random(), random() * Math.PI * 2, between(random, 0.15, 0.3), 0.0018, DIRT, 0.2, "min");
}

function paintGrass(tile: Tile, look: GroundTileLook, random: Random): void {
  for (let i = 0; i < look.soilSpecks; i++) tile.disc(random(), random(), between(random, 0.0008, 0.0018), GRASS, 0.36);
  // A few pebbles in the grass too, so a meadow is not all blades.
  for (let i = 0; i < look.grassPebbles; i++) {
    const x = random(), y = random(), r = between(random, 0.003, 0.008);
    tile.blob(x, y, r * 1.25, 0.25, random, GRASS, 0.32);
    tile.blob(x, y, r, 0.25, random, GRASS, pick(random, [0.58, 0.62, 0.46]));
  }
  // Tufts: blades fanning out from one root, darker ones first so the light ones lie on top.
  for (let i = 0; i < look.tufts; i++) {
    const x = random(), y = random(), blades = 4 + Math.floor(random() * 6), lean = random() * Math.PI * 2;
    for (const value of [0.3, 0.7]) {
      for (let b = 0; b < blades; b++) {
        if (value < 0.5 && b % 2 === 1) continue;
        const a = lean + (b / blades - 0.5) * 2.2 + between(random, -0.2, 0.2), length = between(random, 0.01, 0.028);
        const sx = x + between(random, -0.003, 0.003), sy = y + between(random, -0.003, 0.003);
        tile.stroke(sx, sy, sx + Math.cos(a) * length, sy + Math.sin(a) * length, 0.0014, 0.0003, GRASS, value);
      }
    }
  }
}

function paintRock(tile: Tile, look: GroundTileLook, random: Random): void {
  // Facets first, as flat planes of the rock catching a little more or less light; fissures and specks lie over them.
  for (let i = 0; i < look.rockFacets; i++) {
    tile.rect(random(), random(), between(random, 0.015, 0.05), between(random, 0.008, 0.03), random() * Math.PI, ROCK, random() < 0.5 ? 0.44 : 0.57);
  }
  for (let i = 0; i < look.fissures; i++) crack(tile, random, random(), random(), random() * Math.PI * 2, between(random, 0.08, 0.22), 0.0016, ROCK, 0.22, "min");
  for (let i = 0; i < look.rockSpecks; i++) tile.disc(random(), random(), between(random, 0.0007, 0.0015), ROCK, random() < 0.5 ? 0.4 : 0.62);
}

function paintBlend(tile: Tile, look: GroundTileLook, seed: number): void {
  const coarse = new TileNoise(look.blendCoarseCells, seed), fine = new TileNoise(look.blendFineCells, seed + 1);
  // Two octaves of value noise bunch up round one half; stretched back out so the whole band gets used.
  tile.field(BLEND, (x, y) => {
    const v = (coarse.at(x, y) * 0.65 + fine.at(x, y) * 0.35 - 0.5) * 1.8 + 0.5;
    return Math.min(1 - BLEND_MARGIN, Math.max(BLEND_MARGIN, v));
  });
}
