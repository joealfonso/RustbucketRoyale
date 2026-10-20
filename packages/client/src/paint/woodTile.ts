import type { PaintLook } from "./paintLook";
import { GRIME, RUST, RUST_DARK, SHADE, between, blankSurface, chip, pick, rustStreak, type Random } from "./marks";
import type { Tile } from "./raster";

// Planks: level boards of uneven widths, each a shade of its own with long wavy grain strokes and a knot or two,
// a butt joint somewhere along each, nailed at its joint and at two battens behind. Wear has a reason: dirt lodges
// in the gaps, nails rust and bleed short streaks, and edges splinter (chips show the raw wood). One newer board is
// nailed upright across a few planks, a repair.

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

  const nails: [number, number][] = [];
  const battens = [0.04, 0.54];
  for (const p of planks) {
    const h = p.y1 - p.y0, mid = (p.y0 + p.y1) / 2;
    tile.rect(0.5, mid, 0.5 + 0.01, h / 2, 0, SHADE, pick(random, [0.46, 0.5, 0.54]));
    // Grain runs along the board, wavering, never leaving it.
    for (let i = 0; i < look.grainStrokes / look.planks; i++) {
      const gx = random(), gy = between(random, p.y0 + h * 0.12, p.y1 - h * 0.12), length = between(random, 0.12, 0.45);
      const points: [number, number][] = [];
      for (let k = 0; k <= 5; k++) points.push([gx + (length * k) / 5, Math.min(p.y1 - h * 0.08, Math.max(p.y0 + h * 0.08, gy + Math.sin(k * 1.3 + gx * 20) * h * 0.04))]);
      const w = between(random, 0.0012, 0.003);
      tile.line(points, w, w * 0.5, SHADE, pick(random, [0.4, 0.43, 0.57]));
    }
    // A butt joint where two boards meet along the plank, nailed both sides.
    const joint = random();
    tile.stroke(joint, p.y0, joint, p.y1, 0.0025, 0.0025, SHADE, 0.16);
    for (const x of [joint - 0.012, joint + 0.012, ...battens]) for (const v of [0.28, 0.72]) nails.push([x, p.y0 + h * v]);
  }

  for (let i = 0; i < look.knots; i++) {
    const p = pick(random, planks), x = random(), ky = (p.y0 + p.y1) / 2 + between(random, -0.2, 0.2) * (p.y1 - p.y0);
    const r = between(random, 0.006, 0.012);
    tile.stroke(x - r, ky, x + r, ky, r * 1.5, r * 1.5, SHADE, 0.36);
    tile.stroke(x - r * 0.6, ky, x + r * 0.6, ky, r * 0.8, r * 0.8, SHADE, 0.44);
    tile.disc(x, ky, r * 0.4, SHADE, 0.3);
  }

  // Gaps between planks, with dirt lodged just above each.
  for (const p of planks) {
    for (let i = 0; i < 4; i++) tile.blob(random(), p.y0 + 0.004, between(random, 0.004, 0.009), 0.4, random, GRIME, 0.75, "max");
    tile.stroke(0, p.y0, 1, p.y0, 0.0028, 0.0028, SHADE, 0.14);
  }

  // The repair: a newer, paler board nailed upright across three planks.
  const rx = random(), first = Math.floor(random() * (planks.length - 2));
  const ry0 = planks[first]!.y0 + 0.01, ry1 = planks[first + 2]!.y1 - 0.01, rmid = (ry0 + ry1) / 2, rh = (ry1 - ry0) / 2;
  tile.rect(rx, rmid, 0.04, rh + 0.003, 0, SHADE, 0.2);
  tile.rect(rx, rmid, 0.036, rh, 0, SHADE, 0.56);
  for (let i = 0; i < 10; i++) {
    const gx = rx + between(random, -0.03, 0.03), gy = between(random, ry0, ry1 - 0.05);
    tile.stroke(gx, gy, gx + between(random, -0.003, 0.003), gy + between(random, 0.04, 0.12), 0.0015, 0.0008, SHADE, 0.62);
  }
  for (let k = first; k < first + 3; k++) nails.push([rx, (planks[k]!.y0 + planks[k]!.y1) / 2]);

  const rusty: [number, number][] = [];
  for (const [x, ny] of nails) {
    tile.disc(x, ny, 0.0045, SHADE, 0.22);
    tile.disc(x, ny, 0.0026, SHADE, 0.38);
    if (random() < 0.4) {
      tile.disc(x, ny, 0.004, RUST, RUST_DARK, "max");
      rusty.push([x, ny]);
    }
  }
  for (let i = 0; i < look.streaks && rusty.length > 0; i++) {
    const [x, ny] = pick(random, rusty);
    rustStreak(tile, random, x, ny - 0.003, between(random, 0.02, 0.07), 0.0035);
  }

  // Splinters off the plank edges and the joints.
  for (let i = 0; i < look.chips; i++) {
    const p = pick(random, planks);
    const edge = random() < 0.5 ? p.y0 + 0.004 : p.y1 - 0.004;
    chip(tile, random, random(), edge, between(random, 0.003, 0.007));
  }
}
