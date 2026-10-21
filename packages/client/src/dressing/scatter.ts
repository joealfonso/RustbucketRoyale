import dressingJson from "../../../../data/dressing.json";
import type { Scatter } from "./dressing";
import { rng, type DressBox, type DressPiece } from "./kinds";
import { box, convex, cylinder, merge, turn, type MeshData, type V3 } from "./shapes";

// Loose junk on open ground. Nothing here collides, so everything stays low enough that it never reads as cover. The
// junk comes in a few piles, most of them along the foot of a wall, a building or a rock (where junk ends up), a few
// out in the open as a landmark, so the ground reads as shapes rather than confetti (V11). Each item is built round
// the origin, turned about y, dropped near its pile, and kept only if its real footprint stays inside the chunk and
// clear of every box standing there; then it is set down on the hills. Grass is the ground cover's job (cover.ts).

const CLEARANCE = 0.5; // metres kept between an item and any box footprint, so nothing pokes out of a wall
const MAX_HEIGHT = 0.9; // under a mech's knee: never mistaken for cover
const TRIES = 4; // spots tried per item before it is skipped

const ITEMS = ["tyreFlat", "tyreStack", "tyreLeaning", "pipe", "plate", "drum", "bush"] as const;
type ItemName = (typeof ITEMS)[number];

// The scatter's tuning (data/dressing.json, "scatter"), checked on load.
export interface ScatterLook {
  pileSize: number[]; // items in one pile, fewest and most
  spreadMeters: number; // how far a pile's items lie from its middle along the wall; a third of that across it
  wallGapMeters: number[]; // a wall pile's middle sits this far out from the wall, nearest and farthest
  anchorAboveMeters: number; // a box at least this tall (not a tree) gathers junk at its foot
  openShare: number; // the share of piles out in the open instead of along a wall
  bushByTree: number; // the share of trees with a bush at their foot
  mix: Record<ItemName, number>; // weights of each item in a pile
}

export function parseScatterLook(raw: unknown): ScatterLook {
  const c = raw as ScatterLook;
  const fail = (what: string) => { throw new Error(`dressing.json: scatter.${what}`); };
  if (!c || typeof c !== "object") fail("is missing");
  for (const key of ["spreadMeters", "anchorAboveMeters", "openShare", "bushByTree"] as const) {
    if (typeof c[key] !== "number" || !(c[key] >= 0)) fail(`${key} must be a number, 0 or more`);
  }
  if (c.openShare > 1 || c.bushByTree > 1) fail("openShare and bushByTree are shares, 0 to 1");
  for (const key of ["pileSize", "wallGapMeters"] as const) {
    const v = c[key];
    if (!Array.isArray(v) || v.length !== 2 || !(v[0]! > 0) || !(v[1]! >= v[0]!)) fail(`${key} must be [low, high], above 0`);
  }
  if (!Number.isInteger(c.pileSize[0]) || !Number.isInteger(c.pileSize[1])) fail("pileSize must be whole numbers");
  let total = 0;
  for (const item of ITEMS) {
    if (typeof c.mix?.[item] !== "number" || c.mix[item] < 0) fail(`mix.${item} must be a number, 0 or more`);
    total += c.mix[item];
  }
  if (!(total > 0)) fail("mix needs some weight");
  return c;
}

const LOOK = parseScatterLook(dressingJson.scatter);

type Rand = () => number;
type Item = (r: Rand) => DressPiece[];

const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);

// Moves a mesh so its lowest point sits on y = 0.
function ground(mesh: MeshData): MeshData {
  let low = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) low = Math.min(low, mesh.positions[i]!);
  return turn(mesh, [0, 0, 0], [0, 0, 0], [0, -low, 0]);
}

// A tyre lying flat, its steel hub showing.
function flatTyre(radius: number, width: number, at: V3): DressPiece[] {
  return [
    { paint: "soot", mesh: cylinder([at[0], at[1] + width / 2, at[2]], radius, width, "y", 10) },
    { paint: "scrapSteel", mesh: cylinder([at[0], at[1] + width / 2 + 0.01, at[2]], radius * 0.45, width + 0.02, "y", 6) },
  ];
}

const tyreFlat: Item = (r) => flatTyre(between(r, 0.45, 0.65), between(r, 0.22, 0.3), [0, 0, 0]);

// Two or three tyres piled up, each a little off the one under it, still under MAX_HEIGHT.
const tyreStack: Item = (r) => {
  const out: DressPiece[] = [];
  const count = 2 + Math.floor(r() * 2), width = between(r, 0.2, 0.25);
  for (let i = 0; i < count; i++) out.push(...flatTyre(between(r, 0.42, 0.55), width, [between(r, -0.1, 0.1), i * width, between(r, -0.1, 0.1)]));
  return out;
};

// Standing on its tread and tipped well over, as if it rolled to a stop against nothing.
const tyreLeaning: Item = (r) => {
  const radius = between(r, 0.32, 0.4), width = between(r, 0.2, 0.26);
  const tyre = turn(cylinder([0, 0, 0], radius, width, "z", 10), [between(r, 0.8, 1.1), 0, 0]);
  return [{ paint: "soot", mesh: ground(tyre) }];
};

