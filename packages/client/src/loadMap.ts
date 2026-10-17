import {
  World, boxFromData, generateMap, parseChunkSet, parseTiers,
  type Box, type BoxData, type MechStats,
} from "@rustbucket/shared";
import chunksJson from "../../../data/chunks.json";
import tiersJson from "../../../data/tiers.json";
import greyboxJson from "../../../data/greybox.json";

// Everything the client needs to draw and walk on a map.
export interface PlayMap {
  tier: string;
  seed: number;
  meters: number; // side length, used to frame the overview camera
  world: World;
  boxes: Box[];
  colors: number[]; // palette index of each box
  palette: string[];
  spawn: [number, number, number];
}

const chunks = parseChunkSet(chunksJson);
const tiers = parseTiers(tiersJson);

// "range" is the old flat 2000 m strip with a few test props. Anything else is built from the seed,
// the same way the server builds it, so both sides get identical maps.
export function buildPlayMap(tier: string, seed: number, mech: MechStats): PlayMap {
  if (tier === "range") {
    const range = greyboxJson as { spawn: [number, number, number]; boxes: BoxData[] };
    const palette: string[] = [];
    const colors = range.boxes.map((b) => {
      const found = palette.indexOf(b.color);
      return found >= 0 ? found : palette.push(b.color) - 1;
    });
    const boxes = range.boxes.map(boxFromData);
    return { tier, seed, meters: 600, world: new World(boxes), boxes, colors, palette, spawn: range.spawn };
  }
  const map = generateMap(seed, tier, chunks, tiers, mech);
  return { tier, seed, meters: map.meters, world: map.world, boxes: map.boxes, colors: map.colors, palette: map.palette, spawn: map.spawns[0]! };
}
