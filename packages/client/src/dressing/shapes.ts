// Low-poly building blocks for model scripts (scripts/mechs/*.ts) and the junkyard dressing built in the game: bevelled boxes, cylinders, wedges and any convex
// prism, placed and turned freely, mirrored for left and right parts, and merged into one mesh per part. Faces are
// flat-shaded, which is the toon look, and always wound to face outward so outlines drawn from the inside work.
// Positions, normals and triangle indices: one mesh, ready to write to a .glb or to turn into three.js geometry.
export interface MeshData {
  positions: number[]; // x, y, z per vertex
  normals: number[];
  indices: number[]; // three per triangle
}

export type V3 = [number, number, number];
type Axis = "x" | "y" | "z";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const empty = (): MeshData => ({ positions: [], normals: [], indices: [] });

// A convex solid from its faces (each a convex polygon of points). Every face gets a flat normal pointing away from
// the solid's centre.
export function convex(faces: V3[][]): MeshData {
  const out = empty();
  const all = faces.flat();
  const centre: V3 = [0, 1, 2].map((i) => all.reduce((s, p) => s + p[i]!, 0) / all.length) as V3;
  for (const face of faces) {
    let n = norm(cross(sub(face[1]!, face[0]!), sub(face[2]!, face[0]!)));
    const mid: V3 = [0, 1, 2].map((i) => face.reduce((s, p) => s + p[i]!, 0) / face.length) as V3;
    let points = face;
    if (dot(n, sub(mid, centre)) < 0) { n = [-n[0], -n[1], -n[2]]; points = [...face].reverse(); }
    const base = out.positions.length / 3;
    for (const p of points) { out.positions.push(...p); out.normals.push(...n); }
    for (let i = 1; i < points.length - 1; i++) out.indices.push(base, base + i, base + i + 1);
  }
  return out;
}

// A convex 2D outline (u, v points, either winding) swept along an axis from `from` to `to`. The other two axes are
// u and v in order: x → (y, z), y → (z, x), z → (x, y).
export function prism(outline: [number, number][], axis: Axis, from: number, to: number): MeshData {
  const at = (u: number, v: number, w: number): V3 => (axis === "x" ? [w, u, v] : axis === "y" ? [v, w, u] : [u, v, w]);
  const bottom = outline.map(([u, v]) => at(u, v, from));
  const top = outline.map(([u, v]) => at(u, v, to));
  const sides = outline.map((_, i) => { const j = (i + 1) % outline.length; return [bottom[i]!, bottom[j]!, top[j]!, top[i]!]; });
  return convex([bottom, top, ...sides]);
}

// A box from `centre` and `size`, its edges bevelled by `bevel` metres all round (0 for a plain box).
export function box(centre: V3, size: V3, bevel = 0): MeshData {
  const [x, y, z] = centre, [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  // The front and back faces shrink in by the bevel on top of the octagon's own corners, so across x and y the bevel
  // must stay under half the half-size or the faces cross over and turn inside out.
  const b = Math.min(bevel, sx * 0.45, sy * 0.45, sz * 0.9);
  if (b <= 0) return prism([[-sx, -sy], [sx, -sy], [sx, sy], [-sx, sy]].map(([u, v]) => [u! + x, v! + y]), "z", z - sz, z + sz);
  // Bevel the edges along z by the octagon outline, then the front and back faces by shrinking them in.
  const ring = (dz: number, inset: number): V3[] => {
    const ix = sx - inset, iy = sy - inset;
    return ([[-ix + b, -iy], [ix - b, -iy], [ix, -iy + b], [ix, iy - b], [ix - b, iy], [-ix + b, iy], [-ix, iy - b], [-ix, -iy + b]] as [number, number][])
      .map(([u, v]) => [u + x, v + y, z + dz] as V3);
  };
  const back = ring(-sz, b), backMid = ring(-sz + b, 0), frontMid = ring(sz - b, 0), front = ring(sz, b);
  const band = (a: V3[], c: V3[]) => a.map((_, i) => { const j = (i + 1) % a.length; return [a[i]!, a[j]!, c[j]!, c[i]!]; });
  return convex([back, front, ...band(back, backMid), ...band(backMid, frontMid), ...band(frontMid, front)]);
}

// A cylinder (or a cone, with two radii) along an axis, `sides` flat faces round.
export function cylinder(centre: V3, radius: number, length: number, axis: Axis, sides = 8, endRadius = radius): MeshData {
  const ring = (r: number) => Array.from({ length: sides }, (_, i) => [Math.cos((i / sides) * Math.PI * 2) * r, Math.sin((i / sides) * Math.PI * 2) * r] as [number, number]);
  const [cu, cv, cw] = axis === "x" ? [centre[1], centre[2], centre[0]] : axis === "y" ? [centre[2], centre[0], centre[1]] : [centre[0], centre[1], centre[2]];
  const at = (u: number, v: number, w: number): V3 => (axis === "x" ? [w, u, v] : axis === "y" ? [v, w, u] : [u, v, w]);
  const a = ring(radius).map(([u, v]) => at(u + cu, v + cv, cw - length / 2));
  const b = ring(endRadius).map(([u, v]) => at(u + cu, v + cv, cw + length / 2));
  return convex([a, b, ...a.map((_, i) => { const j = (i + 1) % sides; return [a[i]!, a[j]!, b[j]!, b[i]!]; })]);
}

// A wedge: a box whose top is pushed back so the front slopes. `slope` is how much of the depth the top loses (0..1).
export function wedge(centre: V3, size: V3, slope: number): MeshData {
  const [x, y, z] = centre, [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const zt = -sz + size[2] * slope;
  return prism([[-sz, -sy], [sz, -sy], [sz, sy], [zt, sy]].map(([w, v]) => [v! + y, w! + z] as [number, number]), "x", x - sx, x + sx);
}

// Turns a mesh about a pivot by angles in radians (x, then y, then z), then moves it.
export function turn(mesh: MeshData, angles: V3, pivot: V3 = [0, 0, 0], move: V3 = [0, 0, 0]): MeshData {
  const [ax, ay, az] = angles;
  const rot = (p: V3): V3 => {
    let [x, y, z] = p;
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
    return [x, y, z];
  };
  const out = empty();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = rot(sub([mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!], pivot));
    out.positions.push(p[0] + pivot[0] + move[0], p[1] + pivot[1] + move[1], p[2] + pivot[2] + move[2]);
    out.normals.push(...rot([mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!]));
  }
  out.indices = [...mesh.indices];
  return out;
}

// The mirror image across x = 0, for making a left part from a right one. Windings are flipped to keep faces outward.
export function mirrorX(mesh: MeshData): MeshData {
  const out = empty();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    out.positions.push(-mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!);
    out.normals.push(-mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!);
  }
  for (let i = 0; i < mesh.indices.length; i += 3) out.indices.push(mesh.indices[i]!, mesh.indices[i + 2]!, mesh.indices[i + 1]!);
  return out;
}

// Several meshes as one.
export function merge(...meshes: MeshData[]): MeshData {
  const out = empty();
  for (const m of meshes) {
    const base = out.positions.length / 3;
    out.positions.push(...m.positions);
    out.normals.push(...m.normals);
    out.indices.push(...m.indices.map((i) => i + base));
  }
  return out;
}

export const triangles = (m: MeshData) => m.indices.length / 3;