const pipe: Item = (r) => {
  const radius = between(r, 0.15, 0.3), length = between(r, 1.8, 3.2);
  return [{ paint: pick(r, ["rustOrange", "scrapSteel"]), mesh: cylinder([0, radius, 0], radius, length, "x", 8) }];
};

// Lying flat or propped up a little on one edge, the low edge sunk a few centimetres into the dirt.
const plate: Item = (r) => {
  const sheet = box([0, 0, 0], [between(r, 1.4, 2.6), between(r, 0.08, 0.1), between(r, 1, 1.8)], 0.03);
  const tilted = ground(turn(sheet, [r() < 0.5 ? 0 : between(r, 0.05, 0.22), 0, between(r, -0.06, 0.06)]));
  return [{ paint: pick(r, ["rustOrange", "scrapSteel", "frameNavy"]), mesh: turn(tilted, [0, 0, 0], [0, 0, 0], [0, -0.03, 0]) }];
};

// Mostly underground: only about half a metre shows. The hidden part is drawn but the ground covers it.
const drum: Item = (r) => {
  const height = 0.9, shows = between(r, 0.4, 0.55);
  const can = cylinder([0, shows - height / 2, 0], 0.3, height, "y", 10);
  return [{ paint: pick(r, ["deepRust", "sparkYellow"]), mesh: turn(can, [between(r, -0.15, 0.15), 0, between(r, -0.15, 0.15)]) }];
};

// A low faceted mound of leaves: a jittered hexagon at the foot, a wider ring above it and a small cap, so it reads
// as a clump, not a cone.
function mound(r: Rand, radius: number, height: number): MeshData {
  const turnBy = r() * Math.PI;
  const ring = (y: number, reach: number, shift: number): V3[] => Array.from({ length: 6 }, (_, i) => {
    const a = turnBy + (i / 6) * Math.PI * 2, d = radius * reach * between(r, 0.88, 1.05);
    return [Math.cos(a) * d + shift, y, Math.sin(a) * d] as V3;
  });
  const lean = radius * between(r, -0.12, 0.12);
  const foot = ring(0, 0.8, 0), belly = ring(height * 0.45, 1, lean * 0.5), cap = ring(height, 0.4, lean);
  const band = (a: V3[], b: V3[]) => a.map((_, i) => { const j = (i + 1) % a.length; return [a[i]!, a[j]!, b[j]!, b[i]!]; });
  return convex([foot, cap, ...band(foot, belly), ...band(belly, cap)]);
}

// A bush: two or three mounds leaning together, mostly green, now and then a dead brown one. Low enough (under
// MAX_HEIGHT) that it is never mistaken for cover.
const bush: Item = (r) => {
  const paint = r() < 0.12 ? "#7A5A2E" : r() < 0.55 ? "darkMoss" : "moss";
  const mounds: MeshData[] = [];
  const count = 2 + Math.floor(r() * 2);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = i === 0 ? 0 : between(r, 0.35, 0.6);
    const size = i === 0 ? between(r, 0.55, 0.8) : between(r, 0.35, 0.55);
    mounds.push(turn(mound(r, size, size * between(r, 0.85, 1.05)), [0, 0, 0], [0, 0, 0], [Math.cos(a) * d, -0.04, Math.sin(a) * d]));
  }
  return [{ paint, mesh: merge(...mounds), surface: null }];
};

const MAKERS: Record<ItemName, Item> = { tyreFlat, tyreStack, tyreLeaning, pipe, plate, drum, bush };

// Woods get undergrowth instead of junk: a share of trees (any box with a trunk-sized footprint standing taller than
// a mech) gets a bush at its foot, a little way out from the trunk.
const isTree = (b: DressBox) => b.max[0] - b.min[0] <= 1.2 && b.max[2] - b.min[2] <= 1.2 && b.max[1] - b.min[1] >= 8;

function chooseItem(r: Rand): Item {
  let total = 0;
  for (const item of ITEMS) total += LOOK.mix[item];
  let roll = r() * total;
  for (const item of ITEMS) if ((roll -= LOOK.mix[item]) < 0) return MAKERS[item];
  return plate;
}

// One side of a box, where junk can pile up: the line along its foot (start, end), the way out from it, its length.
interface Side { x0: number; z0: number; x1: number; z1: number; outX: number; outZ: number; length: number }

// The sides of the walls, buildings and rocks in a chunk, cut to the chunk, so a pile is never placed outside it.
function sidesOf(boxes: readonly DressBox[], minX: number, minZ: number, size: number): Side[] {
  const out: Side[] = [];
  const maxX = minX + size, maxZ = minZ + size;
  for (const b of boxes) {
    if (isTree(b) || b.max[1] - b.min[1] < LOOK.anchorAboveMeters) continue;
    const xa = Math.max(b.min[0], minX), xb = Math.min(b.max[0], maxX), za = Math.max(b.min[2], minZ), zb = Math.min(b.max[2], maxZ);
    if (xa < xb) {
      if (b.min[2] > minZ) out.push({ x0: xa, z0: b.min[2], x1: xb, z1: b.min[2], outX: 0, outZ: -1, length: xb - xa });
      if (b.max[2] < maxZ) out.push({ x0: xa, z0: b.max[2], x1: xb, z1: b.max[2], outX: 0, outZ: 1, length: xb - xa });
    }
    if (za < zb) {
      if (b.min[0] > minX) out.push({ x0: b.min[0], z0: za, x1: b.min[0], z1: zb, outX: -1, outZ: 0, length: zb - za });
      if (b.max[0] < maxX) out.push({ x0: b.max[0], z0: za, x1: b.max[0], z1: zb, outX: 1, outZ: 0, length: zb - za });
    }
  }
  return out;
}

