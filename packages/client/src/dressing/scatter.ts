import type { Scatter } from "./dressing";
import { rng, type DressBox, type DressPiece } from "./kinds";
import { box, cylinder, merge, turn, type MeshData } from "./shapes";

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
  return Object.entries(byPaint).filter(([, m]) => m.length > 0).map(([paint, m]) => ({ paint, mesh: ground(merge(...m)) }));
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

// Weights out of 100. Most of it is grass, the junk is the seasoning.
const MIX: [Item, number][] = [[grass, 58], [tyreFlat, 11], [tyreLeaning, 4], [pipe, 10], [plate, 12], [drum, 5]];

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
  for (let n = 0; n < count; n++) {
    const pieces = chooseItem(r)(r);
    const spin = r() * Math.PI * 2;
    for (let t = 0; t < TRIES; t++) {
      const x = chunk.minX + r() * chunk.size, z = chunk.minZ + r() * chunk.size;
      const placed = pieces.map((p) => ({ paint: p.paint, mesh: turn(p.mesh, [0, spin, 0], [0, 0, 0], [x, 0, z]) }));
      if (!fits(placed, chunk.minX, chunk.minZ, chunk.size, boxes)) continue;
      const { groundAt } = chunk;
      if (groundAt) for (const p of placed) drape(p.mesh, groundAt);
      out.push(...placed);
      break;
    }
  }
  return out;
};
