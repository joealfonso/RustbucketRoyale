import { ladder, vines } from "./details";
import type { BarrierConfig } from "./edgeLayout";
import { rng, seedOf, type DressPiece } from "./kinds";
import { box, cylinder, merge, turn, type MeshData, type V3 } from "./shapes";

// One bay of the junkyard perimeter, in its wall's frame (u along, y up, w from the outer face to the face you see).
// From the back: a solid core so nothing is see-through, columns of corrugated sheets of mixed heights on it (so the
// seams never line up into the rows of a building), steel posts and a few girders holding them, sometimes a stack of
// shipping containers against the foot, and a fence with an overhanging barbed-wire arm along the top. The fence is
// open, so the top of the wall shows sky through it. The plan holds every choice; the near model and the cheap far
// quads are both drawn from it, so they agree in colour when one swaps for the other.
//
// With `variety` (data/dressing.json, "edge") the bays stop repeating: a breach where the sheets were torn off the
// foot, a wire fence across it and the junkyard beyond in view; crushed car bales stacked where there are no
// containers; bays patched with flat plates; girders at different heights; junk leaning on the wall; vines climbing
// it. Those choices come from a second seed, so the sheets and containers of a bay stay as they were.

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
  stackTop: number; // the height of the tallest container or bale stack, 0 for none
  breach: { u0: number; u1: number; height: number } | null; // the hole at the foot, no sheets or core in it
  bales: { u: number; level: number; paint: string; shift: number }[]; // u is the bale's middle
  plates: boolean; // flat plates, no corrugation
  girderLift: number; // added to every girder's height in this bay
  leaners: { kind: string; u: number; paint: string; lean: number }[];
  vines: { u: number; top: number }[];
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
  const plan: BayPlan = {
    u0, length, height, thickness, wallTop, columns, sheets, patches, containers, stackTop,
    breach: null, bales: [], plates: false, girderLift: 0, leaners: [], vines: [],
  };
  if (c.variety) vary(c, plan, rng(seedOf(seed, 0xed6e)));
  return plan;
}

