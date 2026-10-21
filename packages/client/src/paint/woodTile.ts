import type { PaintLook } from "./paintLook";
import { GRIME, RUST, RUST_DARK, SHADE, between, blankSurface, chip, pick, rustStreak, type Random } from "./marks";
import type { Tile } from "./raster";

// Planks: level boards of uneven widths, each a shade of its own with long wavy grain strokes and a knot or two,
// ending on upright studs, nailed either side of each stud. Wear has a reason: dirt lodges in the gaps, nails rust and
// bleed short streaks, and edges splinter (chips show the raw wood). One newer board is nailed upright across a few
// planks, a repair.
// The studs' joints run the whole height and the gap under the first plank the whole width, and nothing crosses
// them, so the shader can start a tile cell on any stud (paintAtlas.ts cellSteps) and cells meet at a joint.

const GAP = 0.14, JOINT = 0.16, NAIL_RIM = 0.22, NAIL_HEAD = 0.38, NAIL_GLINT = 0.52;
// How far grain and knots keep from a board's ends.
const END = 0.012;

export function paintWood(tile: Tile, look: PaintLook["wood"], random: Random, wear: Uint8Array): void {
  blankSurface(tile, wear);
  const widths = Array.from({ length: look.planks }, () => between(random, 0.7, 1.3));
  const total = widths.reduce((a, b) => a + b, 0);
  const planks: { y0: number; y1: number }[] = [];
  let y = 0;
  for (const w of widths) {
    planks.push({ y0: y, y1: y + w / total });
    y += w / total;
  }
  const studW = 1 / look.studs;
  const boards: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const p of planks) for (let s = 0; s < look.studs; s++) boards.push({ x0: s * studW, x1: (s + 1) * studW, y0: p.y0, y1: p.y1 });

  const nails: [number, number][] = [];
  for (const b of boards) {
    const h = b.y1 - b.y0, mid = (b.y0 + b.y1) / 2;
    tile.rect((b.x0 + b.x1) / 2, mid, studW / 2, h / 2, 0, SHADE, pick(random, [0.46, 0.5, 0.54]));
    // Grain runs along the board, wavering, never leaving it.
    for (let i = 0; i < look.grainStrokes / boards.length; i++) {
      const length = Math.min(between(random, 0.1, 0.4), studW - END * 2);
      const gx = between(random, b.x0 + END, b.x1 - END - length), gy = between(random, b.y0 + h * 0.12, b.y1 - h * 0.12);
      const points: [number, number][] = [];
      for (let k = 0; k <= 6; k++) points.push([gx + (length * k) / 6, Math.min(b.y1 - h * 0.08, Math.max(b.y0 + h * 0.08, gy + Math.sin(k * 1.1 + gx * 20) * h * 0.04))]);
      const w = between(random, look.grainWidth[0], look.grainWidth[1]);
      tile.line(points, w, w * 0.5, SHADE, pick(random, [0.4, 0.43, 0.57]));
    }
    for (const x of [b.x0 + 0.012, b.x1 - 0.012]) for (const v of [0.28, 0.72]) nails.push([x, b.y0 + h * v]);
  }

  for (let i = 0; i < look.knots; i++) {
    const b = pick(random, boards), r = between(random, 0.005, 0.011);
    const x = between(random, b.x0 + END + r * 2, b.x1 - END - r * 2), ky = (b.y0 + b.y1) / 2 + between(random, -0.2, 0.2) * (b.y1 - b.y0);
    tile.stroke(x - r, ky, x + r, ky, r * 1.5, r * 1.5, SHADE, 0.36);
    tile.stroke(x - r * 0.6, ky, x + r * 0.6, ky, r * 0.8, r * 0.8, SHADE, 0.44);
    tile.disc(x, ky, r * 0.4, SHADE, 0.3);
  }

  // Gaps between planks, with dirt lodged just above each.
  for (const p of planks) {
    for (let i = 0; i < 5; i++) {
      const r = between(random, 0.003, 0.008);
      const b = pick(random, boards);
      tile.blob(between(random, b.x0 + r * 1.5, b.x1 - r * 1.5), p.y0 + 0.003 + r, r, 0.4, random, GRIME, 0.75, "max");
    }
  }

  // The repair: a newer, paler board nailed upright across three planks, between two studs.
  const stud = Math.floor(random() * look.studs), rx = (stud + between(random, 0.25, 0.75)) * studW, first = Math.floor(random() * (planks.length - 2));
  const ry0 = planks[first]!.y0 + 0.01, ry1 = planks[first + 2]!.y1 - 0.01, rmid = (ry0 + ry1) / 2, rh = (ry1 - ry0) / 2;
  tile.rect(rx, rmid, 0.04, rh + 0.003, 0, SHADE, 0.2);
  tile.rect(rx, rmid, 0.036, rh, 0, SHADE, 0.56);
  for (let i = 0; i < 24; i++) {
    const gx = rx + between(random, -0.03, 0.03), gy = between(random, ry0, ry1 - 0.05);
    tile.stroke(gx, gy, gx + between(random, -0.003, 0.003), gy + between(random, 0.04, 0.12), look.grainWidth[1] * 0.8, look.grainWidth[0] * 0.6, SHADE, 0.62);
  }
  for (let k = first; k < first + 3; k++) nails.push([rx, (planks[k]!.y0 + planks[k]!.y1) / 2]);

  // Nails: a dark ring, the head, a glint to the top left.
  const rusty: [number, number][] = [];
  for (const [x, ny] of nails) {
    tile.disc(x, ny, 0.004, SHADE, NAIL_RIM);
    tile.disc(x, ny, 0.0024, SHADE, NAIL_HEAD);
    tile.disc(x - 0.0008, ny + 0.0008, 0.0009, SHADE, NAIL_GLINT);
    if (random() < 0.4) {
      tile.disc(x, ny, 0.0035, RUST, RUST_DARK, "max");
      rusty.push([x, ny]);
    }
  }
  // Streaks stop above the gap below.
  for (let i = 0; i < look.streaks && rusty.length > 0; i++) {
    const [x, ny] = pick(random, rusty);
    const below = planks.find((p) => p.y0 <= ny && ny < p.y1)!;
    rustStreak(tile, random, x, ny - 0.003, Math.min(between(random, 0.02, 0.07), ny - below.y0 - 0.008), 0.003);
  }

  // Splinters off the plank edges and the board ends.
  for (let i = 0; i < look.chips; i++) {
    const b = pick(random, boards), r = between(random, 0.0025, 0.006);
    // Kept off the stud joints by their ragged reach.
    const reach = r * 1.5;
    if (random() < 0.7) chip(tile, random, between(random, b.x0 + reach, b.x1 - reach), random() < 0.5 ? b.y0 + 0.004 : b.y1 - 0.004, r);
    else chip(tile, random, random() < 0.5 ? b.x0 + reach : b.x1 - reach, between(random, b.y0, b.y1), r);
  }

  // The whole joints, last: the gap under every plank and the stud joints where the boards end.
  for (const p of planks) tile.stroke(0, p.y0, 1, p.y0, 0.0022, 0.0022, SHADE, GAP);
  for (let s = 0; s < look.studs; s++) tile.stroke(s * studW, 0, s * studW, 1, 0.002, 0.002, SHADE, JOINT);
}
