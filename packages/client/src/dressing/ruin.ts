import { triangleCount } from "./builderChecks";
import { byPaint, Details, onFace, toWorld, vines } from "./details";
import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { box, cylinder, prism, turn, wedge, type MeshData, type V3 } from "./shapes";
import { beam, join, span } from "./structure";

// What is left of a concrete-framed building: a frame of columns with a floor slab across them at the first storey,
// block infill between the columns, and above the slab the second storey broken off at stepping heights. Broken
// tops slope where they snapped, columns end in a cage of bent rebar, one window was bricked up long ago in another
// colour, and the rubble lies in heaps at the foot, deepest under the lowest break. The box is still the collision,
// so the air above the low parts is invisible wall; the drop is kept to about 40% of the height so it stays
// believable. The infill stands a little thinner than the box so the frame and the rubble have room to show.

const COURSE_HEIGHT = 1.3; // a lower course of blocks
const SLAB = 0.3; // the first floor slab, the full depth of the box
const COLUMN_WIDTH = 0.45;
const COLUMN_SPACING = 4.2;
const REBAR = 0.08;
const LOWEST_TOP = 0.6; // of the height, for the lowest broken stretch
const STEP = 0.25; // broken tops snap to this, so the broken edge reads as steps
const SLOPE = 0.35; // how far a broken top may drop across its width, at most
// Overgrowth, the ruin's own variety: a ruin is where the yard has been left alone longest.
const VINE_CHANCE = 0.7; // per face
const MOSS_CHANCE = 0.5; // a mat of moss on a broken top, where rain sits
const SAPLING_CHANCE = 0.4; // one young tree rooted in a broken top
const BRICKED_CHANCE = 0.55; // a window in the lower storey filled in with blocks of another colour

// Cuts a length into pieces between `min` and `max` long; a short leftover joins the last piece.
function split(length: number, min: number, max: number, r: () => number): number[] {
  const out: number[] = [];
  let left = length;
  while (left > 0) {
    const next = min + r() * (max - min);
    if (left - next < min * 0.6) { out.push(left); break; }
    out.push(next);
    left -= next;
  }
  return out;
}

