import dressingJson from "../../../../data/dressing.json";
import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { convex, merge, turn, type MeshData, type V3 } from "./shapes";
import { smoothNormals, towardEllipsoid } from "./softNormals";

// A rock box: one chunky faceted boulder, or a cluster of two or three, filling the box. Each boulder is a stack of
// jittered octagon rings (widest near the middle, narrowing to a domed top), so it reads as hewn stone in the toon
// look. Rings only ever move inward from the footprint, so nothing leaves the box.

// Rings from the ground up: height as a share of the boulder's height, and how far each ring reaches out
// (min..max share of the footprint). The top ring is small so the boulder domes rather than ending in a flat lid.
const rings: { y: [number, number]; reach: [number, number] }[] = [
  { y: [0, 0], reach: [0.9, 0.97] },
  { y: [0.38, 0.5], reach: [0.95, 1] },
  { y: [0.72, 0.82], reach: [0.78, 0.9] },
  { y: [0.9, 0.97], reach: [0.42, 0.58] },
];

const lerp = (r: () => number, [a, b]: [number, number]) => a + (b - a) * r();

// How stone shades (data/dressing.json "stone", V16a): its normals smoothed across edges flatter than `smoothDegrees`,
// then bent `round` of the way toward an ellipsoid round the boulder whose middle sits `centreAt` of its height up.
// The three toon bands then fall as a lit top, a mid flank and a dark foot instead of one flat tone per facet, and
// the moss (mossEdge.ts) follows the same rounded form. Near stones, far stones (farBoulders.ts) and the rocks all
// come from `boulder` below, so they always shade alike.
export interface StoneLook {
  smoothDegrees: number;
  round: number;
  centreAt: number;
}

export function parseStone(raw: unknown): StoneLook {
  const s = raw as StoneLook;
  if (!(s && s.smoothDegrees > 0 && s.smoothDegrees < 90 && s.round >= 0 && s.round <= 1 && s.centreAt > 0 && s.centreAt < 1)) {
    throw new Error("dressing.json: stone needs smoothDegrees between 0 and 90, round 0 to 1 and centreAt between 0 and 1");
  }
  return s;
}

const STONE = parseStone(dressingJson.stone);

// One boulder over the footprint x0..x1 by z0..z1, standing on y = 0, h tall. Also the stone of boulder.ts.
export function boulder(r: () => number, x0: number, x1: number, z0: number, z1: number, h: number, look: StoneLook = STONE): MeshData {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ax = (x1 - x0) / 2, az = (z1 - z0) / 2;
  const c = Math.min(ax, az) * lerp(r, [0.3, 0.45]); // the corner chamfer that makes the footprint an octagon
  const octagon: [number, number][] = [[-ax + c, -az], [ax - c, -az], [ax, -az + c], [ax, az - c], [ax - c, az], [-ax + c, az], [-ax, az - c], [-ax, -az + c]];
  // A small seeded lean of the upper rings, kept well inside because those rings are already pulled in.
  const leanX = ax * lerp(r, [-0.1, 0.1]), leanZ = az * lerp(r, [-0.1, 0.1]);
  const levels: V3[][] = rings.map((ring, level) => {
    const y = h * lerp(r, ring.y);
    // The widest ring does not lean, or it would poke out of the box.
    const lean = Math.max(0, (level - 1) / (rings.length - 2));
    return octagon.map(([u, v]) => {
      const s = lerp(r, ring.reach);
      return [cx + u * s + leanX * lean, y * (level === 0 ? 1 : 1 - 0.06 * r()), cz + v * s + leanZ * lean] as V3;
    });
  });
  const faces: V3[][] = [levels[0]!];
  for (let l = 0; l < levels.length - 1; l++) {
    const a = levels[l]!, b = levels[l + 1]!;
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      // Two triangles per side, since jittered quads are not flat.
      faces.push([a[i]!, a[j]!, b[j]!], [a[i]!, b[j]!, b[i]!]);
    }
  }
  const top = levels[levels.length - 1]!;
  const peak: V3 = [cx + leanX, h, cz + leanZ];
  for (let i = 0; i < top.length; i++) faces.push([top[i]!, top[(i + 1) % top.length]!, peak]);
  const stone = smoothNormals(convex(faces), look.smoothDegrees);
  return towardEllipsoid(stone, [cx, h * look.centreAt, cz], [ax, h * (1 - look.centreAt), az], look.round);
}

export const rock: KindBuilder = (box: DressBox): DressPiece[] => {
  const r = rng(box.seed);
  const sx = box.max[0] - box.min[0], sz = box.max[2] - box.min[2], h = box.max[1] - box.min[1];
  // Built in a frame with the long side along x, then turned to match the box.
  const hx = Math.max(sx, sz) / 2, hz = Math.min(sx, sz) / 2;
  const flip = r() < 0.5 ? -1 : 1; // mirror the cluster layout end to end
  const fx = (a: number, b: number): [number, number] => (flip > 0 ? [a, b] : [-b, -a]);

  const light = r() < 0.5 ? "scrapSteel" : "warmLight";
  const dark = light === "scrapSteel" ? "soot" : r() < 0.5 ? "scrapSteel" : "soot";
  const main: MeshData[] = [], second: MeshData[] = [];

  const long = hx / hz >= 1.6;
  const pick = r();
  const layout = long ? (pick < 0.6 ? "pair" : "trio") : pick < 0.5 ? "single" : "trio";
  if (layout === "single") {
    main.push(boulder(r, -hx, hx, -hz, hz, h));
  } else if (layout === "pair") {
    // Two boulders overlapping in the middle so there is no gap between them; one stands a little lower.
    const split = hx * lerp(r, [-0.15, 0.15]);
    const lowFirst = r() < 0.5;
    main.push(boulder(r, ...fx(-hx, split + hx * 0.3), -hz, hz, lowFirst ? h * lerp(r, [0.85, 0.95]) : h));
    second.push(boulder(r, ...fx(split - hx * 0.3, hx), -hz, hz, lowFirst ? h : h * lerp(r, [0.85, 0.95])));
  } else {
    // A big boulder over most of the box, with two smaller ones tucked against the far end.
    main.push(boulder(r, ...fx(-hx, hx * lerp(r, [0.6, 0.75])), -hz, hz, h));
    second.push(boulder(r, ...fx(hx * 0.15, hx), -hz, hz * 0.15, h * lerp(r, [0.6, 0.78])));
    second.push(boulder(r, ...fx(hx * 0.3, hx), -hz * 0.1, hz, h * lerp(r, [0.45, 0.65])));
  }

  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  const angles: V3 = sx >= sz ? [0, 0, 0] : [0, Math.PI / 2, 0];
  const place = (m: MeshData) => turn(m, angles, [0, 0, 0], [cx, box.min[1], cz]);
  // Stone wears none of the painted marks (paint/): plates and rivets on a rock read as metal.
  const pieces: DressPiece[] = [{ paint: light, surface: null, mesh: place(merge(...main)) }];
  if (second.length > 0) pieces.push({ paint: dark, surface: null, mesh: place(merge(...second)) });
  return pieces;
};