// A side picked with odds by its length, so a long wall gathers more junk than a post.
function pickSide(r: Rand, sides: readonly Side[]): Side {
  let total = 0;
  for (const s of sides) total += s.length;
  let roll = r() * total;
  for (const s of sides) if ((roll -= s.length) < 0) return s;
  return sides[sides.length - 1]!;
}

function fits(pieces: DressPiece[], minX: number, minZ: number, size: number, boxes: readonly DressBox[]): boolean {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = -Infinity;
  for (const { mesh } of pieces) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      x0 = Math.min(x0, p[i]!); x1 = Math.max(x1, p[i]!);
      top = Math.max(top, p[i + 1]!);
      z0 = Math.min(z0, p[i + 2]!); z1 = Math.max(z1, p[i + 2]!);
    }
  }
  if (top > MAX_HEIGHT || x0 < minX || z0 < minZ || x1 > minX + size || z1 > minZ + size) return false;
  for (const b of boxes) {
    if (x1 > b.min[0] - CLEARANCE && x0 < b.max[0] + CLEARANCE && z1 > b.min[2] - CLEARANCE && z0 < b.max[2] + CLEARANCE) return false;
  }
  return true;
}

// Sets an item down on the hills: every corner moves up or down by the ground's height under it, so a tyre or a
// plate lies along the slope and a bush stays upright. Items are small, so the slant this gives their
// normals does not show.
function drape(mesh: MeshData, groundAt: (x: number, z: number) => number): MeshData {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) p[i + 1]! += groundAt(p[i]!, p[i + 2]!);
  return mesh;
}

export const scatter: Scatter = (chunk, boxes, count) => {
  const r = rng(chunk.seed);
  const out: DressPiece[] = [];
  // Drops an item at the first spot `spot` gives that fits, or nowhere after TRIES.
  const drop = (pieces: DressPiece[], spot: () => [number, number]) => {
    const spin = r() * Math.PI * 2;
    for (let t = 0; t < TRIES; t++) {
      const [x, z] = spot();
      const placed = pieces.map((p) => ({ ...p, mesh: turn(p.mesh, [0, spin, 0], [0, 0, 0], [x, 0, z]) }));
      if (!fits(placed, chunk.minX, chunk.minZ, chunk.size, boxes)) continue;
      const { groundAt } = chunk;
      if (groundAt) for (const p of placed) drape(p.mesh, groundAt);
      out.push(...placed);
      return;
    }
  };
  const sides = sidesOf(boxes, chunk.minX, chunk.minZ, chunk.size);
  const [fewest, most] = LOOK.pileSize as [number, number];
  const spread = LOOK.spreadMeters;
  for (let left = count; left > 0;) {
    const n = Math.min(left, fewest + Math.floor(r() * (most - fewest + 1)));
    left -= n;
    // The pile's middle and the way it runs: along a wall's foot, or anywhere in the open.
    let cx: number, cz: number, alongX: number, alongZ: number;
    const open = r() < LOOK.openShare, t = r(), gap = LOOK.wallGapMeters[0]! + r() * (LOOK.wallGapMeters[1]! - LOOK.wallGapMeters[0]!), turnBy = r() * Math.PI;
    if (sides.length > 0 && !open) {
      const side = pickSide(r, sides);
      cx = side.x0 + (side.x1 - side.x0) * t + side.outX * gap;
      cz = side.z0 + (side.z1 - side.z0) * t + side.outZ * gap;
      alongX = -side.outZ; alongZ = side.outX;
    } else {
      cx = chunk.minX + t * chunk.size;
      cz = chunk.minZ + r() * chunk.size;
      alongX = Math.cos(turnBy); alongZ = Math.sin(turnBy);
    }
    for (let i = 0; i < n; i++) {
      drop(chooseItem(r)(r), () => {
        const u = between(r, -1, 1) * spread, v = between(r, -1, 1) * spread / 3;
        return [cx + alongX * u - alongZ * v, cz + alongZ * u + alongX * v];
      });
    }
  }
  for (const b of boxes) {
    if (!isTree(b) || r() >= LOOK.bushByTree) continue;
    const x = (b.min[0] + b.max[0]) / 2, z = (b.min[2] + b.max[2]) / 2;
    drop(bush(r), () => {
      const a = r() * Math.PI * 2, d = between(r, 1.6, 3);
      return [x + Math.cos(a) * d, z + Math.sin(a) * d];
    });
  }
  return out;
};