export const ruin: KindBuilder = (b: DressBox): DressPiece[] => {
  const r = rng(b.seed);
  const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
  const length = alongX ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
  const depth = alongX ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
  const height = b.max[1] - b.min[1];
  const L = length / 2, D = depth / 2;
  const margin = Math.min(0.2, depth * 0.2), wall = depth - 2 * margin, half = wall / 2;
  const frameHalf = D - 0.02; // the frame stands proud of the infill, nearly to the box faces

  const concrete: MeshData[] = [], infill: MeshData[] = [], rebar: MeshData[] = [], rubble: MeshData[] = [];
  const block = (u0: number, u1: number, y0: number, y1: number, d: number, bevel = 0) =>
    box([(u0 + u1) / 2, (y0 + y1) / 2, 0], [u1 - u0, y1 - y0, d], bevel);

  // The frame's columns: one at each end and about every COLUMN_SPACING metres between.
  const columns = Math.max(2, Math.round(length / COLUMN_SPACING) + 1);
  const columnU = Array.from({ length: columns }, (_, i) => -L + COLUMN_WIDTH / 2 + i * ((length - COLUMN_WIDTH) / (columns - 1)));

  // The first storey: courses of blocks in running bond, the slab across them.
  const slabAt = Math.max(1.2, Math.min(height * 0.5, 3));
  const courses = Math.max(1, Math.round(slabAt / COURSE_HEIGHT));
  const courseHeight = slabAt / courses;
  for (let c = 0; c < courses; c++) {
    let u = -L;
    // Every other block a few centimetres thinner, so the joints show as outline steps for 12 triangles a block.
    split(length, 1.8, 3.2, r).forEach((len, i) => {
      concrete.push(block(u, u + len, c * courseHeight, (c + 1) * courseHeight, wall - ((i + c) % 2) * 0.04));
      u += len;
    });
  }
  concrete.push(block(-L, L, slabAt, slabAt + SLAB, 2 * frameHalf));
  const storey = slabAt + SLAB;

  // A window in the first storey, bricked up long ago: its lintel and sill still stand proud, the newer blocks sit
  // back in another colour.
  const bays = columnU.slice(1).map((u, i) => ({ a: columnU[i]! + COLUMN_WIDTH / 2, c: u - COLUMN_WIDTH / 2 }));
  if (slabAt >= 2.2 && r() < BRICKED_CHANCE) {
    const bay = bays[Math.floor(r() * bays.length)]!;
    const w = Math.min(1.4, bay.c - bay.a - 0.6);
    if (w > 0.7) {
      const u = (bay.a + bay.c) / 2 + (r() - 0.5) * (bay.c - bay.a - w - 0.6), y0 = slabAt * 0.38, y1 = slabAt - 0.35;
      concrete.push(block(u - w / 2 - 0.2, u + w / 2 + 0.2, y1, y1 + 0.22, wall + 0.12), block(u - w / 2 - 0.12, u + w / 2 + 0.12, y0 - 0.12, y0, wall + 0.16));
      for (let y = y0, k = 0; y < y1 - 0.05; y += 0.25, k++) infill.push(block(u - w / 2, u + w / 2, y, Math.min(y1, y + 0.25), wall + 0.03 - (k % 2) * 0.02));
    }
  }

  // The second storey: stretches of wall broken off at stepping heights. One reaches the box top and another drops to
  // the lowest allowed. A broken top slopes down where it snapped.
  const widths = split(length, 0.9, 2.2, r);
  const tops = widths.map(() => Math.round((LOWEST_TOP + r() * (1 - LOWEST_TOP)) * height / STEP) * STEP);
  const tallest = Math.floor(r() * widths.length);
  tops[tallest] = height;
  if (widths.length > 1) tops[(tallest + 1 + Math.floor(r() * (widths.length - 1))) % widths.length] = Math.ceil(LOWEST_TOP * height / STEP) * STEP;
  const broken: { u: number; w: number; top: number; d: number }[] = [];
  let lowest = { u: 0, top: height };
  let u = -L;
  widths.forEach((w, i) => {
    const top = Math.min(height, Math.max(storey + 0.5, tops[i]!));
    const d = wall - r() * 0.08; // a slightly thinner stretch here and there gives the broken edge some depth
    if (top >= height - 0.01) concrete.push(block(u, u + w, storey, top, d));
    else {
      // The flat part of the break, then the slope where it snapped, falling to one side.
      const drop = Math.max(0.02, Math.min(SLOPE, (top - storey - 0.3) * 0.5, w * 0.4, top - LOWEST_TOP * 0.95 * height) * (0.4 + r() * 0.6)), low = top - drop;
      concrete.push(block(u, u + w, storey, low, d));
      const fall = r() < 0.5;
      const outline: [number, number][] = fall ? [[u, low], [u + w, low], [u + w, low + 0.02], [u + w * 0.4, top], [u, top]] : [[u, low], [u + w, low], [u + w, top], [u + w * 0.6, top], [u, low + 0.02]];
      concrete.push(prism(outline, "z", -d / 2, d / 2));
      broken.push({ u, w, top: low, d });
      if (top < lowest.top) lowest = { u: u + w / 2, top };
    }
    u += w;
  });
  // The frame columns: full height where the wall still is, broken where it fell, each break a cage of rebar.
  const topAt = (at: number) => { let x = -L; for (let i = 0; i < widths.length; i++) { if (at < x + widths[i]!) return Math.min(height, Math.max(storey + 0.5, tops[i]!)); x += widths[i]!; } return height; };
  for (const cu of columnU) {
    const wallTop = topAt(cu);
    const full = wallTop >= height - 0.01;
    const top = full ? height : Math.min(height - 0.3, wallTop + 0.2 + r() * 0.5);
    concrete.push(box([cu, top / 2, 0], [COLUMN_WIDTH, top, 2 * frameHalf], full ? 0.03 : 0));
    if (full) continue;
    for (const su of [-1, 1]) for (const sw of [-1, 1]) {
      const base: V3 = [cu + su * COLUMN_WIDTH * 0.25, top - 0.1, sw * frameHalf * 0.5];
      const rise = Math.min(height - top, 0.3 + r() * 0.5);
      const kink: V3 = [base[0], top + rise * 0.6, base[2]];
      rebar.push(span(base[0] - REBAR / 2, base[0] + REBAR / 2, base[1], kink[1], base[2] - REBAR / 2, base[2] + REBAR / 2));
      // Bent over where the concrete let go, some outward, some along the wall.
      const bend: V3 = [Math.max(-L + 0.06, Math.min(L - 0.06, kink[0] + (r() - 0.5) * 0.5)), kink[1] + rise * 0.4, Math.max(-D + 0.06, Math.min(D - 0.06, kink[2] + sw * r() * 0.3))];
      rebar.push(beam(kink, bend, REBAR, REBAR));
    }
  }
  // Rebar stubs out of the broken stretches between the columns.
  for (const c of broken) {
    if (c.w < 0.6) continue;
    for (let k = 0; k < 2; k++) {
      const ru = c.u + c.w * (0.25 + 0.5 * k) + (r() - 0.5) * c.w * 0.15, rw = (k === 0 ? -1 : 1) * c.d * 0.22;
      const rise = Math.min(height - c.top, 0.3 + r() * 0.6);
      rebar.push(span(ru - REBAR / 2, ru + REBAR / 2, c.top - 0.1, c.top + rise, rw - REBAR / 2, rw + REBAR / 2));
    }
  }

  // Rubble at the foot on both sides, turned a little, never past the box, piled deepest under the lowest break.
  const chunks = Math.max(3, Math.round(length / 2) + 2);
  for (let k = 0; k < chunks; k++) {
    const side = k % 2 === 0 ? 1 : -1, heap = k < 4;
    const su = 0.35 + r() * 0.5, sy = 0.2 + r() * (heap ? 0.35 : 0.25), st = margin + 0.15 + r() * 0.2, a = (r() - 0.5) * 0.8;
    const eu = (su / 2) * Math.abs(Math.cos(a)) + (st / 2) * Math.abs(Math.sin(a));
    const et = (su / 2) * Math.abs(Math.sin(a)) + (st / 2) * Math.abs(Math.cos(a));
    const want = heap ? lowest.u + (r() - 0.5) * 2 : -L + eu + r() * Math.max(0, length - 2 * eu);
    const cu = Math.max(-L + eu, Math.min(L - eu, want));
    const ct = side > 0 ? D - et : -D + et;
    const y = heap && k >= 2 ? 0.18 : 0; // the heap is two layers deep
    const c: V3 = [cu, y + sy / 2, ct], s: V3 = [su, sy, st];
    const shape = k % 3 === 2 ? wedge(c, s, 0.5) : box(c, s);
    rubble.push(turn(shape, [0, a, 0], c));
  }

  const paint = r() < 0.5 ? "warmLight" : "scrapSteel";
  const local = (m: MeshData) => toWorld(m, alongX, [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]);
  const pieces: DressPiece[] = [
    { paint, mesh: local(join(concrete)), surface: "concrete" },
    { paint: r() < 0.5 ? "rustOrange" : "deepRust", mesh: local(join(rebar)) },
    { paint: "scrapSteel", mesh: local(join(rubble)), surface: "concrete" },
    { paint: paint === "warmLight" ? "scrapSteel" : "warmLight", mesh: local(join(infill)), surface: "concrete" },
  ];
  const base = pieces.filter((p) => p.mesh.indices.length > 0);

  // Overgrowth, added only while the triangle budget allows. The concrete stays the first piece.
  const details = new Details(b, triangleCount(base));
  for (const side of [-1, 1] as const) {
    if (r() >= VINE_CHANCE) continue;
    const v = vines(r, (r() - 0.5) * length * 0.7, 2, Math.min(storey + 1, height * 0.75), -L, L);
    const face = { at: side * (half - 0.02), out: side };
    details.add([{ paint: "darkMoss", mesh: local(onFace(v.stems, face)), surface: null }, { paint: "moss", mesh: local(onFace(v.leaves, face)), surface: null }]);
  }
  for (const c of broken) {
    if (r() >= MOSS_CHANCE || c.w < 0.6) continue;
    const mw = c.w * (0.5 + r() * 0.4), mu = c.u + c.w / 2 + (r() - 0.5) * (c.w - mw);
    details.add([{ paint: "moss", mesh: local(box([mu, c.top + 0.02, 0], [mw, 0.1, c.d * 0.8], 0.03)), surface: null }]);
  }
  if (broken.length > 0 && r() < SAPLING_CHANCE) {
    // A young tree rooted in the rubble of a broken top: a thin trunk and two clumps of leaves, kept under the box top.
    const c = broken[Math.floor(r() * broken.length)]!;
    const room = height - c.top;
    if (room >= 0.9) {
      const su = c.u + c.w / 2, trunk = room * 0.65, crown = Math.min(0.45, half - 0.02);
      details.add([
        { paint: "#7A5A2E", mesh: local(cylinder([su, c.top + trunk / 2, 0], 0.06, trunk, "y", 5, 0.035)), surface: "wood" },
        { paint: "darkMoss", mesh: local(cylinder([su, c.top + trunk * 0.85, 0], crown, room * 0.35, "y", 6, crown * 0.5)), surface: null },
        { paint: "moss", mesh: local(cylinder([su, height - room * 0.12, 0], crown * 0.7, room * 0.22, "y", 6, crown * 0.3)), surface: null },
      ]);
    }
  }
  return [...base, ...byPaint(details.pieces)];
};
