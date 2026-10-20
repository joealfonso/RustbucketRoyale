import { rng, type DressPiece } from "../dressing/kinds";
import { box, convex, cylinder, merge, turn, type MeshData, type V3 } from "../dressing/shapes";
import type { BackdropConfig, BackdropItem } from "./layout";

// The distant silhouettes, built at the origin and then turned and moved into place. Big, blunt, low-poly shapes:
// they are seen from hundreds of metres, so a detail earns its place only if it changes the outline against the sky.

type Rand = () => number;
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);

export function backdropPieces(c: BackdropConfig, item: BackdropItem): DressPiece[] {
  const r = rng(item.seed);
  const pieces = item.kind === "heap" ? heap(r, item) : item.kind === "crane" ? crane(c, r, item) : item.kind === "gantry" ? gantry(c, r, item)
    : item.kind === "stack" ? stack(c, r, item) : item.kind === "rig" ? rig(c, r, item) : cooling(c, r, item);
  return pieces.map((p) => ({ paint: p.paint, mesh: turn(fitInside(p.mesh, item.radius), [0, item.yaw, 0], [0, 0, 0], [item.x, 0, item.z]) }));
}

// A ring of points round a middle at the given angles, each at its own share of `radius` and with its own rise, so
// heaps never come out round or flat-topped. Every layer of a heap shares the angles, so its sides never twist.
function lumpyRing(r: Rand, angles: number[], radius: number, y: number, rise: number, dx: number, dz: number): V3[] {
  return angles.map((a) => {
    const d = radius * between(r, 0.72, 1.05);
    return [dx + Math.cos(a) * d, y + between(r, -rise, rise), dz + Math.sin(a) * d] as V3;
  });
}

// A scrap heap: three slumped layers, each narrower and pushed off-centre, ending in a ragged ridge rather than a
// cone. A few big pieces of junk (a girder, a slab of hull) stick out of the slopes to say what the heap is made of.
function heap(r: Rand, item: BackdropItem): DressPiece[] {
  const row = item.row!;
  const sides = Math.round(between(r, row.sides[0], row.sides[1]));
  const R = item.radius, H = item.height;
  const turnBy = r() * Math.PI * 2;
  const angles = Array.from({ length: sides }, (_, i) => turnBy + ((i + between(r, -0.25, 0.25)) / sides) * Math.PI * 2);
  const levels: { y: number; radius: number; rise: number; dx: number; dz: number }[] = [
    { y: 0, radius: R, rise: 0, dx: 0, dz: 0 },
    { y: H * between(r, 0.3, 0.45), radius: R * between(r, 0.55, 0.7), rise: H * 0.05, dx: R * between(r, -0.1, 0.1), dz: R * between(r, -0.1, 0.1) },
    { y: H * between(r, 0.68, 0.78), radius: R * between(r, 0.28, 0.4), rise: H * 0.06, dx: R * between(r, -0.15, 0.15), dz: R * between(r, -0.15, 0.15) },
    { y: H * 0.93, radius: R * between(r, 0.08, 0.16), rise: H * 0.07, dx: R * between(r, -0.18, 0.18), dz: R * between(r, -0.18, 0.18) },
  ];
  const rings = levels.map((l) => lumpyRing(r, angles, l.radius, l.y, l.rise, l.dx, l.dz));
  const body: MeshData[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k]!, b = rings[k + 1]!;
    body.push(convex([a, b, ...a.map((_, i) => { const j = (i + 1) % sides; return [a[i]!, a[j]!, b[j]!, b[i]!]; })]));
  }
  const junk: MeshData[] = [];
  // A girder or two jutting out of the ridge at a slant: at this range it is the one detail that says scrap, not rock.
  const ridge = levels[2]!;
  for (let i = 0; i < 1 + Math.floor(r() * 2); i++) {
    const long = H * between(r, 0.25, 0.4), thick = Math.max(2.5, R * 0.03);
    const girder = box([0, long / 2, 0], [thick, long, thick]);
    junk.push(turn(girder, [between(r, 0.35, 0.8), r() * Math.PI * 2, 0], [0, 0, 0], [ridge.dx, ridge.y, ridge.dz]));
  }
  for (let i = 0; i < row.junkPerHeap; i++) {
    const a = r() * Math.PI * 2, d = R * between(r, 0.3, 0.55);
    const y = H * between(r, 0.15, 0.45);
    const long = R * between(r, 0.18, 0.32), thick = Math.max(2, R * 0.025);
    const piece = r() < 0.5 ? box([0, 0, 0], [long, thick, thick]) : box([0, 0, 0], [long * 0.6, thick * 0.6, long * 0.4]);
    junk.push(turn(piece, [between(r, -0.5, 0.5), a, between(r, 0.3, 0.8)], [0, 0, 0], [Math.cos(a) * d, y, Math.sin(a) * d]));
  }
  const paint = row.paints[Math.floor(r() * row.paints.length)]!;
  const junkPaint = row.paints[(row.paints.indexOf(paint) + 1) % row.paints.length]!;
  return [{ paint, mesh: merge(...body) }, ...(junk.length > 0 ? [{ paint: junkPaint, mesh: merge(...junk) }] : [])];
}

