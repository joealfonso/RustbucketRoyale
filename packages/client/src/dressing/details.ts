import { trianglesFor } from "./budget";
import type { DressBox, DressPiece } from "./kinds";
import { box, convex, cylinder, merge, prism, turn, type MeshData, type V3 } from "./shapes";

// Small details the building builders hang on their faces, so two buildings of a kind stop looking alike. Each has a
// job you can say in a sentence (DESIGN.md): vines climb from the ground, a vent has a dark intake behind its
// louvres, a pipe runs from a source down into the ground with brackets holding it to the wall, a ladder goes from
// the ground to the top, a door has a frame, a handle and a step.
//
// All in a wall's own frame: u along the face, y up from the box floor, w out of the face (w = 0 is the face itself,
// w > 0 is in front of it). `Face` turns that frame into the builder's: which side of the box, and where the face is.

export interface Face {
  // Where w = 0 lies, in the builder's across-the-wall coordinate, and which way is out (+1 or -1).
  at: number;
  out: 1 | -1;
}

// Every corner moved by `move`, with optionally its x and z swapped (a mirror) or its z flipped (a mirror too).
// Written out rather than turned with trigonometry: builders send every piece through here.
function shift(mesh: MeshData, move: V3, swapXZ: boolean, flipZ: boolean): MeshData {
  const n = mesh.positions.length;
  const positions = new Array<number>(n), normals = new Array<number>(n);
  const p = mesh.positions, q = mesh.normals;
  for (let i = 0; i < n; i += 3) {
    const x = swapXZ ? p[i + 2]! : p[i]!, z = swapXZ ? p[i]! : flipZ ? -p[i + 2]! : p[i + 2]!;
    positions[i] = x + move[0]; positions[i + 1] = p[i + 1]! + move[1]; positions[i + 2] = z + move[2];
    normals[i] = swapXZ ? q[i + 2]! : q[i]!; normals[i + 1] = q[i + 1]!; normals[i + 2] = swapXZ ? q[i]! : flipZ ? -q[i + 2]! : q[i + 2]!;
  }
  const indices = mesh.indices.slice();
  if (swapXZ || flipZ) for (let i = 0; i < indices.length; i += 3) { const k = indices[i + 1]!; indices[i + 1] = indices[i + 2]!; indices[i + 2] = k; }
  return { positions, normals, indices };
}

// A piece built in the face frame, moved into the builder's (u, y, across) frame: across = at + out * w. Facing the
// other way is the mirror across the face, windings kept facing out.
export function onFace(mesh: MeshData, face: Face): MeshData {
  return shift(mesh, [0, 0, face.at], false, face.out < 0);
}

// A builder's local frame (u along the box, y up from its floor, across, centred on the box) into the world, the way
// the builders' own `part` helpers do it: along x a move; along z, u and across swap (a mirror, windings put right).
export function toWorld(mesh: MeshData, alongX: boolean, centre: V3): MeshData {
  return shift(mesh, centre, !alongX, false);
}

const span = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number): MeshData =>
  box([(u0 + u1) / 2, (y0 + y1) / 2, (w0 + w1) / 2], [u1 - u0, y1 - y0, w1 - w0]);

// A leaf: a flat diamond against the face with its middle raised a little, `size` long. Six triangles.
function leaf(u: number, y: number, w: number, size: number, tilt: number): MeshData {
  const h = size / 2, c = Math.cos(tilt), s = Math.sin(tilt);
  const at = (a: number, b: number, d: number): V3 => [u + a * c - b * s, y + a * s + b * c, w + d];
  const p = [at(0, -h, 0), at(h * 0.7, 0, 0), at(0, h, 0), at(-h * 0.7, 0, 0)];
  const mid = at(0, 0, 0.04);
  return convex([p, [p[0]!, p[1]!, mid], [p[1]!, p[2]!, mid], [p[2]!, p[3]!, mid], [p[3]!, p[0]!, mid]]);
}

// Vines climbing from the foot of a wall: two or three stems wandering up from the ground, leaves thick near the
// bottom and thinning out towards the top, and a clump where each one roots. `top` is how high the tallest reaches.
// Everything stays between u = lo and hi.
export function vines(r: () => number, u: number, width: number, top: number, lo: number, hi: number): { stems: MeshData; leaves: MeshData } {
  const inside = (x: number) => Math.min(hi - 0.35, Math.max(lo + 0.35, x));
  const stems: MeshData[] = [], leaves: MeshData[] = [];
  const count = 2 + Math.floor(r() * 2);
  for (let s = 0; s < count; s++) {
    const root = inside(u + (r() - 0.5) * width);
    let x = root, y = 0;
    const height = top * (0.55 + 0.45 * r());
    while (y < height - 0.2) {
      const step = Math.min(height - y, 0.5 + r() * 0.5), drift = inside(x + (r() - 0.5) * 0.5) - x;
      const length = Math.hypot(step, drift), angle = Math.atan2(-drift, step);
      stems.push(turn(prism([[0, -0.035], [0, 0.035], [0.035, 0]], "y", 0, length), [0, 0, angle], [0, 0, 0], [x, y, 0]));
      // Leaves along the step, fewer the higher it climbs.
      const many = Math.round(1.8 * (1 - y / height) + r() * 0.8);
      for (let k = 0; k < many; k++) {
        const t = r(), side = r() < 0.5 ? -1 : 1;
        leaves.push(leaf(x + drift * t + side * (0.08 + r() * 0.1), Math.max(0.22, y + step * t), 0.01, 0.16 + r() * 0.14, side * (0.4 + r() * 0.6)));
      }
      x += drift; y += step;
    }
    for (let k = 0; k < 3; k++) leaves.push(leaf(inside(root + (r() - 0.5) * 0.4), 0.2 + r() * 0.2, 0.01, 0.22 + r() * 0.12, (r() - 0.5) * 1.6));
  }
  return { stems: merge(...stems), leaves: merge(...leaves) };
}

