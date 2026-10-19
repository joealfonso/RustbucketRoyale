import type { BarrierConfig } from "./edgeLayout";
import { rng, type DressPiece } from "./kinds";
import { box, merge, turn, type MeshData, type V3 } from "./shapes";

// One bay of the junkyard perimeter, in its wall's frame (u along, y up, w from the outer face to the face you see).
// From the back: a solid core so nothing is see-through, columns of corrugated sheets of mixed heights on it (so the
// seams never line up into the rows of a building), steel posts and a few girders holding them, sometimes a stack of
// shipping containers against the foot, and a fence with an overhanging barbed-wire arm along the top. The fence is
// open, so the top of the wall shows sky through it. The plan holds every choice; the near model and the cheap far
// quads are both drawn from it, so they agree in colour when one swaps for the other.

export interface Sheet { column: number; y0: number; y1: number; paint: string }
export interface Patch { sheet: number; u: number; y: number; width: number; height: number; tilt: number; paint: string } // u, y: middle, as shares of the sheet

export interface BayPlan {
  u0: number; // where the bay starts along its run
  length: number;
  height: number;
  thickness: number;
  wallTop: number; // where the sheets stop and the fence starts
  columns: number;
  sheets: Sheet[];
  patches: Patch[];
  containers: { u: number; level: number; paint: string }[]; // u is the container's middle
  stackTop: number; // the height of the tallest container stack, 0 for none
}

// A flat rectangle facing into the map (`up` false) or facing the sky (`up` true), in the run's frame. The far
// version is only these: from 150 m away the sides of a post or a rib are a pixel at most.
export interface FarQuad {
  centre: V3;
  size: [number, number]; // along u, then along y (or along w when facing up)
  up: boolean;
  paint: string;
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);

// Two columns of sheets between each pair of posts.
const postCount = (c: BarrierConfig, length: number) => Math.max(1, Math.round(length / c.panelMeters));

export function planBay(c: BarrierConfig, seed: number, u0: number, length: number, height: number, thickness: number): BayPlan {
  const r = rng(seed);
  const wallTop = Math.max(c.sheetMeters[1], height - c.fence.height);
  const columns = postCount(c, length) * 2;
  const sheets: Sheet[] = [];
  for (let column = 0; column < columns; column++) {
    // Each column has its usual paint; now and then a sheet was replaced with whatever was to hand.
    const usual = pick(r, c.panelPaints);
    for (let y = 0; y < wallTop;) {
      let top = y + between(r, c.sheetMeters[0], c.sheetMeters[1]);
      if (wallTop - top < c.sheetMeters[0]) top = wallTop; // never leave a sliver at the top
      sheets.push({ column, y0: y, y1: top, paint: r() < c.columnRepaintChance ? pick(r, c.panelPaints) : usual });
      y = top;
    }
  }
  const patches: Patch[] = [];
  sheets.forEach((_, sheet) => {
    if (r() >= c.patchChance) return;
    const width = between(r, 0.45, 0.8), h = between(r, 0.3, 0.6);
    patches.push({ sheet, u: between(r, width / 2, 1 - width / 2), y: between(r, h / 2, 1 - h / 2), width, height: h, tilt: between(r, -0.12, 0.12), paint: pick(r, c.patchPaints) });
  });

  // Containers, laid end to end along the foot: either columns of their own heights, or rows with one more straddling
  // each join on top, the way a crane stacks them to lock a row together.
  const k = c.container;
  const slots = Math.floor(length / k.length);
  const containers: BayPlan["containers"] = [];
  let stackTop = 0;
  if (slots > 0 && r() < k.stackChance) {
    const left = (length - slots * k.length) / 2;
    const middle = (i: number) => u0 + left + (i + 0.5) * k.length;
    if (slots > 1 && k.maxStack > 1 && r() < k.offsetChance) {
      const base = 1 + Math.floor(r() * (k.maxStack - 1));
      for (let i = 0; i < slots; i++) for (let level = 0; level < base; level++) containers.push({ u: middle(i), level, paint: pick(r, k.paints) });
      for (let i = 0; i < slots - 1; i++) containers.push({ u: (middle(i) + middle(i + 1)) / 2, level: base, paint: pick(r, k.paints) });
      stackTop = (base + 1) * k.height;
    } else {
      for (let i = 0; i < slots; i++) {
        const levels = 1 + Math.floor(r() * k.maxStack);
        for (let level = 0; level < levels; level++) containers.push({ u: middle(i), level, paint: pick(r, k.paints) });
        stackTop = Math.max(stackTop, levels * k.height);
      }
    }
  }
  return { u0, length, height, thickness, wallTop, columns, sheets, patches, containers, stackTop };
}

