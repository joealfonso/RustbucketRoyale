import { rng } from "../dressing/kinds";
import { box, turn, type MeshData, type V3 } from "../dressing/shapes";
import { fit, lerp, painter, settle, type PropBuilder } from "./parts";

// A loot crate: plank faces between a dark frame on every edge, two yellow straps over the top, and a pale marking
// (a plus or a diamond, by seed) on the two faces the straps leave bare. Broken, it is a low ragged base with planks
// and frame bits thrown across it.

const FRAME = 0.16; // edge beam thickness
const SKIN = 0.08; // how far the core sits in from the outside
const SEAM = 0.04; // gap between planks, where the darker core shows

export const crate: PropBuilder = (size, seed) => {
  const [sx, sy, sz] = size;
  const hx = sx / 2, hz = sz / 2;
  const r = rng(seed);

  const intact = painter();
  intact.add("deepRust", box([0, (sy - SKIN) / 2, 0], [sx - 2 * SKIN, sy - SKIN, sz - 2 * SKIN]));
  intact.add("deepRust", ...frame(sx, sy, sz));

  // Planks proud of the core, under the frame. Sides run along their face, the top runs along x.
  const planks = (span: number) => Math.max(2, Math.round(span / 0.55));
  const rows = (from: number, to: number) => {
    const n = planks(to - from), each = (to - from - (n - 1) * SEAM) / n;
    return Array.from({ length: n }, (_, i) => from + each / 2 + i * (each + SEAM)).map((c) => [c, each] as const);
  };
  const out = 0.03, depth = 0.08; // planks stop 3 cm short of the frame's outer face
  for (const s of [-1, 1]) {
    for (const [y, h] of rows(FRAME, sy - FRAME)) {
      intact.add("rustOrange", box([0, y, s * (hz - out - depth / 2)], [sx - 2 * FRAME, h, depth]));
      intact.add("rustOrange", box([s * (hx - out - depth / 2), y, 0], [depth, h, sz - 2 * FRAME]));
    }
  }
  for (const [z, w] of rows(-hz + FRAME, hz - FRAME)) intact.add("rustOrange", box([0, sy - out - depth / 2, z], [sx - 2 * FRAME, depth, w]));

  // Straps over the top and down the z faces, 2 cm proud of the frame so they never share a face with it.
  const strapW = 0.16, strapT = 0.1;
  for (const x of [-sx * 0.25, sx * 0.25]) {
    for (const s of [-1, 1]) intact.add("sparkYellow", box([x, (sy + 0.02) / 2, s * (hz + 0.02 - strapT / 2)], [strapW, sy + 0.02, strapT]));
    intact.add("sparkYellow", box([x, sy + 0.02 - strapT / 2, 0], [strapW, strapT, sz + 0.04]));
  }

  // The marking on both x faces, raised 3 cm off the planks.
  const plus = r() < 0.5, mark = Math.min(sy, sz) * 0.45, markT = 0.06;
  for (const s of [-1, 1]) {
    const x = s * (hx - markT / 2);
    if (plus) {
      intact.add("warmLight", box([x, sy / 2, 0], [markT, mark, mark * 0.25]), box([x, sy / 2, 0], [markT, mark * 0.25, mark]));
    } else {
      intact.add("warmLight", turn(box([0, 0, 0], [markT, mark * 0.6, mark * 0.6]), [Math.PI / 4, 0, 0], [0, 0, 0], [x, sy / 2, 0]));
    }
  }

  return { intact: intact.pieces(), destroyed: broken(sx, sz, r) };
};

// The twelve edge beams: corner posts full height, top and bottom beams between them.
function frame(sx: number, sy: number, sz: number): MeshData[] {
  const ex = sx / 2 - FRAME / 2, ez = sz / 2 - FRAME / 2;
  const beams: MeshData[] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) beams.push(box([a * ex, sy / 2, b * ez], [FRAME, sy, FRAME]));
  for (const y of [FRAME / 2, sy - FRAME / 2]) {
    for (const s of [-1, 1]) {
      beams.push(box([0, y, s * ez], [sx - 2 * FRAME, FRAME, FRAME]));
      beams.push(box([s * ex, y, 0], [FRAME, FRAME, sz - 2 * FRAME]));
    }
  }
  return beams;
}

const MAX_BROKEN = 0.48; // under the 0.5 m a broken crate may reach

function broken(sx: number, sz: number, r: () => number) {
  const out = painter();
  // The base is pulled in from the edges so the loose planks have somewhere to land.
  const bx = sx / 2 - 0.25, bz = sz / 2 - 0.25, f = 0.14;
  out.add("rustOrange", box([0, 0.04, 0], [bx * 2 - f, 0.08, bz * 2 - f]));
  for (const s of [-1, 1]) {
    out.add("deepRust", box([0, f / 2, s * (bz - f / 2)], [bx * 2, f, f]), box([s * (bx - f / 2), f / 2, 0], [f, f, bz * 2 - 2 * f]));
  }
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const h = lerp(r, 0.18, 0.3);
    out.add("deepRust", box([a * (bx - f / 2), h / 2, b * (bz - f / 2)], [f + 0.02, h, f + 0.02]));
  }
  // Snapped wall planks: three stubs a side at ragged heights, standing on the bottom beams.
  const stubs = (along: number, place: (c: number, w: number, h: number) => MeshData) => {
    const w = (along * 2 - 2 * f) / 3;
    for (let i = 0; i < 3; i++) out.add("rustOrange", place(-along + f + w / 2 + i * w, w - 0.03, lerp(r, 0.15, 0.3)));
  };
  for (const s of [-1, 1]) {
    stubs(bx, (c, w, h) => box([c, h / 2, s * (bz - 0.05)], [w, h, 0.08]));
    stubs(bz, (c, w, h) => box([s * (bx - 0.05), h / 2, c], [0.08, h, w]));
  }

  // Loose planks, a frame beam or two and a bit of strap, thrown about and tilted a little.
  const lo: V3 = [-sx / 2, 0, -sz / 2], hi: V3 = [sx / 2, MAX_BROKEN, sz / 2];
  const loose = 4 + Math.floor(r() * 4);
  for (let i = 0; i < loose; i++) {
    const kind = i === 0 ? "sparkYellow" : i < 3 ? "deepRust" : "rustOrange";
    const piece = kind === "sparkYellow" ? box([0, 0, 0], [0.9, 0.06, 0.16])
      : kind === "deepRust" ? box([0, 0, 0], [lerp(r, 0.7, 1.1), 0.12, 0.12])
      : box([0, 0, 0], [lerp(r, 0.8, 1.4), 0.07, lerp(r, 0.22, 0.32)]);
    const x = lerp(r, -sx * 0.32, sx * 0.32), z = lerp(r, -sz * 0.32, sz * 0.32);
    const moved = turn(piece, [lerp(r, -0.12, 0.12), r() * Math.PI, lerp(r, -0.2, 0.2)], [0, 0, 0], [x, 0, z]);
    // Over the base it lies across the broken walls; off it, on the ground.
    const onBase = Math.abs(x) < bx - 0.2 && Math.abs(z) < bz - 0.2;
    out.add(kind, fit(settle(moved, onBase ? 0.15 : 0), lo, hi));
  }
  return out.pieces();
}
