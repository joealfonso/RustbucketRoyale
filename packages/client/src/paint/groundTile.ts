import type { PaintLook } from "./paintLook";
import { between, crack, pick, type Random } from "./marks";
import type { Tile } from "./raster";

// The close-range ground detail, seen from above. Its own channels, read by groundDetail.ts:
// GRIT (R): brightness, 0.5 leaves the ground alone: specks of grit, pebbles and a few stones, each a pale shape
//   inside a darker rim, flat like everything else.
// GRASS (G): the same, for blade strokes in tufts, only shown where the ground is green.
// CRACKS (B): 0 none, 1 a crack, only shown where the ground is bare.
// Everything is small (centimetres) and sparse, because the shader reads the tile twice at two sizes and adds them.
export const GRIT = 0, GRASS = 1, CRACKS = 2;

export function paintGround(tile: Tile, look: PaintLook["groundTile"], random: Random): void {
  tile.fill(GRIT, 0.5);
  tile.fill(GRASS, 0.5);
  tile.fill(CRACKS, 0);
  tile.fill(3, 1);

  for (let i = 0; i < look.grit; i++) tile.disc(random(), random(), between(random, 0.001, 0.0024), GRIT, random() < 0.6 ? 0.38 : 0.62);
  for (let i = 0; i < look.pebbles + look.stones; i++) {
    const stone = i >= look.pebbles;
    const x = random(), y = random(), r = stone ? between(random, 0.014, 0.022) : between(random, 0.004, 0.011);
    tile.blob(x, y, r * 1.25, 0.25, random, GRIT, 0.3);
    tile.blob(x, y, r, 0.25, random, GRIT, pick(random, [0.6, 0.64, 0.44]));
    if (stone) crack(tile, random, x - r * 0.5, y, between(random, -0.5, 0.5), r * 1.1, 0.0015, GRIT, 0.34, "set");
  }

  // Tufts: blades fanning out from one root, darker ones first so the light ones lie on top.
  for (let i = 0; i < look.tufts; i++) {
    const x = random(), y = random(), blades = 4 + Math.floor(random() * 6), lean = random() * Math.PI * 2;
    for (const value of [0.3, 0.72]) {
      for (let b = 0; b < blades; b++) {
        if (value < 0.5 && b % 2 === 1) continue;
        const a = lean + (b / blades - 0.5) * 2.2 + between(random, -0.2, 0.2), length = between(random, 0.012, 0.032);
        const sx = x + between(random, -0.003, 0.003), sy = y + between(random, -0.003, 0.003);
        tile.stroke(sx, sy, sx + Math.cos(a) * length, sy + Math.sin(a) * length, 0.0019, 0.0004, GRASS, value);
      }
    }
  }

  for (let i = 0; i < look.cracks; i++) crack(tile, random, random(), random(), random() * Math.PI * 2, between(random, 0.15, 0.32), 0.0024, CRACKS, 1, "max");
}
