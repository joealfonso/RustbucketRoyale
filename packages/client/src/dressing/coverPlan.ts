import type { Box } from "@rustbucket/shared";
import { COVER_KINDS, type CoverConfig, type CoverGround, type CoverKind } from "./coverConfig";
import { rng, seedOf } from "./kinds";

// Where the near ground cover grows: pure numbers, no three.js, so placement can be tested. The map is cut into
// square cells; each cell's cover comes from its own seed, so it is the same whenever you come back to it and the
// same for everyone. Each spot is sorted into a kind of ground, which picks the mix:
//  - none in the water, inside any box, or under a box standing low over the ground;
//  - "pad": the level hard ground round a building, and the floor under a roof, gets rubble and junk, sparser;
//  - "shore": just above the water, reeds (tall grass);
//  - "trees": round a trunk, ferns;
//  - "slope": steeper ground, more ferns and stones;
//  - "open": the rest, mostly grass.
// Plants grow in clear patches with bare dirt between and bare paths winding through them, and junk on a pad gathers
// in a few piles along the walls, so the ground reads as shapes rather than an even sprinkle (V11). Loose junk on open
// ground is the scatter's job (scatter.ts), in a few bigger piles.

export interface CoverMap {
  meters: number;
  seed: number;
  boxes: readonly Box[];
  kinds: Int8Array;
  kindNames: readonly string[];
  terrain: { heightAt(x: number, z: number): number; waterLevel: number } | null;
}

// One placed clump, as it is stored: kind index, position, turn about y, size across and up, and a colour tint.
export const ITEM_FLOATS = 10;

const BUILDING_KINDS = new Set(["sheet", "container", "ruin", "tower"]);
const ROOF_CLEARANCE = 1; // a box whose underside is this far over the ground is a roof you can walk under

const isTree = (b: Box) => b.maxX - b.minX <= 1.2 && b.maxZ - b.minZ <= 1.2 && b.maxY - b.minY >= 8;
// A lot of buildings sit flush on their pads, so "how far from its footprint" is a box distance, zero inside.
const outside = (b: Box, x: number, z: number) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));

export class CoverSites {
  private grid = new Map<number, number[]>(); // cell → boxes whose reach touches it
  private cells: number;
  private half: number;
  private building: Uint8Array;
  private tree: Uint8Array;

  constructor(private map: CoverMap, private config: CoverConfig) {
    this.half = map.meters / 2;
    this.cells = Math.ceil(map.meters / config.cellMeters);
    this.building = new Uint8Array(map.boxes.length);
    this.tree = new Uint8Array(map.boxes.length);
    const ground = (b: Box) => map.terrain?.heightAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) ?? 0;
    map.boxes.forEach((b, i) => {
      if (i === 0 || b.maxY < ground(b) + 0.05) return; // the floor slab, and anything sunk flat in the ground
      if (b.minX >= this.half || b.maxX <= -this.half || b.minZ >= this.half || b.maxZ <= -this.half) return; // edge walls
      const kind = map.kinds[i]! >= 0 ? map.kindNames[map.kinds[i]!]! : "";
      this.tree[i] = isTree(b) ? 1 : 0;
      this.building[i] = BUILDING_KINDS.has(kind) || (kind === "plain" && b.maxY - b.minY >= 1.5) ? 1 : 0;
      const reach = this.tree[i] ? config.treeMeters : this.building[i] ? config.padMeters : config.clearMeters;
      const [x0, z0] = this.cellOf(b.minX - reach, b.minZ - reach), [x1, z1] = this.cellOf(b.maxX + reach, b.maxZ + reach);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const key = z * this.cells + x;
          const list = this.grid.get(key);
          if (list) list.push(i);
          else this.grid.set(key, [i]);
        }
      }
    });
  }

  get cellsPerSide(): number {
    return this.cells;
  }

  cellOf(x: number, z: number): [number, number] {
    const clamp = (n: number) => Math.min(this.cells - 1, Math.max(0, Math.floor((n + this.half) / this.config.cellMeters)));
    return [clamp(x), clamp(z)];
  }

  heightAt(x: number, z: number): number {
    return this.map.terrain?.heightAt(x, z) ?? 0;
  }

  // Rise per metre of the ground at (x, z), from the heights half a metre either side.
  slopeAt(x: number, z: number): number {
    const t = this.map.terrain;
    if (!t) return 0;
    return Math.hypot(t.heightAt(x + 0.5, z) - t.heightAt(x - 0.5, z), t.heightAt(x, z + 0.5) - t.heightAt(x, z - 0.5));
  }

  // What kind of ground (x, z) is for cover, or null where nothing grows.
  groundAt(x: number, z: number): CoverGround | null {
    if (Math.abs(x) > this.half - 1 || Math.abs(z) > this.half - 1) return null;
    const y = this.heightAt(x, z);
    const water = this.map.terrain?.waterLevel ?? -Infinity;
    if (y < water + 0.05) return null;
    const [cx, cz] = this.cellOf(x, z);
    let pad = false, trees = false;
    for (const i of this.grid.get(cz * this.cells + cx) ?? []) {
      const b = this.map.boxes[i]!;
      const d = outside(b, x, z);
      if (d <= this.config.clearMeters) {
        if (d === 0 && b.minY > y + ROOF_CLEARANCE) { pad = true; continue; } // under a roof
        return null;
      }
      if (this.building[i] && d <= this.config.padMeters) pad = true;
      else if (this.tree[i] && d <= this.config.treeMeters) trees = true;
    }
    if (pad) return "pad";
    if (y < water + this.config.shoreMeters) return "shore";
    if (trees) return "trees";
    return this.slopeAt(x, z) > this.config.slopeAbove ? "slope" : "open";
  }
}

