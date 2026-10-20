// Shading normals and edge wear for the flat-shaded, chamfered plates the mech scripts build (gate V9).
//
// Normals: flat faces on their own give each chamfer a band of its own, a thin stripe of a different toon band along
// every edge. The stylised hard-surface fix (Blender's weighted normals) keeps every big face's own flat normal and
// gives each small face next to it, within a smoothing angle, the big face's normal at the corners they share. A
// chamfer between two plates then turns smoothly from one plate's normal to the other's across its width, so the
// band edge crosses it as a clean curve and the plates stay perfectly flat.
//
// Edge wear: a narrow face (no wider than `wearWidthMeters`) that meets bigger faces only at convex edges is an edge
// of the solid (a chamfer, or the rim of a thin plate). Its corners get 1, everything else 0; the master toon material
// chips paint off where it is 1. Big faces never get any, because a value on their corners would smear across the
// whole face, and wider strips (the sides of a thick slab) neither, or chips would come off as whole patches.
//
// "Small" is measured against the faces met at each corner: a face is big there when its area is at least
// `bigShare` of the largest face meeting it within the smoothing angle. Faces are the flat polygons the scripts
// build (triangles sharing a corner index and a plane), not single triangles, so a fan of thin triangles across a
// big plate still counts as one big face.

import type { MeshData } from "../../packages/client/src/dressing/shapes";

export interface HardSurfaceLook {
  smoothAngleDegrees: number; // a small face blends toward neighbours turned less than this from it
  bigShare: number; // 0 to 1: how much of the largest neighbour's area a face needs to keep its own normal
  wearWidthMeters: number; // the widest a face can be and still count as a worn edge
}

export interface HardSurface {
  normals: number[]; // x, y, z per vertex, unit length
  wear: number[]; // one per vertex: 1 on edge faces, 0 elsewhere
}

export function parseHardSurfaceLook(raw: unknown): HardSurfaceLook {
  const l = raw as HardSurfaceLook;
  if (!(l?.smoothAngleDegrees > 0 && l.smoothAngleDegrees < 90)) throw new Error("look.json: mech.normals.smoothAngleDegrees must be between 0 and 90");
  if (!(l.bigShare > 0 && l.bigShare <= 1)) throw new Error("look.json: mech.normals.bigShare must be above 0 and at most 1");
  if (!(l.wearWidthMeters >= 0)) throw new Error("look.json: mech.normals.wearWidthMeters must be 0 or more");
  return l;
}

// Corners closer than a millimetre are the same corner, as in the client's outline normals.
const cornerKey = (p: number[], v: number) => `${Math.round(p[v * 3]! * 1000)},${Math.round(p[v * 3 + 1]! * 1000)},${Math.round(p[v * 3 + 2]! * 1000)}`;

