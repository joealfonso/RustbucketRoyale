import { rng, seedOf } from "../dressing/kinds";
import { paintConcrete } from "./concreteTile";
import { paintGround } from "./groundTile";
import { paintMetal } from "./metalTile";
import { LAYERS, type LayerName, type PaintLook } from "./paintLook";
import { wearField } from "./marks";
import { Tile } from "./raster";
import { paintWood } from "./woodTile";

// The painted atlas (DESIGN.md, Textures): one square RGBA layer per material and variant, tileSize pixels a side,
// built at load from data/paint.json's seed (in a worker, paintKit.ts), so nothing is downloaded and every run paints
// the same pixels. The layers are masks and shades, not colours: the palette still decides every colour (paintChunk.ts).
// Layer order: the first variant of each of LAYERS (so a layer's index is still LAYERS' index, and the ground stays at
// its place), then each further variant of the surface layers, in LAYERS order. surfaceLayer() is that rule, and the
// shader in paintChunk.ts repeats it.

export interface AtlasLayer {
  name: LayerName;
  variant: number;
}

export interface PaintAtlas {
  size: number;
  layers: readonly AtlasLayer[];
  data: Uint8Array; // layer after layer, each size * size RGBA, row 0 at the bottom
}

// The layers that come in variants: every one but the ground.
export const SURFACE_LAYERS: readonly LayerName[] = LAYERS.filter((l) => l !== "ground");

export function atlasLayers(look: PaintLook): AtlasLayer[] {
  const out: AtlasLayer[] = LAYERS.map((name) => ({ name, variant: 0 }));
  for (let variant = 1; variant < look.variants; variant++) for (const name of SURFACE_LAYERS) out.push({ name, variant });
  return out;
}

export function buildPaintAtlas(look: PaintLook): PaintAtlas {
  const n = look.tileSize;
  const layers = atlasLayers(look);
  const data = new Uint8Array(n * n * 4 * layers.length);
  const wear = wearField(n, look.seed);
  layers.forEach(({ name: layer }, index) => {
    const seed = seedOf(look.seed, index);
    const tile = new Tile(data, n, index * n * n * 4);
    const random = rng(seed);
    if (layer === "metal") paintMetal(tile, look.metal, random, wear);
    else if (layer === "concrete") paintConcrete(tile, look.concrete, random, wear, seed);
    else if (layer === "wood") paintWood(tile, look.wood, random, wear);
    else paintGround(tile, look.groundTile, random, seed);
  });
  return { size: n, layers, data };
}

// The first variant's layer.
export function layerIndex(layer: LayerName): number {
  return LAYERS.indexOf(layer);
}

export function surfaceLayer(layer: LayerName, variant: number): number {
  return variant === 0 ? layerIndex(layer) : LAYERS.length + (variant - 1) * SURFACE_LAYERS.length + SURFACE_LAYERS.indexOf(layer);
}

// Where a tile cell may start inside its layer, as [across, up]: the layer is cut by joints running its whole height
// at every 1/across and its whole width at every 1/up, so a cell started on any of them meets its neighbours at a
// joint, never mid-plate. The painters keep those joints whole (metalTile.ts, concreteTile.ts, woodTile.ts).
export function cellSteps(look: PaintLook, layer: LayerName): [number, number] {
  if (layer === "metal") return [1, look.metal.plateRows];
  if (layer === "concrete") return [1, look.concrete.pourLifts];
  if (layer === "wood") return [look.wood.studs, 1];
  return [1, 1];
}
