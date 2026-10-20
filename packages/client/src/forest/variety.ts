import { rng, seedOf } from "../dressing/kinds";
import type { PineLook } from "./config";

// How one tree differs from its neighbours: its shape, its colour, how tall and how wide, and which way it is
// turned. Picked from the map seed and the tree's prop id, so every player sees the same wood.
export interface TreeLook {
  shape: number;
  color: number; // index into look.colors
  height: number; // scale on y
  width: number; // scale on x and z
  yaw: number; // radians
  fallYaw: number; // the way it falls when nothing says otherwise, radians
}

function weighted(r: () => number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = r() * total;
  for (let i = 0; i < weights.length; i++) if ((roll -= weights[i]!) < 0) return i;
  return weights.length - 1;
}

export function treeLook(look: PineLook, mapSeed: number, propId: number): TreeLook {
  const r = rng(seedOf(mapSeed, 7000000 + propId));
  const between = ([lo, hi]: [number, number]) => lo + (hi - lo) * r();
  return {
    shape: weighted(r, look.shapes.map((s) => s.weight)),
    color: weighted(r, look.colors.map((c) => c.weight)),
    height: between(look.scale.height),
    width: between(look.scale.width),
    yaw: r() * Math.PI * 2,
    fallYaw: r() * Math.PI * 2,
  };
}
