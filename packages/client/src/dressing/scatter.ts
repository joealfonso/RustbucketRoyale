import type { Scatter } from "./dressing";
import { rng, type DressBox, type DressPiece } from "./kinds";
import { box, convex, cylinder, merge, turn, type MeshData, type V3 } from "./shapes";

// Loose junk and grass on open ground. Nothing here collides, so everything stays low and small enough that it never
// reads as cover. Each item is built around the origin, turned about y, dropped at a seeded spot, and kept only if its
// real footprint stays inside the chunk and clear of every box standing there; then it is set down on the hills.

const CLEARANCE = 0.5; // metres kept between an item and any box footprint, so nothing pokes out of a wall
const MAX_HEIGHT = 0.9;
const TRIES = 4; // spots tried per item before it is skipped

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

// A tuft: a few three-sided tapering blades, leaning out a little, in two greens. Eight triangles a blade.
const grass: Item = (r) => {
  const blades = 3 + Math.floor(r() * 4);
  const byPaint: Record<string, MeshData[]> = { moss: [], darkMoss: [] };
  for (let i = 0; i < blades; i++) {
    const h = between(r, 0.25, 0.6);
    const blade = cylinder([0, h / 2, 0], between(r, 0.06, 0.09), h, "y", 3, 0.02);
    const a = r() * Math.PI * 2, d = r() * 0.3;
    byPaint[r() < 0.6 ? "moss" : "darkMoss"]!.push(turn(blade, [between(r, -0.3, 0.3), r() * Math.PI * 2, between(r, -0.3, 0.3)], [0, 0, 0], [Math.cos(a) * d, 0, Math.sin(a) * d]));
  }
  // Plants carry no painted metal marks.
  return Object.entries(byPaint).filter(([, m]) => m.length > 0).map(([paint, m]) => ({ paint, mesh: ground(merge(...m)), surface: null }));
};

const tyreFlat: Item = (r) => {
  const radius = between(r, 0.35, 0.5), width = between(r, 0.2, 0.3);
  return [
    { paint: "soot", mesh: cylinder([0, width / 2, 0], radius, width, "y", 10) },
    { paint: "scrapSteel", mesh: cylinder([0, width / 2 + 0.01, 0], radius * 0.45, width + 0.02, "y", 6) },
  ];
};

// Standing on its tread and tipped well over, as if it rolled to a stop against nothing.
const tyreLeaning: Item = (r) => {
  const radius = between(r, 0.32, 0.4), width = between(r, 0.2, 0.26);
  const tyre = turn(cylinder([0, 0, 0], radius, width, "z", 10), [between(r, 0.8, 1.1), 0, 0]);
  return [{ paint: "soot", mesh: ground(tyre) }];
};

const pipe: Item = (r) => {
  const radius = between(r, 0.12, 0.25), length = between(r, 1, 2.2);
  return [{ paint: pick(r, ["rustOrange", "scrapSteel"]), mesh: cylinder([0, radius, 0], radius, length, "x", 8) }];
};

// Lying flat or propped up a little on one edge, the low edge sunk a few centimetres into the dirt.
const plate: Item = (r) => {
  const sheet = box([0, 0, 0], [between(r, 0.9, 2), between(r, 0.08, 0.1), between(r, 0.7, 1.4)], 0.03);
  const tilted = ground(turn(sheet, [r() < 0.5 ? 0 : between(r, 0.05, 0.25), 0, between(r, -0.08, 0.08)]));
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

// Weights out of 100. Most of it is grass, the junk is the seasoning, and bushes break up the open ground.
const MIX: [Item, number][] = [[grass, 50], [bush, 8], [tyreFlat, 11], [tyreLeaning, 4], [pipe, 10], [plate, 12], [drum, 5]];

// Woods get undergrowth: this share of trees (any box with a trunk-sized footprint standing taller than a mech) gets
// a bush at its foot, a little way out from the trunk.
const BUSH_BY_TREE = 0.35;
const isTree = (b: DressBox) => b.max[0] - b.min[0] <= 1.2 && b.max[2] - b.min[2] <= 1.2 && b.max[1] - b.min[1] >= 8;

function chooseItem(r: Rand): Item {
  let roll = r() * 100;
  for (const [item, weight] of MIX) if ((roll -= weight) < 0) return item;
  return grass;
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
// plate lies along the slope and a blade of grass stays upright. Items are small, so the slant this gives their
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
  const anywhere = (): [number, number] => [chunk.minX + r() * chunk.size, chunk.minZ + r() * chunk.size];
  for (let n = 0; n < count; n++) drop(chooseItem(r)(r), anywhere);
  for (const b of boxes) {
    if (!isTree(b) || r() >= BUSH_BY_TREE) continue;
    const x = (b.min[0] + b.max[0]) / 2, z = (b.min[2] + b.max[2]) / 2;
    drop(bush(r), () => {
      const a = r() * Math.PI * 2, d = between(r, 1.6, 3);
      return [x + Math.cos(a) * d, z + Math.sin(a) * d];
    });
  }
  return out;
};