// A tower crane: a mast with a collar at each section joint, the jib reaching one way and the counter-jib with its
// weight the other, the cab where they meet and a peak above for the stays.
function crane(c: BackdropConfig, r: Rand, item: BackdropItem): DressPiece[] {
  const k = c.landmarks.crane, H = item.height, m = k.mast;
  const jib = between(r, k.jib[0], k.jib[1]), counter = jib * 0.35;
  const steel: MeshData[] = [box([0, H / 2, 0], [m, H, m])];
  for (let y = 18; y < H - 6; y += 18) steel.push(box([0, y, 0], [m * 1.25, 1.2, m * 1.25]));
  steel.push(box([-counter * 0.75, H - 3.5, 0], [counter * 0.35, 5, m * 1.1])); // counterweight
  steel.push(cylinder([0, H + m * 1.6, 0], m * 0.55, m * 3.2, "y", 4, 0.3)); // peak
  const arm: MeshData[] = [box([(jib - counter) / 2, H + m * 0.35, 0], [jib + counter, m * 0.7, m * 0.7]), box([m * 0.8, H - 1.5, 0], [m * 0.8, 3, m * 1.1])];
  return [{ paint: k.paint, mesh: merge(...steel) }, { paint: k.accent, mesh: merge(...arm) }];
}

// A portal gantry, the kind that lifts containers at a dock: two A-legs, a beam across, a trolley on the beam.
function gantry(c: BackdropConfig, r: Rand, item: BackdropItem): DressPiece[] {
  const k = c.landmarks.gantry, H = item.height, s = between(r, k.span[0], k.span[1]) / 2, leg = k.leg, depth = 14;
  const steel: MeshData[] = [];
  for (const x of [-s, s]) {
    for (const z of [-depth / 2, depth / 2]) steel.push(box([x, H / 2, z], [leg, H, leg]));
    steel.push(box([x, H * 0.45, 0], [leg * 0.7, leg * 0.7, depth])); // the brace that makes each pair an A
  }
  steel.push(box([0, H + leg / 2, 0], [s * 2 + s * 0.6, leg, depth + leg]));
  const trolley = box([between(r, -s * 0.6, s * 0.6), H + leg * 1.3, 0], [leg * 2.5, leg * 1.4, depth * 0.8]);
  return [{ paint: k.paint, mesh: merge(...steel) }, { paint: k.accent, mesh: trolley }];
}

// A smokestack: a tapered chimney with steel bands where its sections join and a lip round the top.
function stack(c: BackdropConfig, r: Rand, item: BackdropItem): DressPiece[] {
  const k = c.landmarks.stack, H = item.height, R = between(r, k.radius[0], k.radius[1]);
  const at = (y: number) => R + (R * 0.65 - R) * (y / H);
  const bands: MeshData[] = [];
  for (let i = 1; i <= k.bands; i++) { const y = H * (0.55 + (0.35 * i) / k.bands); bands.push(cylinder([0, y, 0], at(y) * 1.12, H * 0.025, "y", 10)); }
  bands.push(cylinder([0, H - 1, 0], at(H) * 1.15, 2, "y", 10));
  return [{ paint: k.paint, mesh: cylinder([0, H / 2, 0], R, H, "y", 10, R * 0.65) }, { paint: k.accent, mesh: merge(...bands) }];
}

