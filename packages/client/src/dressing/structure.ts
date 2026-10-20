import { box, cylinder, prism, turn, type MeshData, type V3 } from "./shapes";

// The structural parts the building builders are made of, in a builder's local frame (u along, y up, w across):
// slabs from their corners, corrugation ribs with sloped sides so the toon bands pick out each fold, rods, and
// straight members between two points for braces, rafters and rebar.
//
// A building is a few hundred of these and the dressing builds a couple of boxes a frame, so the common ones are
// stretched copies of a unit shape made once, rather than worked out face by face each time.

// A template stretched by `scale` on each axis (a negative scale mirrors it) and then moved by `offset`. Slanted faces
// keep true normals, and a mirror rewinds the triangles so they still face out.
function place(t: MeshData, scale: V3, offset: V3): MeshData {
  const n = t.positions.length;
  const positions = new Array<number>(n), normals = new Array<number>(n);
  const [sx, sy, sz] = scale, [ox, oy, oz] = offset;
  for (let i = 0; i < n; i += 3) {
    positions[i] = t.positions[i]! * sx + ox;
    positions[i + 1] = t.positions[i + 1]! * sy + oy;
    positions[i + 2] = t.positions[i + 2]! * sz + oz;
    const nx = t.normals[i]! / sx, ny = t.normals[i + 1]! / sy, nz = t.normals[i + 2]! / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[i] = nx / l; normals[i + 1] = ny / l; normals[i + 2] = nz / l;
  }
  const indices = t.indices.slice();
  if (sx * sy * sz < 0) for (let i = 0; i < indices.length; i += 3) { const k = indices[i + 1]!; indices[i + 1] = indices[i + 2]!; indices[i + 2] = k; }
  return { positions, normals, indices };
}

const UNIT_BOX = box([0.5, 0.5, 0.5], [1, 1, 1]);
// A fold: its foot 1 wide on the face (u from -0.5 to 0.5), its crest half that, standing 1 out along w, 1 tall.
const UNIT_RIB = prism([[0, -0.5], [0, 0.5], [1, 0.25], [1, -0.25]], "y", 0, 1);
const UNIT_ROD = cylinder([0, 0.5, 0], 1, 1, "y", 6);

// A box from its lower and upper corners.
export const span = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number): MeshData =>
  place(UNIT_BOX, [u1 - u0, y1 - y0, w1 - w0], [u0, y0, w0]);

// One fold of corrugated sheet standing out of a face at w = `at` towards `out`: a trapezoid `width` wide at its foot
// and half that across its crest, `depth` proud, running up from y0 to y1.
export const rib = (u: number, y0: number, y1: number, at: number, out: 1 | -1, width: number, depth: number): MeshData =>
  place(UNIT_RIB, [width, y1 - y0, out * depth], [u, y0, at]);

// The same fold lying on a roof at height `at`, running across it (along w) from w0 to w1.
export function roofRib(u: number, w0: number, w1: number, at: number, width: number, depth: number): MeshData {
  // The wall fold turned to lie down: its out (w) becomes up, its height (y) becomes the run along w.
  const lying = place(UNIT_RIB, [width, w1 - w0, depth], [0, 0, 0]);
  const out: MeshData = { positions: [], normals: [], indices: lying.indices };
  for (let i = 0; i < lying.positions.length; i += 3) {
    out.positions.push(lying.positions[i]! + u, lying.positions[i + 2]! + at, lying.positions[i + 1]! + w0);
    out.normals.push(lying.normals[i]!, lying.normals[i + 2]!, lying.normals[i + 1]!);
  }
  // Swapping y and w mirrors it; wind back the other way so it still faces out.
  for (let i = 0; i < out.indices.length; i += 3) { const k = out.indices[i + 1]!; out.indices[i + 1] = out.indices[i + 2]!; out.indices[i + 2] = k; }
  return out;
}

// A six-sided upright rod: bars, hinge pins, pipes, rebar.
export const rod = (u: number, y0: number, y1: number, w: number, radius: number): MeshData =>
  place(UNIT_ROD, [radius, y1 - y0, radius], [u, y0, w]);

// A straight member from `a` to `b`, `width` across and `depth` the other way. Its width stays level, so a brace
// leaning in a wall keeps its faces flat to the wall.
export function beam(a: V3, b: V3, width: number, depth: number): MeshData {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...d);
  const pitch = -Math.asin(d[1] / length), yaw = Math.atan2(d[0], d[2]);
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return turn(box([0, 0, 0], [width, depth, length]), [pitch, yaw, 0], [0, 0, 0], mid);
}

// Several meshes as one, sized once up front: builders join hundreds of small parts.
export function join(meshes: readonly MeshData[]): MeshData {
  let p = 0, k = 0;
  for (const m of meshes) { p += m.positions.length; k += m.indices.length; }
  const positions = new Array<number>(p), normals = new Array<number>(p), indices = new Array<number>(k);
  let at = 0, ik = 0;
  for (const m of meshes) {
    const base = at / 3;
    for (let i = 0; i < m.positions.length; i++) { positions[at + i] = m.positions[i]!; normals[at + i] = m.normals[i]!; }
    for (let i = 0; i < m.indices.length; i++) indices[ik + i] = m.indices[i]! + base;
    at += m.positions.length; ik += m.indices.length;
  }
  return { positions, normals, indices };
}
