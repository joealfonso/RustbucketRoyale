import { rng, seedOf } from "../dressing/kinds";
import { paintConcrete } from "./concreteTile";
import { paintGround } from "./groundTile";
import { paintMetal } from "./metalTile";
import { LAYERS, type LayerName, type PaintLook } from "./paintLook";
import { wearField } from "./marks";
import { Tile } from "./raster";
import { paintWood } from "./woodTile";

// The painted atlas (DESIGN.md, Textures): one square RGBA layer per material, tileSize pixels a side, built in the
// browser at load from data/paint.json's seed, so nothing is downloaded and every run paints the same pixels. The
// layers are masks and shades, not colours: the palette still decides every colour (paintChunk.ts).
// Layer order is LAYERS, which is also the layer index the shaders read.

export interface PaintAtlas {
  size: number;
  layers: readonly LayerName[];
  data: Uint8Array; // layer after layer, each size * size RGBA, row 0 at the bottom
}

export function buildPaintAtlas(look: PaintLook): PaintAtlas {
  const n = look.tileSize;
  const data = new Uint8Array(n * n * 4 * LAYERS.length);
  const wear = wearField(n, look.seed);
  LAYERS.forEach((layer, index) => {
    const seed = seedOf(look.seed, index);
    const tile = new Tile(data, n, index * n * n * 4);
    const random = rng(seed);
    if (layer === "metal") paintMetal(tile, look.metal, random, wear);
    else if (layer === "concrete") paintConcrete(tile, look.concrete, random, wear, seed);
    else if (layer === "wood") paintWood(tile, look.wood, random, wear);
    else paintGround(tile, look.groundTile, random);
  });
  return { size: n, layers: LAYERS, data };
}

export function layerIndex(layer: LayerName): number {
  return LAYERS.indexOf(layer);
}