// A louvred vent: a dark intake box sunk in the wall face, a frame round it, slats tilted down to keep rain out.
export function vent(u: number, y: number, width: number, height: number): { frame: MeshData; intake: MeshData } {
  const frame: MeshData[] = [], d = 0.06, bar = 0.06;
  const intake = span(u - width / 2, u + width / 2, y - height / 2, y + height / 2, -0.02, 0.02);
  frame.push(
    span(u - width / 2 - bar, u + width / 2 + bar, y + height / 2, y + height / 2 + bar, 0, d),
    span(u - width / 2 - bar, u + width / 2 + bar, y - height / 2 - bar, y - height / 2, 0, d),
    span(u - width / 2 - bar, u - width / 2, y - height / 2, y + height / 2, 0, d),
    span(u + width / 2, u + width / 2 + bar, y - height / 2, y + height / 2, 0, d),
  );
  const slats = Math.max(2, Math.round(height / 0.16));
  for (let i = 0; i < slats; i++) {
    const sy = y - height / 2 + (i + 0.5) * (height / slats);
    frame.push(turn(span(-width / 2, width / 2, -0.02, 0.02, -0.05, 0.05), [0.6, 0, 0], [0, 0, 0], [u, sy, 0.05]));
  }
  return { frame: merge(...frame), intake };
}

// A downpipe from a gutter at `top` to a drain grate at the foot, standing `stand` off the face, brackets every
// metre and a half bolting it on. It ends in the ground, not kicked out, so it never leaves the box.
export function downpipe(u: number, top: number, radius: number, stand: number): { pipe: MeshData; brackets: MeshData } {
  const w = stand + radius;
  const pipe = merge(
    cylinder([u, top / 2, w], radius, top, "y", 6),
    box([u, top - 0.08, w], [radius * 3, 0.16, radius * 2.6]), // the gutter outlet it drains
  );
  const brackets: MeshData[] = [box([u, 0.025, w], [radius * 4, 0.05, radius * 2.6])]; // the drain grate
  for (let y = 0.9; y < top - 0.3; y += 1.5) brackets.push(span(u - radius * 1.4, u + radius * 1.4, y - 0.05, y + 0.05, 0, w + radius * 0.6));
  return { pipe, brackets: merge(...brackets) };
}

// A fixed ladder from the ground to `top`: two rails on standoffs, rungs a boot's step apart.
export function ladder(u: number, top: number, stand: number): MeshData {
  const parts: MeshData[] = [];
  const half = 0.25, rail = 0.06;
  for (const s of [-1, 1]) {
    parts.push(span(u + s * half - rail / 2, u + s * half + rail / 2, 0, top, stand, stand + rail));
    for (let y = 0.6; y < top - 0.2; y += 1.8) parts.push(span(u + s * half - 0.04, u + s * half + 0.04, y - 0.04, y + 0.04, 0, stand));
  }
  for (let y = 0.35; y < top - 0.1; y += 0.35) parts.push(span(u - half, u + half, y - 0.025, y + 0.025, stand + 0.005, stand + rail - 0.005));
  return merge(...parts);
}

// A steel door: a frame proud of the wall, the panel set in it, a handle, and a concrete step in front.
export function door(u: number, width: number, height: number): { frame: MeshData; panel: MeshData; step: MeshData } {
  const f = 0.1, d = 0.1;
  const frame = merge(
    span(u - width / 2 - f, u - width / 2, 0, height + f, 0, d),
    span(u + width / 2, u + width / 2 + f, 0, height + f, 0, d),
    span(u - width / 2, u + width / 2, height, height + f, 0, d),
    span(u + width / 2 - 0.2, u + width / 2 - 0.1, height * 0.45, height * 0.5, d * 0.5, d), // the handle, on the panel
  );
  const panel = span(u - width / 2, u + width / 2, 0.15, height, 0, d * 0.5);
  const step = span(u - width / 2 - f, u + width / 2 + f, 0, 0.15, 0, d);
  return { frame, panel, step };
}

