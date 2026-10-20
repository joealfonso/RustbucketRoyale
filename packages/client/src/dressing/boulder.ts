import groundJson from "../../../../data/ground.json";
import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { boulder as stone } from "./rock";
import { merge, turn, type MeshData, type V3 } from "./shapes";

// A boulder lying on the hills (map kind "boulder", from generateMap.ts): a cube of rock 2 to 4.5 m, about a third of
// it sunk into the slope. Drawn in the rock colours of the hills' steep bands (data/ground.json hills.rock), so it
// reads as a piece of the hillside that broke off. Either one faceted stone over the whole box, or a big stone with a
// slab split off one side in the darker strata colour. Quarter turns by seed so a field of them is not all alike.

const { color: ROCK, strata: STRATA } = groundJson.hills.rock;

const lerp = (r: () => number, a: number, b: number) => a + (b - a) * r();

export const boulder: KindBuilder = (box: DressBox): DressPiece[] => {
  const r = rng(box.seed);
  const sx = box.max[0] - box.min[0], sz = box.max[2] - box.min[2], h = box.max[1] - box.min[1];
  const hx = sx / 2, hz = sz / 2;
  const main: MeshData[] = [], slab: MeshData[] = [];
  if (r() < 0.55) {
    main.push(stone(r, -hx, hx, -hz, hz, h));
  } else {
    // The two overlap through the middle, so there is no gap to see through where the box still stops shots.
    main.push(stone(r, -hx, hx * lerp(r, 0.4, 0.6), -hz, hz, h));
    slab.push(stone(r, hx * lerp(r, 0, 0.2), hx, -hz, hz, h * lerp(r, 0.6, 0.8)));
  }
  // A square box can take any quarter turn and stay inside itself; an oblong one only a half turn.
  const square = Math.abs(sx - sz) < 0.01;
  const turns = Math.floor(r() * (square ? 4 : 2));
  const angles: V3 = [0, turns * (square ? Math.PI / 2 : Math.PI), 0];
  const centre: V3 = [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];
  const place = (m: MeshData) => turn(m, angles, [0, 0, 0], centre);
  const pieces: DressPiece[] = [{ paint: ROCK, mesh: place(merge(...main)) }];
  if (slab.length > 0) pieces.push({ paint: STRATA, mesh: place(merge(...slab)) });
  return pieces;
};