// Smooth value noise in [0, 1] on a lattice `spacing` metres apart, from the map seed and a salt.
function patchNoise(seed: number, salt: number, spacing: number, x: number, z: number): number {
  const gx = x / spacing, gz = z / spacing;
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const at = (a: number, b: number) => seedOf(seed ^ salt, Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) / 4294967296;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
  const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
  return top + (bottom - top) * sz;
}

// 0 below lo, 1 above hi, a smooth step between.
function ramp([lo, hi]: number[], v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo!) / (hi! - lo!)));
  return t * t * (3 - 2 * t);
}

function pickKind(mix: Record<CoverKind, number>, roll: number): number {
  let total = 0;
  for (const k of COVER_KINDS) total += mix[k];
  let left = roll * total;
  for (let i = 0; i < COVER_KINDS.length; i++) if ((left -= mix[COVER_KINDS[i]!]) < 0) return i;
  return 0;
}

const PLANTS = new Set<number>([COVER_KINDS.indexOf("grass"), COVER_KINDS.indexOf("weeds"), COVER_KINDS.indexOf("fern")]);
const GRASS = COVER_KINDS.indexOf("grass");
export const MAX_HEIGHT = 2; // times the model's own height, which is under 0.8 m

// The cover of one cell, ITEM_FLOATS numbers per clump.
export function planCell(sites: CoverSites, map: CoverMap, c: CoverConfig, cx: number, cz: number): Float32Array {
  const cells = sites.cellsPerSide;
  const r = rng(seedOf(seedOf(map.seed, 0x5eed), cz * cells + cx));
  const x0 = cx * c.cellMeters - map.meters / 2, z0 = cz * c.cellMeters - map.meters / 2;
  const out: number[] = [];
  for (let t = 0; t < c.triesPerCell; t++) {
    // Every try draws the same numbers whether or not it is kept, so one change never reshuffles the rest.
    const x = x0 + r() * c.cellMeters, z = z0 + r() * c.cellMeters;
    const keep = r(), roll = r(), yaw = r() * Math.PI * 2, size = r(), tall = r();
    const lush = patchNoise(map.seed, 0x1a5, c.patchMeters, x, z);
    const ground = sites.groundAt(x, z);
    if (!ground) continue;
    let density: number;
    if (ground === "pad") density = c.padDensity * ramp(c.pileEdge, patchNoise(map.seed, 0x9a1, c.pileMeters, x, z));
    else {
      // A path is where a second, larger noise crosses its middle: a line that wanders, never a grid.
      const onPath = Math.abs(patchNoise(map.seed, 0x7a7, c.pathMeters, x, z) - 0.5) < c.pathWidth;
      density = onPath ? 0 : c.patchFloor + (1 - c.patchFloor) * ramp(c.patchEdge, lush);
    }
    if (keep >= density) continue;
    const kind = pickKind(c.mixes[ground], roll);
    const [lo, hi] = c.kinds[COVER_KINDS[kind]!].scale as [number, number];
    let s = (lo + (hi - lo) * size) * (0.8 + 0.4 * lush);
    if (ground === "shore" && kind === GRASS) s *= 1.35; // reeds
    const plant = PLANTS.has(kind);
    const slope = sites.slopeAt(x, z);
    // Sunk a little, more on a slope, so nothing hangs over the downhill side.
    const y = sites.heightAt(x, z) - (plant ? 0.02 + slope * 0.15 * s : 0.03 + slope * 0.3 * s);
    // Dry patches yellow the plants; slopes drain and dry out, the shore and the woods stay green.
    let dry = Math.max(0, patchNoise(map.seed, 0xd27, c.patchMeters * 0.7, x, z) - 0.55) / 0.45;
    if (ground === "slope") dry = Math.min(1, dry + 0.3);
    if (ground === "shore" || ground === "trees" || !plant) dry = 0;
    const light = 0.9 + 0.2 * tall;
    // Capped so the tallest reeds stay about waist high on a mech: cover you can see over never reads as cover.
    out.push(kind, x, y, z, yaw, s, Math.min(MAX_HEIGHT, s * (plant ? 0.8 + 0.45 * tall : 1)),
      light * (1 + (c.dryTint[0]! - 1) * dry), light * (1 + (c.dryTint[1]! - 1) * dry), light * (1 + (c.dryTint[2]! - 1) * dry));
  }
  return new Float32Array(out);
}