export function hardSurface(mesh: MeshData, look: HardSurfaceLook): HardSurface {
  const { positions: p, normals: given, indices } = mesh;
  const vertices = p.length / 3, tris = indices.length / 3;
  const normals = [...given];
  const wear = new Array<number>(vertices).fill(0);

  // Each triangle's unit normal and area, from its corners (they are wound to face out).
  const tn = new Float64Array(tris * 3), ta = new Float64Array(tris);
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!];
    const u = [p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!];
    const w = [p[c * 3]! - p[a * 3]!, p[c * 3 + 1]! - p[a * 3 + 1]!, p[c * 3 + 2]! - p[a * 3 + 2]!];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!);
    ta[t] = length / 2;
    if (length > 0) for (let i = 0; i < 3; i++) tn[t * 3 + i] = n[i]! / length;
  }
  const tdot = (s: number, t: number) => tn[s * 3]! * tn[t * 3]! + tn[s * 3 + 1]! * tn[t * 3 + 1]! + tn[s * 3 + 2]! * tn[t * 3 + 2]!;

  // Faces: triangles joined where they share a corner index and lie in one plane. A vertex whose triangles do not
  // all lie in one plane is already smooth-shaded by its script, and is left as it is.
  const parent = Int32Array.from({ length: tris }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const firstTri = new Int32Array(vertices).fill(-1);
  const smooth = new Uint8Array(vertices);
  for (let t = 0; t < tris; t++) {
    if (ta[t] === 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]!;
      const first = firstTri[v]!;
      if (first < 0) { firstTri[v] = t; continue; }
      if (tdot(first, t) > 1 - 1e-6) { const a = find(first), b = find(t); if (a !== b) parent[a] = b; } else smooth[v] = 1;
    }
  }

  // Each face's area, normal (area weighted) and middle.
  const faceOf = new Int32Array(tris).fill(-1);
  const area: number[] = [], fn: number[] = [], mid: number[] = [];
  const faceIds = new Map<number, number>();
  for (let t = 0; t < tris; t++) {
    if (ta[t] === 0) continue;
    const root = find(t);
    let f = faceIds.get(root);
    if (f === undefined) { f = area.length; faceIds.set(root, f); area.push(0); fn.push(0, 0, 0); mid.push(0, 0, 0); }
    faceOf[t] = f;
    area[f]! += ta[t]!;
    for (let i = 0; i < 3; i++) {
      fn[f * 3 + i]! += tn[t * 3 + i]! * ta[t]!;
      for (let k = 0; k < 3; k++) mid[f * 3 + i]! += (p[indices[t * 3 + k]! * 3 + i]! * ta[t]!) / 3;
    }
  }
  for (let f = 0; f < area.length; f++) {
    const l = Math.hypot(fn[f * 3]!, fn[f * 3 + 1]!, fn[f * 3 + 2]!) || 1;
    for (let i = 0; i < 3; i++) { fn[f * 3 + i]! /= l; mid[f * 3 + i]! /= area[f]!; }
  }
  // Each face's width: its area over its longest span between two corners (a strip's length).
  const cornersOfFace: number[][] = area.map(() => []);
  for (let t = 0; t < tris; t++) if (faceOf[t]! >= 0) for (let k = 0; k < 3; k++) cornersOfFace[faceOf[t]!]!.push(indices[t * 3 + k]!);
  const width = cornersOfFace.map((vs, f) => {
    let span = 0;
    for (const a of vs) for (const b of vs) span = Math.max(span, Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!));
    return span > 0 ? area[f]! / span : 0;
  });
  const fdot = (a: number, b: number) => fn[a * 3]! * fn[b * 3]! + fn[a * 3 + 1]! * fn[b * 3 + 1]! + fn[a * 3 + 2]! * fn[b * 3 + 2]!;

  // Neighbours: faces that share an edge (both its corner positions). Kept per face and corner position, so a corner
  // only blends with the faces actually meeting it there, not with another solid that merely touches the point.
  const corner = new Map<string, number>();
  const cornerOf = (v: number) => { const k = cornerKey(p, v); let c = corner.get(k); if (c === undefined) corner.set(k, (c = corner.size)); return c; };
  const edgeFaces = new Map<string, Set<number>>();
  for (let t = 0; t < tris; t++) {
    if (faceOf[t]! < 0) continue;
    for (let k = 0; k < 3; k++) {
      const a = cornerOf(indices[t * 3 + k]!), b = cornerOf(indices[t * 3 + ((k + 1) % 3)]!);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      let set = edgeFaces.get(key);
      if (!set) edgeFaces.set(key, (set = new Set()));
      set.add(faceOf[t]!);
    }
  }
  const meets = new Map<string, Set<number>>(); // `${face}|${corner}` -> faces meeting it there
  const neighbours: Set<number>[] = area.map(() => new Set());
  for (const [key, faces] of edgeFaces) {
    if (faces.size < 2) continue;
    const ends = key.split("|");
    for (const f of faces) for (const g of faces) {
      if (f === g) continue;
      neighbours[f]!.add(g);
      for (const c of ends) { const k = `${f}|${c}`; let s = meets.get(k); if (!s) meets.set(k, (s = new Set())); s.add(g); }
    }
  }

  // Edge faces: smaller than every bigger neighbour they meet, and convex against each (each lies behind the other's
  // plane, so the edge between them sticks out).
  const behind = (f: number, g: number) => fn[f * 3]! * (mid[g * 3]! - mid[f * 3]!) + fn[f * 3 + 1]! * (mid[g * 3 + 1]! - mid[f * 3 + 1]!) + fn[f * 3 + 2]! * (mid[g * 3 + 2]! - mid[f * 3 + 2]!) < -1e-7;
  const isEdge = area.map((a, f) => {
    if (width[f]! > look.wearWidthMeters) return false;
    const bigger = [...neighbours[f]!].filter((g) => a < look.bigShare * area[g]!);
    return bigger.length > 0 && bigger.every((g) => behind(f, g) && behind(g, f));
  });

  const near = Math.cos((look.smoothAngleDegrees * Math.PI) / 180);
  for (let v = 0; v < vertices; v++) {
    const t = firstTri[v]!;
    if (t < 0 || smooth[v] || faceOf[t]! < 0) continue;
    const f = faceOf[t]!;
    if (isEdge[f]) wear[v] = 1;
    const around = [f, ...(meets.get(`${f}|${cornerOf(v)}`) ?? [])].filter((g) => fdot(f, g) >= near);
    const largest = Math.max(...around.map((g) => area[g]!));
    if (area[f]! >= look.bigShare * largest) continue; // a big face keeps the normal its script gave it
    const sum = [0, 0, 0];
    for (const g of around) if (area[g]! >= look.bigShare * largest) for (let i = 0; i < 3; i++) sum[i]! += fn[g * 3 + i]! * area[g]!;
    const l = Math.hypot(sum[0]!, sum[1]!, sum[2]!);
    for (let i = 0; i < 3; i++) normals[v * 3 + i] = sum[i]! / l;
  }
  return { normals, wear };
}
