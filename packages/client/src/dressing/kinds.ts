import type { SurfaceKind } from "../paint/paintLook";
import type { MeshData, V3 } from "./shapes";

// The contract between the junkyard dressing and the builders that make it (one file per kind in this folder).
//
// A builder is given one map box (its world-space corners and a seed) and returns the pieces that replace it on
// screen, each in one paint. Rules every builder keeps:
//  - Stay inside the box (a few centimetres over at most): the box is still what you walk into and what stops shots,
//    so anything outside it would be a ghost you could walk through.
//  - Fill it: the plain box is hidden while the dressing shows, so a gap would let you see through solid cover.
//  - Same box and seed, same result: no Math.random, no time. Use `rng(seed)`.
//  - Faces outward (the shapes in shapes.ts already do), flat-shaded, chunky, nothing thinner than about 0.08 m.
//  - Cheap: within the triangle budget for the box's size (data/dressing.json "triangleBudget", budget.ts), about two
//    thousand for a shipping container, and scale the detail with size, not the count (a 34 m warehouse wall gets
//    more posts, not finer ones). Build from the stretched unit parts in structure.ts where you can: the dressing
//    builds a chunk of boxes on one frame.
//
// Paints are palette names (data/palette.json: rustOrange, deepRust, moss, darkMoss, scrapSteel, soot, warmLight,
// sparkYellow, paintWhite, frameNavy) or hex colours. Everything is drawn with the weathered world material, so moss
// grows on what faces up and rust streaks run down walls by themselves: don't model those.

export interface DressBox {
  min: V3;
  max: V3;
  seed: number; // fixed per box and map, for choosing variations
  color: string; // the box's own map colour, for builders that keep it
}

export interface DressPiece {
  paint: string;
  mesh: MeshData;
  // Which painted marks it carries (paint/paintLook.ts): metal when left out, null for none (plants).
  surface?: SurfaceKind | null;
}

// The key a piece is merged under: its colour and its surface, since each pair is one material.
export const mergeKey = (hex: string, surface: SurfaceKind | null | undefined) => `${hex}|${surface === undefined ? "metal" : surface ?? "none"}`;

// The colour and surface back out of a merge key.
export function fromMergeKey(key: string): [string, SurfaceKind | null] {
  const [hex, surface] = key.split("|") as [string, string];
  return [hex, surface === "none" ? null : (surface as SurfaceKind)];
}

export type KindBuilder = (box: DressBox) => DressPiece[];

// Small fast deterministic random numbers in [0, 1) from a seed (mulberry32).
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seed for one thing on one map, from two whole numbers.
export function seedOf(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