// A steel-framed window in a wall, built on the wall's core (w = 0) with `stand` the depth of the corrugation in front
// of it: the opening is dark inside, the frame and sill stand just proud of the folds, glazing bars cross it into four
// panes, and each pane is whole (dull glass) or broken, with a shard or two left in the frame.
export function glazedWindow(r: () => number, u: number, y: number, width: number, height: number, stand: number): { frame: MeshData; dark: MeshData; glass: MeshData } {
  const f = 0.08, d = stand + 0.03, u0 = u - width / 2, u1 = u + width / 2, y0 = y - height / 2, y1 = y + height / 2;
  const frame: MeshData[] = [
    span(u0 - f, u1 + f, y1, y1 + f, 0, d), span(u0 - f, u0, y0, y1, 0, d), span(u1, u1 + f, y0, y1, 0, d),
    span(u0 - f - 0.06, u1 + f + 0.06, y0 - 0.1, y0, 0, d + 0.02), // the sill, a little wider and prouder, to shed rain
    span(u - 0.03, u + 0.03, y0, y1, 0, stand * 0.6), span(u0, u1, y - 0.03, y + 0.03, 0, stand * 0.6), // glazing bars
  ];
  const glass: MeshData[] = [];
  const pane = stand * 0.3;
  for (const [a, b] of [[u0, u - 0.03], [u + 0.03, u1]] as const) {
    for (const [c, e] of [[y0, y - 0.03], [y + 0.03, y1]] as const) {
      if (r() < 0.35) { glass.push(span(a, b, c, e, pane, pane + 0.02)); continue; }
      // A broken pane keeps a jagged triangle of glass in one corner, or none.
      if (r() < 0.4) continue;
      const left = r() < 0.5, low = r() < 0.5, su = (b - a) * (0.4 + r() * 0.4), sy = (e - c) * (0.4 + r() * 0.4);
      const cu = left ? a : b, cy = low ? c : e;
      glass.push(prism([[cu, cy], [cu + (left ? su : -su), cy], [cu, cy + (low ? sy : -sy)]], "z", pane, pane + 0.02));
    }
  }
  return { frame: merge(...frame), dark: span(u0, u1, y0, y1, 0, 0.01), glass: merge(...glass) };
}

// A roller shutter: slats in two depths so each one reads, guide channels down both sides and the drum's box over the
// top. `open` is how far it was left up: the dark inside shows beneath it.
export function shutter(u: number, width: number, height: number, open: number, stand: number): { slats: MeshData; steel: MeshData; dark: MeshData } {
  const u0 = u - width / 2, u1 = u + width / 2, slat = 0.22;
  const slats: MeshData[] = [];
  for (let y = open, i = 0; y < height - 0.05; y += slat, i++) slats.push(span(u0, u1, y, Math.min(height, y + slat), 0, stand + (i % 2 === 0 ? 0.04 : 0.02)));
  const steel = merge(
    span(u0 - 0.14, u0, 0, height + 0.45, 0, stand + 0.08), span(u1, u1 + 0.14, 0, height + 0.45, 0, stand + 0.08),
    span(u0 - 0.14, u1 + 0.14, height, height + 0.45, 0, stand + 0.1),
  );
  return { slats: merge(...slats), steel, dark: open > 0 ? span(u0, u1, 0, open, 0, 0.01) : { positions: [], normals: [], indices: [] } };
}

// A builder's optional details, kept only while the box's triangle budget allows (the same budget builderChecks.ts
// holds every builder to, less a little), so a long wall that drew every variation still stays cheap. A group goes
// in whole or not at all.
export class Details {
  readonly pieces: DressPiece[] = [];
  private budget: number;

  // `cap` lowers the budget for a builder that wants to stay well under it.
  constructor(box: DressBox, private used: number, cap = Infinity) {
    this.budget = Math.min(cap, trianglesFor(box) * 0.95);
  }

  add(group: DressPiece[]): boolean {
    const cost = group.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
    if (this.used + cost > this.budget) return false;
    this.used += cost;
    this.pieces.push(...group);
    return true;
  }
}

// Pieces of the same paint and surface as one, so a box with many details is still a few meshes.
export function byPaint(pieces: DressPiece[]): DressPiece[] {
  const groups = new Map<string, { first: DressPiece; meshes: MeshData[] }>();
  for (const p of pieces) {
    if (p.mesh.indices.length === 0) continue;
    const key = `${p.paint}|${p.surface === undefined ? "metal" : p.surface ?? "none"}`;
    const group = groups.get(key);
    if (group) group.meshes.push(p.mesh);
    else groups.set(key, { first: p, meshes: [p.mesh] });
  }
  return [...groups.values()].map(({ first, meshes }) => {
    const piece: DressPiece = { paint: first.paint, mesh: merge(...meshes) };
    if (first.surface !== undefined) piece.surface = first.surface;
    return piece;
  });
}