// A box from its lower and upper corners in the run's frame.
const span = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number): MeshData =>
  box([(u0 + u1) / 2, (y0 + y1) / 2, (w0 + w1) / 2], [u1 - u0, y1 - y0, w1 - w0]);

// Post positions along the bay: one at its start (kept inside it) and one at each span boundary after.
function postsAlong(c: BarrierConfig, p: BayPlan): number[] {
  const n = postCount(c, p.length), gap = p.length / n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? p.u0 + c.postWidth / 2 : p.u0 + i * gap));
}

function girdersUp(c: BarrierConfig, p: BayPlan): number[] {
  const out: number[] = [];
  for (let y = c.girderEveryMeters; y < p.wallTop - c.girderEveryMeters / 3; y += c.girderEveryMeters) out.push(y);
  out.push(p.wallTop - c.girderHeight / 2); // the cap
  return out;
}

export function nearBay(c: BarrierConfig, p: BayPlan): DressPiece[] {
  const byPaint = new Map<string, MeshData[]>();
  const add = (paint: string, mesh: MeshData) => {
    const list = byPaint.get(paint);
    if (list) list.push(mesh);
    else byPaint.set(paint, [mesh]);
  };
  const { u0, length, thickness: T, wallTop } = p;
  const u1 = u0 + length;
  const sheetBack = c.coreDepth, sheetFront = c.coreDepth + c.sheetDepth;
  const columnWidth = length / p.columns, s = c.seam / 2;
  const ribTop = p.stackTop + c.ribBandMeters;

  add(c.corePaint, span(u0, u1, 0, wallTop, 0, c.coreDepth));

  // Sheets, with a seam all round each one so the dark core shows between them.
  for (const sheet of p.sheets) {
    const a = u0 + sheet.column * columnWidth + s, b = a + columnWidth - c.seam, y0 = sheet.y0 + s, y1 = sheet.y1 - s;
    add(sheet.paint, span(a, b, y0, y1, sheetBack, sheetFront));
    if (sheet.y1 <= p.stackTop || sheet.y0 >= ribTop) continue;
    const ribs = Math.max(1, Math.floor((b - a) / c.ribSpacing));
    for (let k = 0; k < ribs; k++) {
      const m = a + (k + 0.5) * ((b - a) / ribs);
      add(sheet.paint, span(m - c.ribWidth / 2, m + c.ribWidth / 2, y0, y1, sheetFront, sheetFront + c.ribDepth));
    }
  }
  // A patch is a plate bolted crooked over a rotten bit of sheet, standing proud of it and of its ribs.
  for (const patch of p.patches) {
    const sheet = p.sheets[patch.sheet]!;
    const a = u0 + sheet.column * columnWidth, h = sheet.y1 - sheet.y0;
    const width = patch.width * columnWidth, tall = patch.height * h;
    // Turned, the plate's corners swing out; keep them on the sheet so none pokes past the wall's end or foot.
    const swingU = width / 2 + Math.abs(Math.sin(patch.tilt)) * tall / 2, swingY = tall / 2 + Math.abs(Math.sin(patch.tilt)) * width / 2;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const centre: V3 = [
      clamp(a + patch.u * columnWidth, a + swingU, a + columnWidth - swingU),
      clamp(sheet.y0 + patch.y * h, sheet.y0 + swingY, sheet.y1 - swingY),
      sheetFront + c.ribDepth + c.patchDepth / 2,
    ];
    const plate = box([0, 0, 0], [width, tall, c.patchDepth]);
    add(patch.paint, turn(plate, [0, 0, patch.tilt], [0, 0, 0], centre));
  }

  // Posts hold the sheets up; girders tie the posts together and cap the top.
  for (const u of postsAlong(c, p)) add(c.steelPaint, span(u - c.postWidth / 2, u + c.postWidth / 2, 0, wallTop, sheetBack, sheetBack + c.postDepth));
  for (const y of girdersUp(c, p)) add(c.steelPaint, span(u0, u1, y - c.girderHeight / 2, y + c.girderHeight / 2, sheetFront, sheetFront + c.girderDepth));

  for (const k of p.containers) for (const [paint, mesh] of containerMesh(c, k.u, k.level, k.paint, T)) add(paint, mesh);
  add(c.fence.paint, fence(c, p));

  return [...byPaint].map(([paint, meshes]) => ({ paint, mesh: merge(...meshes) }));
}

