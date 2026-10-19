import {
  World, buildRange, generateMap, parseChunkSet, parsePropConfig, parseTiers,
  type Box, type MechStats, type PropInstance, type RangeData, type Terrain,
} from "@rustbucket/shared";
import chunksJson from "../../../data/chunks.json";
import tiersJson from "../../../data/tiers.json";
import greyboxJson from "../../../data/greybox.json";
import propsJson from "../../../data/props.json";

// Everything the client needs to draw and walk on a map.
export interface PlayMap {
  tier: string;
  seed: number;
  meters: number; // side length, used to frame the overview camera
  world: World;
  boxes: Box[];
  colors: number[]; // palette index of each box
  palette: string[];
  kinds: Int8Array; // what each box is dressed as (index into kindNames), or -1 for a plain box
  kindNames: string[];
  spawn: [number, number, number];
  props: PropInstance[];
  propOfBox: Int32Array;
  // The hills, drawn by terrainMesh.ts. Null on the range, whose floor is box 0 drawn as a plain box.
  terrain: Terrain | null;
}

const chunks = parseChunkSet(chunksJson);
const tiers = parseTiers(tiersJson);
export const propConfig = parsePropConfig(propsJson);

// "range" is the old flat 2000 m strip with a few test props. Anything else is built from the seed,
// the same way the server builds it, so both sides get identical maps.
export function buildPlayMap(tier: string, seed: number, mech: MechStats): PlayMap {
  if (tier === "range") {
    const data = greyboxJson as RangeData;
    const range = buildRange(data, propConfig);
    const palette: string[] = [];
    const colors = range.boxColors.map((c) => {
      const found = palette.indexOf(c);
      return found >= 0 ? found : palette.push(c) - 1;
    });
    return {
      tier, seed, meters: 600, world: new World(range.boxes), boxes: range.boxes, colors, palette, kinds: new Int8Array(range.boxes.length).fill(-1), kindNames: [],
      spawn: data.spawn, props: range.props, propOfBox: range.propOfBox, terrain: null,
    };
  }
  const map = generateMap(seed, tier, chunks, tiers, mech, propConfig);
  return {
    tier, seed, meters: map.meters, world: map.world, boxes: map.boxes, colors: map.colors, palette: map.palette, kinds: map.kinds, kindNames: map.kindNames, spawn: map.spawns[0]!,
    props: map.props, propOfBox: map.propOfBox, terrain: map.terrain,
  };
}
