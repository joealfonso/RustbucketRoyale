import { convex, cylinder, merge, prism, type MeshData, type V3 } from "../dressing/shapes";
import { towardEllipsoid } from "../dressing/softNormals";
import type { PineLook } from "./config";

// The toon pine, built once per shape and drawn many times (treeView.ts). In its own frame: the foot of the trunk at
// the origin, unscaled (12 m for the pine in data/props.json), unturned. Each part is one mesh with a brightness
// (`shade`); wood parts also name their paint, while crown parts take each tree's own colour from its instance, so
// one draw paints a whole wood in a handful of greens and a few dead brown ones.
// The trunk stays inside the 1 m collision box at every scale (config.ts checks); the crown is free to spread, since
// shots and mechs pass through it and only the trunk is cover.

export interface Part {
  mesh: MeshData;
  shade: number; // multiplies the colour
  paint: string | null; // null: the tree's own colour, from its instance
}

export interface PineModel {
  wood: Part[]; // trunk, drawn in its paint
  crown: Part[]; // tiers, drawn in the tree's colour
  top: number; // height of the highest point
}

// A tier of branches: a cone over a star-shaped ring that alternates full and pulled-in points, so its rim reads as
// branch tips rather than a smooth skirt. `turn` (radians) staggers the points from tier to tier.
export function tierCone(bottom: number, height: number, radius: number, sides: number, jag: number, turn: number): MeshData {
  const ring: V3[] = [];
  for (let i = 0; i < sides * 2; i++) {
    const a = turn + (i / (sides * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? radius : radius * (1 - jag);
    ring.push([Math.cos(a) * r, bottom, Math.sin(a) * r]);
  }
  const tip: V3 = [0, bottom + height, 0];
  // The underside rises a little to the trunk, so the tiers above show a dark band under each one's rim.
  const under: V3 = [0, bottom + height * 0.18, 0];
  const faces: V3[][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    faces.push([a, b, tip], [b, a, under]);
  }
  // A point inside the tier, between its underside and its slope, that every face must face away from.
  return outward(faces, bottom + height * 0.3);
}

// A tier with its normals bent toward an ellipsoid round it (look.crown.round, V16a), so under the toon bands it
// shades as one soft blob, lit on top and dark underneath, instead of a ring of hard facets. The ellipsoid's middle
// sits `centreAt` of the way up the tier and reaches the tip, so the tip faces up and the rim faces out and a little
// down. Only the shading changes: the spiky rim still makes the outline.
function roundTier(mesh: MeshData, bottom: number, height: number, radius: number, look: PineLook): MeshData {
  const { share, centreAt } = look.crown.round;
  const up = height * (1 - centreAt);
  return towardEllipsoid(mesh, [0, bottom + height * centreAt, 0], [radius, up, radius], share);
}

// Triangles wound to face away from a point on the y axis at `axisY`, for shapes that are not convex but are
// star-shaped round it, like a tier's spiky rim and hollow underside.
function outward(faces: V3[][], axisY: number): MeshData {
  const out: MeshData = { positions: [], normals: [], indices: [] };
  for (const f of faces) {
    const [a, b, c] = f as [V3, V3, V3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: V3 = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const l = Math.hypot(...n) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const away = n[0] * mid[0] + n[1] * (mid[1] - axisY) + n[2] * mid[2];
    const points = away < 0 ? [a, c, b] : [a, b, c];
    if (away < 0) n = [-n[0], -n[1], -n[2]];
    const base = out.positions.length / 3;
    for (const p of points) { out.positions.push(...p); out.normals.push(...n); }
    out.indices.push(base, base + 1, base + 2);
  }
  return out;
}

// The near model of one shape: a tapering trunk running up inside the crown, and the tiers stacked on it.
export function pineModel(look: PineLook, shape: number): PineModel {
  const { trunk, crown } = look;
  const tiers = look.shapes[shape]!.tiers;
  const top = Math.max(...tiers.map((t) => t.bottom + t.height));
  // The trunk starts below the foot, so it reaches into the slope on the downhill side, and stops well inside the
  // top tier where nothing shows it.
  const trunkTop = top * 0.8, length = trunkTop + trunk.sinkMeters;
  const stem = cylinder([0, (trunkTop - trunk.sinkMeters) / 2, 0], trunk.radius, length, "y", trunk.sides, trunk.topRadius);
  const wood: Part[] = [{ mesh: stem, shade: 1, paint: trunk.paint }];
  const parts: Part[] = tiers.map((t, i) => ({
    mesh: roundTier(tierCone(t.bottom, t.height, t.radius, crown.sides, crown.jag, (i * Math.PI) / crown.sides / 2), t.bottom, t.height, t.radius, look),
    shade: look.tierShades[i % look.tierShades.length]!,
    paint: null,
  }));
  return { wood, crown: parts, top };
}

// The far model, past `far.beyondMeters`: a dark stub of trunk and two plain cones, a few dozen triangles that keep
// the pine's outline (a dark spire with a step in it) where the full model would be a few pixels across. All one
// part in the tree's colour, the trunk darkened, so a far wood is one draw and one outline.
export function farPine(look: PineLook): Part[] {
  const tiers = look.shapes[0]!.tiers;
  const low = tiers[0]!;
  const top = Math.max(...tiers.map((t) => t.bottom + t.height));
  const mid = low.bottom + (top - low.bottom) * 0.45;
  const r = look.trunk.radius;
  // Rounded like the near tiers, so a pine does not change its shading when it switches.
  const lowHeight = (top - low.bottom) * 0.62, lowRadius = low.radius * 0.95, midRadius = low.radius * 0.66;
  const stub = prism([[-r, -r], [r, -r], [r, r], [-r, r]], "y", -look.trunk.sinkMeters, low.bottom + 0.5);
  return [
    { mesh: stub, shade: look.far.trunkShade, paint: null },
    // Three sides and no jag: a ring of six even points.
    { mesh: roundTier(tierCone(low.bottom, lowHeight, lowRadius, 3, 0, 0), low.bottom, lowHeight, lowRadius, look), shade: look.tierShades[0]!, paint: null },
    { mesh: roundTier(tierCone(mid, top - mid, midRadius, 3, 0, Math.PI / 6), mid, top - mid, midRadius, look), shade: look.tierShades[1 % look.tierShades.length]!, paint: null },
  ];
}

// What is left standing once a tree falls: a short trunk with a pale cut on top and two splinters on its rim.
export function stump(look: PineLook): Part[] {
  const { trunk, stump: s } = look;
  const h = s.heightMeters;
  const r = trunk.radius + (trunk.topRadius - trunk.radius) * (h / 8);
  const base = cylinder([0, (h - trunk.sinkMeters) / 2, 0], trunk.radius, h + trunk.sinkMeters, "y", trunk.sides, r);
  const cut = cylinder([0, h + 0.01, 0], r - 0.05, 0.04, "y", trunk.sides);
  const splinter = (angle: number, tall: number): MeshData => {
    const c = Math.cos(angle), sn = Math.sin(angle), d = r - 0.08;
    // A sliver on the rim, wide along the rim and thin across it, tapering to a ragged point.
    const along: [number, number] = [-sn, c], across: [number, number] = [c, sn];
    const at = (u: number, v: number, y: number): V3 => [c * d + along[0] * u + across[0] * v, y, sn * d + along[1] * u + across[1] * v];
    const w = 0.13, t = 0.09;
    return convex([
      [at(-w, -t, h - 0.05), at(w, -t, h - 0.05), at(w, t, h - 0.05), at(-w, t, h - 0.05)],
      [at(-w, -t, h - 0.05), at(w, -t, h - 0.05), at(0.02, 0, h + tall)],
      [at(w, -t, h - 0.05), at(w, t, h - 0.05), at(0.02, 0, h + tall)],
      [at(w, t, h - 0.05), at(-w, t, h - 0.05), at(0.02, 0, h + tall)],
      [at(-w, t, h - 0.05), at(-w, -t, h - 0.05), at(0.02, 0, h + tall)],
    ]);
  };
  return [
    { mesh: merge(base, splinter(0.4, 0.45), splinter(2.6, 0.3)), shade: 1, paint: trunk.paint },
    { mesh: cut, shade: 1, paint: s.cut },
  ];
}

// The furthest any point of the parts is from the trunk's foot, for culling.
export function reachOf(parts: Part[]): number {
  let reach = 0;
  for (const { mesh } of parts) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) reach = Math.max(reach, Math.hypot(p[i]!, p[i + 1]!, p[i + 2]!));
  }
  return reach;
}

export const triangleCount = (parts: Part[]) => parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