// A container seen from its long side: ribs on the face you see, a frame round it, corner posts at the ends.
function containerMesh(c: BarrierConfig, u: number, level: number, paint: string, T: number): [string, MeshData][] {
  const k = c.container;
  const front = T - 0.02, back = front - k.depth;
  const a = u - k.length / 2, b = u + k.length / 2, y0 = level * k.height, y1 = y0 + k.height;
  const body = [span(a, b, y0, y1, back, front - k.ribDepth)];
  const run = k.length - 2 * k.frame;
  const ribs = Math.max(2, Math.floor(run / k.ribSpacing));
  for (let i = 0; i < ribs; i++) {
    const m = a + k.frame + (i + 0.5) * (run / ribs);
    body.push(span(m - 0.06, m + 0.06, y0 + k.frame, y1 - k.frame, front - k.ribDepth, front));
  }
  const frame = [
    span(a, a + k.frame, y0, y1, back, front), span(b - k.frame, b, y0, y1, back, front),
    span(a + k.frame, b - k.frame, y0, y0 + k.frame, front - k.ribDepth, front), span(a + k.frame, b - k.frame, y1 - k.frame, y1, front - k.ribDepth, front),
  ];
  return [[paint, merge(...body)], [c.steelPaint, merge(...frame)]];
}

// Fence posts on the cap, wire strands between them, and an arm on each post leaning in over the yard with two more
// strands, the way a scrapyard fence keeps people from climbing out.
function fence(c: BarrierConfig, p: BayPlan): MeshData {
  const f = c.fence;
  const meshes: MeshData[] = [];
  const mid = p.thickness / 2, top = p.height;
  const posts = Math.max(1, Math.round(p.length / f.postSpacing));
  const lean = Math.PI / 4, armRise = Math.cos(lean) * f.armLength, armReach = Math.sin(lean) * f.armLength;
  const armBase = top - armRise - f.strandSize;
  for (let i = 0; i < posts; i++) {
    const u = p.u0 + (i + 0.5) * (p.length / posts);
    meshes.push(span(u - f.postSize / 2, u + f.postSize / 2, p.wallTop, armBase + f.strandSize, mid - f.postSize / 2, mid + f.postSize / 2));
    const arm = box([0, 0, 0], [f.strandSize, f.armLength, f.strandSize]);
    meshes.push(turn(arm, [lean, 0, 0], [0, 0, 0], [u, armBase + armRise / 2, mid + armReach / 2]));
  }
  const strand = (y: number, w: number) => span(p.u0, p.u0 + p.length, y - f.strandSize / 2, y + f.strandSize / 2, w - f.strandSize / 2, w + f.strandSize / 2);
  const front = mid + f.postSize / 2 + f.strandSize / 2;
  for (let i = 1; i <= f.strands; i++) meshes.push(strand(p.wallTop + (i * (armBase - p.wallTop)) / (f.strands + 1), front));
  for (const t of [0.5, 0.95]) meshes.push(strand(armBase + armRise * t, mid + armReach * t));
  return merge(...meshes);
}

// The far version: the front of every sheet (a column's neighbouring sheets of one paint joined), posts, girders and
// containers, and a lid over the top for the view from above. The seams, ribs, patches and fence only matter close.
export function farBay(c: BarrierConfig, p: BayPlan): FarQuad[] {
  const out: FarQuad[] = [];
  const face = (u0: number, u1: number, y0: number, y1: number, w: number, paint: string) =>
    out.push({ centre: [(u0 + u1) / 2, (y0 + y1) / 2, w], size: [u1 - u0, y1 - y0], up: false, paint });
  const columnWidth = p.length / p.columns, sheetFront = c.coreDepth + c.sheetDepth;
  for (let i = 0; i < p.sheets.length;) {
    const first = p.sheets[i]!;
    let last = i;
    while (last + 1 < p.sheets.length && p.sheets[last + 1]!.column === first.column && p.sheets[last + 1]!.paint === first.paint) last++;
    const a = p.u0 + first.column * columnWidth;
    face(a, a + columnWidth, first.y0, p.sheets[last]!.y1, sheetFront, first.paint);
    i = last + 1;
  }
  const postFront = c.coreDepth + c.postDepth, girderFront = sheetFront + c.girderDepth;
  for (const u of postsAlong(c, p)) face(u - c.postWidth / 2, u + c.postWidth / 2, 0, p.wallTop, postFront, c.steelPaint);
  for (const y of girdersUp(c, p)) face(p.u0, p.u0 + p.length, y - c.girderHeight / 2, y + c.girderHeight / 2, girderFront, c.steelPaint);
  const k = c.container, front = p.thickness - 0.02;
  for (const box of p.containers) face(box.u - k.length / 2, box.u + k.length / 2, box.level * k.height, (box.level + 1) * k.height, front, box.paint);
  out.push({ centre: [p.u0 + p.length / 2, p.wallTop, girderFront / 2], size: [p.length, girderFront], up: true, paint: c.steelPaint });
  return out;
}
