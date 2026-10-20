import { triangleCount } from "./builderChecks";
import { byPaint, Details, onFace, toWorld, vines } from "./details";
import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { box, cylinder, merge, turn, wedge, type MeshData, type V3 } from "./shapes";

// A broken concrete wall: stacked block courses below a seam, then columns of blocks whose tops step up and down
// along the wall, rebar poking out of the broken columns, and rubble at the foot. The box is still the collision, so
// the air above the low columns is invisible wall; the drop is kept to about 40% of the height so it stays believable.
// The wall stands a little thinner than the box so the rubble at its foot has room to show without leaving the box.

const COURSE_HEIGHT = 1.3; // a lower course of blocks
const SEAM_HEIGHT = 0.14;
const SEAM_INSET = 0.06; // how far the seam band sits back from the wall face
const BLOCK_BEVEL = 0.05;
const REBAR_SIZE = 0.1;
const LOWEST_TOP = 0.6; // of the height, for the lowest broken column
const STEP = 0.25; // column tops snap to this, so the broken edge reads as steps
// Overgrowth, the ruin's own variety: a ruin is where the yard has been left alone longest.
const VINE_CHANCE = 0.7; // per face
const MOSS_CHANCE = 0.5; // a mat of moss on a broken column top, where rain sits
const SAPLING_CHANCE = 0.4; // one young tree rooted in a broken top

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
  const ua = alongX ? 0 : 2, ta = alongX ? 2 : 0;
  const u0 = b.min[ua], u1 = b.max[ua], t0 = b.min[ta], t1 = b.max[ta];
  const y0 = b.min[1], height = b.max[1] - b.min[1], length = u1 - u0;
  const tc = (t0 + t1) / 2, margin = Math.min(0.2, (t1 - t0) * 0.2), wall = t1 - t0 - 2 * margin;

  // A box in the wall's own frame: u along the wall, y up from the box floor, t across it.
  const centreSize = (uc: number, yc: number, t: number, su: number, sy: number, st: number): [V3, V3] => {
    const c: V3 = [0, y0 + yc, 0], s: V3 = [0, sy, 0];
    c[ua] = uc; c[ta] = t; s[ua] = su; s[ta] = st;
    return [c, s];
  };
  const block = (ua0: number, ua1: number, ya: number, yb: number, st: number, bevel = BLOCK_BEVEL) =>
    box(...centreSize((ua0 + ua1) / 2, (ya + yb) / 2, tc, ua1 - ua0, yb - ya, st), bevel);

  const concrete: MeshData[] = [], rebar: MeshData[] = [], rubble: MeshData[] = [];

  // Lower body: courses in running bond, a seam between the first two when there are two, and one on top.
  const baseTop = height * 0.5;
  const courses = Math.max(1, Math.round(baseTop / COURSE_HEIGHT));
  const innerSeam = courses >= 2;
  const courseHeight = (baseTop - (innerSeam ? SEAM_HEIGHT : 0)) / courses;
  let y = 0;
  for (let c = 0; c < courses; c++) {
    let u = u0;
    // Plain boxes, every other one a few centimetres thinner, so the joints show as outline steps for 12 triangles a block.
    split(length, 1.8, 3.2, r).forEach((len, i) => {
      concrete.push(block(u, u + len, y, y + courseHeight, wall - ((i + c) % 2) * 0.04, 0));
      u += len;
    });
    y += courseHeight;
    if (c === 0 && innerSeam) { concrete.push(block(u0, u1, y, y + SEAM_HEIGHT, wall - 2 * SEAM_INSET, 0)); y += SEAM_HEIGHT; }
  }
  concrete.push(block(u0, u1, baseTop, baseTop + SEAM_HEIGHT, wall - 2 * SEAM_INSET, 0));
  const columnBase = baseTop + SEAM_HEIGHT;

  // Upper columns with stepped broken tops. One reaches the box top and another drops to the lowest allowed.
  const widths = split(length, 0.9, 2.2, r);
  const tops = widths.map(() => Math.round((LOWEST_TOP + r() * (1 - LOWEST_TOP)) * height / STEP) * STEP);
  const tallest = Math.floor(r() * widths.length);
  tops[tallest] = height;
  if (widths.length > 1) tops[(tallest + 1 + Math.floor(r() * (widths.length - 1))) % widths.length] = Math.ceil(LOWEST_TOP * height / STEP) * STEP;
  const broken: { u: number; w: number; top: number; st: number }[] = [];
  let u = u0;
  widths.forEach((w, i) => {
    const top = Math.min(height, Math.max(columnBase + 0.5, tops[i]!));
    const st = wall - r() * 0.08; // a slightly thinner column here and there gives the broken edge some depth
    if (top - columnBase > 1.8) {
      const mid = columnBase + (top - columnBase) * (0.4 + r() * 0.2);
      concrete.push(block(u, u + w, columnBase, mid, st, 0), block(u, u + w, mid, top, st));
    } else concrete.push(block(u, u + w, columnBase, top, st));

    if (top <= height - 0.5) broken.push({ u, w, top, st });
    // Rebar stubs out of the broken columns.
    if (top <= height - 0.5 && w > 0.6) {
      for (let k = 0; k < 2; k++) {
        const ru = u + w * (0.25 + 0.5 * k) + (r() - 0.5) * w * 0.15;
        const rt = tc + (k === 0 ? -1 : 1) * wall * 0.22;
        const rise = Math.min(height - top, 0.4 + r() * 0.6);
        rebar.push(box(...centreSize(ru, top - 0.1 + (rise + 0.1) / 2, rt, REBAR_SIZE, rise + 0.1, REBAR_SIZE)));
      }
    }
    u += w;
  });

  // Rubble at the foot, on both sides, turned a little, never past the box.
  const chunks = Math.max(2, Math.round(length / 2.5) + 1);
  for (let k = 0; k < chunks; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const su = 0.4 + r() * 0.5, sy = 0.25 + r() * 0.25, st = margin + 0.15 + r() * 0.2, a = (r() - 0.5) * 0.8;
    const eu = (su / 2) * Math.abs(Math.cos(a)) + (st / 2) * Math.abs(Math.sin(a));
    const et = (su / 2) * Math.abs(Math.sin(a)) + (st / 2) * Math.abs(Math.cos(a));
    const cu = u0 + eu + r() * Math.max(0, length - 2 * eu);
    const ct = side > 0 ? t1 - et : t0 + et;
    const [c, s] = centreSize(cu, sy / 2, ct, su, sy, st);
    const shape = k % 3 === 2 ? wedge(c, s, 0.5) : box(c, s);
    rubble.push(turn(shape, [0, a, 0], c));
  }

  const paint = r() < 0.5 ? "warmLight" : "scrapSteel";
  const pieces: DressPiece[] = [
    { paint, mesh: merge(...concrete), surface: "concrete" },
    { paint: r() < 0.5 ? "rustOrange" : "deepRust", mesh: merge(...rebar) },
    { paint: "scrapSteel", mesh: merge(...rubble), surface: "concrete" },
  ];
  const base = pieces.filter((p) => p.mesh.indices.length > 0);

  // Overgrowth, added only while the triangle budget allows. The concrete stays the first piece.
  const details = new Details(b, triangleCount(base));
  const uc = (u0 + u1) / 2;
  const centre: V3 = alongX ? [uc, y0, tc] : [tc, y0, uc];
  const local = (m: MeshData) => toWorld(m, alongX, centre);
  for (const side of [-1, 1] as const) {
    if (r() >= VINE_CHANCE) continue;
    const v = vines(r, (r() - 0.5) * length * 0.7, 2, Math.min(baseTop + 1, height * 0.75), -length / 2, length / 2);
    const face = { at: side * (wall / 2 - 0.02), out: side };
    details.add([{ paint: "darkMoss", mesh: local(onFace(v.stems, face)), surface: null }, { paint: "moss", mesh: local(onFace(v.leaves, face)), surface: null }]);
  }
  for (const c of broken) {
    if (r() >= MOSS_CHANCE || c.w < 0.6) continue;
    const mw = c.w * (0.5 + r() * 0.4), mu = c.u + c.w / 2 + (r() - 0.5) * (c.w - mw);
    details.add([{ paint: "moss", mesh: box(...centreSize(mu, c.top + 0.02, tc, mw, 0.1, c.st * 0.8), 0.03), surface: null }]);
  }
  if (broken.length > 0 && r() < SAPLING_CHANCE) {
    // A young tree rooted in the rubble of a broken top: a thin trunk and two clumps of leaves, kept under the box top.
    const c = broken[Math.floor(r() * broken.length)]!;
    const room = height - c.top;
    if (room >= 0.9) {
      const su = c.u + c.w / 2, trunk = room * 0.65, crown = Math.min(0.45, wall / 2 - 0.02);
      const [tc0] = centreSize(su, c.top + trunk / 2, tc, 0, 0, 0);
      details.add([
        { paint: "#7A5A2E", mesh: cylinder(tc0, 0.06, trunk, "y", 5, 0.035), surface: "wood" },
        { paint: "darkMoss", mesh: cylinder(centreSize(su, c.top + trunk * 0.85, tc, 0, 0, 0)[0], crown, room * 0.35, "y", 6, crown * 0.5), surface: null },
        { paint: "moss", mesh: cylinder(centreSize(su, height - room * 0.12, tc, 0, 0, 0)[0], crown * 0.7, room * 0.22, "y", 6, crown * 0.3), surface: null },
      ]);
    }
  }
  return [...base, ...byPaint(details.pieces)];
};