// The per-bay variety, drawn from its own seed after the plain plan is made.
function vary(c: BarrierConfig, p: BayPlan, r: () => number): void {
  const v = c.variety!;
  p.plates = r() < v.platesChance;
  p.girderLift = r() * v.girderJitterMeters;
  const gaps = postCount(c, p.length), columnWidth = p.length / p.columns;
  if (r() < v.breachChance && gaps >= 1) {
    // A whole number of post gaps, so the posts at its sides still stand. The containers were cleared out of it.
    const span = Math.min(gaps, Math.round(between(r, v.breachPanels[0]!, v.breachPanels[1]!)));
    const first = Math.floor(r() * (gaps - span + 1));
    const tall = Math.min(p.wallTop - 3, between(r, v.breachMeters[0]!, v.breachMeters[1]!));
    p.breach = { u0: p.u0 + first * 2 * columnWidth, u1: p.u0 + (first + span) * 2 * columnWidth, height: tall };
    p.containers = [];
    p.stackTop = 0;
    // Sheets cut away up to the top of the hole. One the hole splits keeps its upper part, unless that would be a
    // sliver; then it goes too and the sheet above it reaches down to the hole.
    const kept: Sheet[] = [];
    let lower = false;
    for (const sheet of p.sheets) {
      const hit = sheet.column >= first * 2 && sheet.column < (first + span) * 2;
      if (!hit || sheet.y0 >= tall) {
        kept.push(lower && hit ? { ...sheet, y0: tall } : sheet);
        lower = false;
        continue;
      }
      if (sheet.y1 <= tall) continue;
      if (sheet.y1 - tall < 0.3) { lower = true; continue; }
      kept.push({ ...sheet, y0: tall });
    }
    p.sheets = kept;
    p.patches = [];
  } else if (p.containers.length === 0 && r() < v.baleChance) {
    const b = v.bale, columns = Math.floor(p.length / (b.length + 0.15));
    const left = (p.length - columns * (b.length + 0.15)) / 2;
    for (let i = 0; i < columns; i++) {
      const levels = 1 + Math.floor(r() * b.maxStack);
      for (let level = 0; level < levels; level++) {
        p.bales.push({ u: p.u0 + left + (i + 0.5) * (b.length + 0.15), level, paint: pick(r, b.paints), shift: between(r, -0.12, 0.12) });
      }
      p.stackTop = Math.max(p.stackTop, levels * b.height);
    }
  }
  if (!p.breach && p.containers.length === 0 && p.bales.length === 0) {
    const slots = Math.floor(p.length / v.leanerSlotMeters);
    for (let i = 0; i < slots; i++) {
      if (r() >= v.leanerChance) continue;
      p.leaners.push({ kind: pick(r, v.leanerKinds), u: p.u0 + (i + 0.5) * (p.length / slots), paint: pick(r, c.panelPaints), lean: between(r, 0.15, 0.3) });
    }
  }
  // Vines only reach the wall where nothing is stacked high against it.
  if (r() < v.vineChance && p.stackTop <= c.container.height) {
    const u = p.u0 + between(r, 1.5, p.length - 1.5);
    if (!p.breach || u < p.breach.u0 - 1.5 || u > p.breach.u1 + 1.5) p.vines.push({ u, top: Math.max(p.stackTop + 1, between(r, v.vineMeters[0]!, v.vineMeters[1]!)) });
  }
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
  for (let y = c.girderEveryMeters + p.girderLift; y < p.wallTop - c.girderEveryMeters / 3; y += c.girderEveryMeters) out.push(y);
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

  // The core, solid behind every sheet; round a breach it stops at the hole's sides and top.
  const hole = p.breach;
  if (!hole) add(c.corePaint, span(u0, u1, 0, wallTop, 0, c.coreDepth));
  else {
    if (hole.u0 > u0) add(c.corePaint, span(u0, hole.u0, 0, wallTop, 0, c.coreDepth));
    if (hole.u1 < u1) add(c.corePaint, span(hole.u1, u1, 0, wallTop, 0, c.coreDepth));
    add(c.corePaint, span(hole.u0, hole.u1, hole.height, wallTop, 0, c.coreDepth));
  }

  // Sheets, with a seam all round each one so the dark core shows between them.
  for (const sheet of p.sheets) {
    const a = u0 + sheet.column * columnWidth + s, b = a + columnWidth - c.seam, y0 = sheet.y0 + s, y1 = sheet.y1 - s;
    add(sheet.paint, span(a, b, y0, y1, sheetBack, sheetFront));
    if (p.plates || sheet.y1 <= p.stackTop || sheet.y0 >= ribTop) continue;
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
  for (const b of p.bales) for (const [paint, mesh] of baleMesh(c, b.u, b.level, b.paint, b.shift, T)) add(paint, mesh);
  if (hole) breachMesh(c, p, hole, add);
  for (const l of p.leaners) leanerMesh(c, l, T, add);
  const plants: DressPiece[] = [];
  for (const v of p.vines) {
    const grown = vines(rng(Math.round(v.u * 977)), v.u, 3, v.top, u0 + 0.5, u1 - 0.5);
    const front = sheetFront + (p.plates ? 0 : c.ribDepth);
    // Plants carry no painted metal marks.
    plants.push({ paint: "darkMoss", mesh: turn(grown.stems, [0, 0, 0], [0, 0, 0], [0, 0, front]), surface: null });
    plants.push({ paint: "moss", mesh: turn(grown.leaves, [0, 0, 0], [0, 0, 0], [0, 0, front]), surface: null });
  }
  add(c.fence.paint, fence(c, p));

  return [...[...byPaint].map(([paint, meshes]) => ({ paint, mesh: merge(...meshes) })), ...plants];
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

// A crushed car: a squashed block with the creases of its folded roof and a flattened wheel on the face you see.
function baleMesh(c: BarrierConfig, u: number, level: number, paint: string, shift: number, T: number): [string, MeshData][] {
  const b = c.variety!.bale;
  const y0 = level * b.height, front = T - 0.03 + Math.min(0, shift * 0.3), back = front - b.depth;
  // Plain boxes and a six-sided wheel on every other bale: a stack of these is a few dozen bales.
  const body = box([u + shift, y0 + b.height / 2, (front + back) / 2], [b.length, b.height - 0.04, b.depth]);
  const parts = [
    span(u + shift - b.length * 0.45, u + shift + b.length * 0.45, y0 + b.height * 0.32, y0 + b.height * 0.38, front - 0.04, front + 0.01),
    span(u + shift - b.length * 0.4, u + shift + b.length * 0.3, y0 + b.height * 0.68, y0 + b.height * 0.73, front - 0.04, front + 0.01),
  ];
  if ((level + Math.round(u)) % 2 === 0) parts.push(cylinder([u + shift + b.length * 0.28, y0 + b.height * 0.5, front - 0.03], b.height * 0.22, 0.08, "z", 6));
  const creases = merge(...parts);
  return [[paint, body], [c.steelPaint, creases]];
}

// The hole where the sheets were torn off: a wire fence across its back so it still reads as the edge, torn flaps
// hanging off the sheets above, and a little junk in its mouth. Through it, the junkyard beyond the wall.
function breachMesh(c: BarrierConfig, p: BayPlan, hole: { u0: number; u1: number; height: number }, add: (paint: string, mesh: MeshData) => void): void {
  const f = c.fence, wire: MeshData[] = [];
  const w = c.coreDepth / 2, top = hole.height;
  const posts = Math.max(1, Math.round((hole.u1 - hole.u0) / f.postSpacing));
  for (let i = 0; i <= posts; i++) {
    const u = hole.u0 + c.postWidth + (i / posts) * (hole.u1 - hole.u0 - 2 * c.postWidth);
    wire.push(span(u - f.postSize / 2, u + f.postSize / 2, 0, top, w - f.postSize / 2, w + f.postSize / 2));
  }
  for (let y = 0.5; y < top - 0.2; y += 0.55) wire.push(span(hole.u0, hole.u1, y - f.strandSize / 2, y + f.strandSize / 2, w + f.postSize / 2, w + f.postSize / 2 + f.strandSize));
  add(f.paint, merge(...wire));
  // Flaps: pieces of the torn sheets still hanging from the hole's top edge, bent out towards the yard.
  const r = rng(Math.round(hole.u0 * 131 + top * 17));
  const sheetFront = c.coreDepth + c.sheetDepth;
  for (let u = hole.u0 + 0.8; u < hole.u1 - 0.8; u += between(r, 1.6, 3)) {
    const width = between(r, 0.8, 1.4), drop = between(r, 0.9, 1.8);
    const flap = box([0, -drop / 2, 0], [width, drop, c.sheetDepth]);
    add(pick(r, c.panelPaints), turn(flap, [-between(r, 0.15, 0.45), 0, between(r, -0.2, 0.2)], [0, 0, 0], [u, top, sheetFront - c.sheetDepth / 2]));
  }
  // Junk in its mouth: a crushed car on its side, a few tyres.
  const T = p.thickness, bale = c.variety!.bale;
  const lo = hole.u0 + c.postWidth + bale.length / 2 + 0.15, hi = hole.u1 - c.postWidth - 1.2 - bale.length / 2;
  if (hi > lo) for (const [paint, mesh] of baleMesh(c, between(r, lo, hi), 0, pick(r, bale.paints), between(r, -0.1, 0.1), T)) add(paint, mesh);
  for (let i = 0; i < 3; i++) add("soot", cylinder([hole.u1 - c.postWidth - 0.6 + i * 0.05, 0.13 + i * 0.26, T - 0.55], 0.42, 0.26, "y", 10));
}

// Junk dumped against the foot of the wall, all inside the wall's box: it leans back onto the sheets.
function leanerMesh(c: BarrierConfig, l: BayPlan["leaners"][number], T: number, add: (paint: string, mesh: MeshData) => void): void {
  const face = c.coreDepth + c.sheetDepth + c.ribDepth; // the front of the ribs
  if (l.kind === "sheet") {
    // A spare sheet propped up, its top resting on the wall, its ribs facing the yard.
    const tall = 3.2, width = 1.3;
    const parts = [box([0, tall / 2, 0], [width, tall, 0.06])];
    for (const du of [-0.4, 0, 0.4]) parts.push(box([du, tall / 2, 0.06], [0.14, tall - 0.1, 0.06]));
    add(l.paint, turn(merge(...parts), [-l.lean, 0, 0], [0, 0, 0], [l.u, 0, face + 0.05 + tall * Math.sin(l.lean)]));
  } else if (l.kind === "ladder") {
    const tall = 5;
    add(c.steelPaint, turn(ladder(0, tall, 0.04), [-l.lean * 0.6, 0, 0], [0, 0, 0], [l.u, 0, face + 0.1 + tall * Math.sin(l.lean * 0.6)]));
  } else if (l.kind === "girder") {
    // An I-beam: two flanges and a web, propped on its end.
    const tall = 6, beam = merge(box([0, tall / 2, -0.12], [0.36, tall, 0.04]), box([0, tall / 2, 0.12], [0.36, tall, 0.04]), box([0, tall / 2, 0], [0.04, tall, 0.24]));
    add("deepRust", turn(beam, [-l.lean * 0.5, 0.2, 0], [0, 0, 0], [l.u, 0, face + 0.2 + tall * Math.sin(l.lean * 0.5)]));
  } else if (l.kind === "tyres") {
    const count = 3 + Math.round(l.lean * 10) % 3;
    for (let i = 0; i < count; i++) add("soot", cylinder([l.u + Math.sin(i * 2.1) * 0.06, 0.13 + i * 0.26, T - 0.55 + Math.cos(i * 1.7) * 0.05], 0.44, 0.26, "y", 10));
  } else {
    // Oil drums, one knocked over.
    add("deepRust", merge(cylinder([l.u - 0.35, 0.45, T - 0.5], 0.3, 0.9, "y", 8), cylinder([l.u + 0.35, 0.45, T - 0.45], 0.3, 0.9, "y", 8)));
    add(l.paint === "deepRust" ? "sparkYellow" : "rustOrange", cylinder([l.u + 1.1, 0.3, T - 0.5], 0.3, 0.9, "x", 8));
  }
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
  const b = c.variety?.bale;
  if (b) for (const bale of p.bales) face(bale.u + bale.shift - b.length / 2, bale.u + bale.shift + b.length / 2, bale.level * b.height, (bale.level + 1) * b.height, p.thickness - 0.03, bale.paint);
  out.push({ centre: [p.u0 + p.length / 2, p.wallTop, girderFront / 2], size: [p.length, girderFront], up: true, paint: c.steelPaint });
  return out;
}
