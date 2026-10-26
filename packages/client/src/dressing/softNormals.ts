import type { MeshData, V3 } from "./shapes";

// Shading normals for soft toon shapes (V16a). The positions and windings never change, only where each corner says
// it faces, so silhouettes, collision and outlines keep their shape while the three toon bands fall as broad shapes
// instead of one flat tone per facet. Worked out once when a model is built, never per frame.

// The outward normal of the ellipsoid centred on `centre` with half-sizes `radii`, at the direction of `p` from the
// centre: the gradient of the ellipsoid's equation, which for a sphere is just the direction from its middle.
// A point at the centre itself faces straight up.
export function ellipsoidNormal(p: V3, centre: V3, radii: V3): V3 {
  const x = (p[0] - centre[0]) / (radii[0] * radii[0]);
  const y = (p[1] - centre[1]) / (radii[1] * radii[1]);
  const z = (p[2] - centre[2]) / (radii[2] * radii[2]);
  const l = Math.hypot(x, y, z);
  return l < 1e-9 ? [0, 1, 0] : [x / l, y / l, z / l];
}

// Bends every normal of `mesh` `share` of the way toward the ellipsoid round it (1: the whole mesh shades as one
// smooth blob, the classic toon tree crown). In place; returns the mesh.
export function towardEllipsoid(mesh: MeshData, centre: V3, radii: V3, share: number): MeshData {
  const { positions: p, normals: n } = mesh;
  for (let i = 0; i < p.length; i += 3) {
    const e = ellipsoidNormal([p[i]!, p[i + 1]!, p[i + 2]!], centre, radii);
    const x = n[i]! * (1 - share) + e[0] * share, y = n[i + 1]! * (1 - share) + e[1] * share, z = n[i + 2]! * (1 - share) + e[2] * share;
    const l = Math.hypot(x, y, z) || 1;
    n[i] = x / l; n[i + 1] = y / l; n[i + 2] = z / l;
  }
  return mesh;
}

// Smooths the normals across edges flatter than `maxDegrees`: each corner takes the average of the faces meeting at
// its position whose normal is within that angle of its own face, so a faceted stone shades round while a sharper
// edge (its flat underside) stays crisp. Corners closer than a millimetre are the same corner. In place.
export function smoothNormals(mesh: MeshData, maxDegrees: number): MeshData {
  const { positions: p, normals: n } = mesh;
  const count = p.length / 3;
  const face = n.slice(); // the flat normals, read while `n` is rewritten
  const cos = Math.cos((maxDegrees * Math.PI) / 180);
  const groups = new Map<string, number[]>();
  for (let v = 0; v < count; v++) {
    const key = `${Math.round(p[v * 3]! * 1000)},${Math.round(p[v * 3 + 1]! * 1000)},${Math.round(p[v * 3 + 2]! * 1000)}`;
    const g = groups.get(key);
    if (g) g.push(v);
    else groups.set(key, [v]);
  }
  for (const group of groups.values()) {
    for (const v of group) {
      let x = 0, y = 0, z = 0;
      for (const w of group) {
        const d = face[v * 3]! * face[w * 3]! + face[v * 3 + 1]! * face[w * 3 + 1]! + face[v * 3 + 2]! * face[w * 3 + 2]!;
        if (d < cos) continue;
        x += face[w * 3]!; y += face[w * 3 + 1]!; z += face[w * 3 + 2]!;
      }
      const l = Math.hypot(x, y, z) || 1;
      n[v * 3] = x / l; n[v * 3 + 1] = y / l; n[v * 3 + 2] = z / l;
    }
  }
  return mesh;
}