// A cooling tower: wide at the foot, pinched at the waist, flaring a little at the top. The dark ring at the foot is
// the open air intake between its legs.
function cooling(c: BackdropConfig, r: Rand, item: BackdropItem): DressPiece[] {
  const k = c.landmarks.cooling, H = item.height, R = between(r, k.radius[0], k.radius[1]);
  const profile: [number, number][] = [[0.07, 1], [0.4, 0.78], [0.75, 0.62], [1, 0.68]];
  const shell: MeshData[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [y0, r0] = profile[i]!, [y1, r1] = profile[i + 1]!;
    shell.push(cylinder([0, H * (y0 + y1) / 2, 0], R * r0, H * (y1 - y0), "y", 14, R * r1));
  }
  return [{ paint: k.paint, mesh: merge(...shell) }, { paint: k.accent, mesh: cylinder([0, H * 0.035, 0], R * 0.98, H * 0.07, "y", 14) }];
}

// An old rig standing in the sea: four legs braced together, a deck, a derrick tapering up from it, a crane boom
// reaching out and a flare arm off the far corner. Rusting, like everything else in this world.
function rig(c: BackdropConfig, r: Rand, item: BackdropItem): DressPiece[] {
  const k = c.sea.rigs, H = item.height, deck = between(r, k.deckMeters[0], k.deckMeters[1]), leg = k.legMeters, d = deck * 0.38;
  const level = H * 0.35;
  const steel: MeshData[] = [];
  for (const [x, z] of [[-d, -d], [d, -d], [-d, d], [d, d]] as const) steel.push(cylinder([x, level / 2, z], leg / 2, level, "y", 6));
  for (const y of [level * 0.3, level * 0.65]) {
    steel.push(box([0, y, -d], [d * 2, leg * 0.4, leg * 0.4]), box([0, y, d], [d * 2, leg * 0.4, leg * 0.4]));
    steel.push(box([-d, y, 0], [leg * 0.4, leg * 0.4, d * 2]), box([d, y, 0], [leg * 0.4, leg * 0.4, d * 2]));
  }
  steel.push(box([0, level + 1.5, 0], [deck, 3, deck]), box([d * 0.4, level + 5, -d * 0.3], [deck * 0.45, 5, deck * 0.4]));
  const derrick = cylinder([-d * 0.3, level + 3 + (H - level) / 2, d * 0.3], deck * 0.14, H - level - 3, "y", 4, deck * 0.03);
  const boom = turn(box([deck * 0.45, 0, 0], [deck * 0.9, leg * 0.35, leg * 0.35]), [0, r() * Math.PI * 2, between(r, 0.25, 0.5)], [0, 0, 0], [d * 0.6, level + 8, -d * 0.6]);
  const flare = turn(box([deck * 0.35, 0, 0], [deck * 0.7, leg * 0.3, leg * 0.3]), [0, Math.PI * 0.75, 0.3], [0, 0, 0], [d, level + 3, d]);
  return [{ paint: k.paint, mesh: merge(...steel, derrick) }, { paint: k.accent, mesh: merge(boom, flare) }];
}

// Shrinks a shape across the ground (never in height) until it fits within `radius` of its middle, so a landmark
// placed close to the wall never reaches over it.
function fitInside(mesh: MeshData, radius: number): MeshData {
  let reach = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) reach = Math.max(reach, Math.hypot(mesh.positions[i]!, mesh.positions[i + 2]!));
  if (reach <= radius) return mesh;
  const s = radius / reach;
  const out: MeshData = { positions: [...mesh.positions], normals: [...mesh.normals], indices: [...mesh.indices] };
  for (let i = 0; i < out.positions.length; i += 3) {
    out.positions[i] = out.positions[i]! * s;
    out.positions[i + 2] = out.positions[i + 2]! * s;
    // Flat faces under a squash: the normal scales the other way, then is made unit length again.
    const nx = out.normals[i]! / s, ny = out.normals[i + 1]!, nz = out.normals[i + 2]! / s, l = Math.hypot(nx, ny, nz);
    out.normals[i] = nx / l; out.normals[i + 1] = ny / l; out.normals[i + 2] = nz / l;
  }
  return out;
}
