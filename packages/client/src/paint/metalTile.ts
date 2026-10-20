import type { PaintLook } from "./paintLook";
import { GRIME, MARK, RUST, RUST_DARK, RUST_LIGHT, SHADE, TAPE, between, blankSurface, brushStrokes, chip, crack, rustStreak, type Random } from "./marks";
import type { Tile } from "./raster";

// Sheet metal: plates in staggered rows, each painted with its own brush strokes, joined by seams with a row of
// rivets either side. Wear has a reason everywhere: water sits on the ledge of each horizontal seam (pooled rust and
// dirt there), runs down from the rivets under it and from lost rivets (streaks), knocks paint off along seams and
// plate corners (chips), and one plate has a riveted patch, another a crack taped over.

const SEAM_DARK = 0.16, LIP = 0.6, RIVET_RING = 0.3, RIVET_HEAD = 0.6;

export function paintMetal(tile: Tile, look: PaintLook["metal"], random: Random, wear: Uint8Array): void {
  blankSurface(tile, wear);
  const rows = look.plateRows, cols = look.plateColumns, rowH = 1 / rows, colW = 1 / cols;
  const sw = look.seamWidth, rr = look.rivetRadius;
  const offset = (row: number) => (row % 2) * colW * 0.5; // every other row of plates is shifted half a plate

  // Each plate painted on its own: strokes in one direction per plate, alternating, so neighbours differ a little.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = offset(row) + col * colW, y0 = row * rowH;
      const angle = (row + col) % 2 === 0 ? 0 : Math.PI / 2;
      brushStrokes(tile, random, Math.round(look.brushStrokes / (rows * cols)), { x0, y0, x1: x0 + colW, y1: y0 + rowH }, angle, 0.12, [0.05, 0.16], [0.006, 0.012], [0.46, 0.48, 0.52, 0.54]);
    }
  }

  const rivets: { x: number; y: number; below: boolean }[] = [];
  // Horizontal seams: the plate above laps over the one below, so a light lip sits just above a dark joint.
  for (let row = 0; row < rows; row++) {
    const y = row * rowH;
    tile.stroke(0, y + sw * 1.4, 1, y + sw * 1.4, sw * 0.3, sw * 0.3, SHADE, LIP);
    tile.stroke(0, y, 1, y, sw / 2, sw / 2, SHADE, SEAM_DARK);
    for (let x = look.rivetSpacing / 2; x < 1; x += look.rivetSpacing) {
      rivets.push({ x, y: y + sw + rr * 2, below: false }, { x, y: y - sw - rr * 2, below: true });
    }
  }
  // Vertical seams inside each row, butt joints with rivets either side.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = offset(row) + col * colW, y0 = row * rowH, y1 = y0 + rowH;
      tile.stroke(x, y0, x, y1, sw * 0.4, sw * 0.4, SHADE, SEAM_DARK);
      for (let y = y0 + look.rivetSpacing; y < y1 - look.rivetSpacing / 2; y += look.rivetSpacing) {
        rivets.push({ x: x - sw - rr * 2, y, below: false }, { x: x + sw + rr * 2, y, below: false });
      }
    }
  }

  // A few rivets are gone: an empty hole that rusts and bleeds a streak down the plate.
  const lost: { x: number; y: number }[] = [];
  for (const r of rivets) {
    if (random() < 0.05) {
      tile.disc(r.x, r.y, rr * 0.7, SHADE, SEAM_DARK);
      tile.disc(r.x, r.y, rr, RUST, RUST_DARK, "max");
      lost.push(r);
      continue;
    }
    tile.disc(r.x, r.y, rr * 1.4, SHADE, RIVET_RING);
    tile.disc(r.x, r.y, rr, SHADE, RIVET_HEAD);
  }

  // Water sits on each horizontal seam's ledge: rust and dirt pool along its top in ragged runs.
  for (let row = 0; row < rows; row++) {
    const y = row * rowH;
    for (let i = 0; i < 9; i++) {
      const x = random();
      const run = between(random, 0.015, 0.05);
      tile.stroke(x - run, y + sw * 1.9, x + run, y + sw * 1.9, between(random, 0.002, 0.004), between(random, 0.002, 0.004), GRIME, 0.8, "max");
      if (random() < 0.55) tile.blob(x + between(random, -0.02, 0.02), y + sw * 1.6, between(random, 0.005, 0.012), 0.4, random, RUST, RUST_LIGHT, "max");
    }
  }

  // Streaks run down from the rivets under each seam (water dripping off the lap) and from every lost rivet.
  const under = rivets.filter((r) => r.below);
  for (let i = 0; i < look.streaks; i++) {
    const r = under[Math.floor(random() * under.length)]!;
    rustStreak(tile, random, r.x, r.y, between(random, 0.04, 0.2), between(random, 0.004, 0.008));
  }
  for (const r of lost) rustStreak(tile, random, r.x, r.y, between(random, 0.08, 0.25), between(random, 0.005, 0.009));

  // A patch riveted over a hole on one plate, a newer plate in a slightly darker paint.
  const patchRow = Math.floor(random() * rows), patchCol = Math.floor(random() * cols);
  const px = offset(patchRow) + (patchCol + between(random, 0.3, 0.7)) * colW, py = (patchRow + between(random, 0.35, 0.65)) * rowH;
  const hw = between(random, 0.06, 0.09), hh = between(random, 0.045, 0.07), turn = between(random, -0.06, 0.06);
  tile.rect(px, py, hw + sw * 0.6, hh + sw * 0.6, turn, SHADE, SEAM_DARK);
  tile.rect(px, py, hw, hh, turn, SHADE, 0.43);
  brushStrokes(tile, random, 14, { x0: px - hw * 0.8, y0: py - hh * 0.8, x1: px + hw * 0.8, y1: py + hh * 0.8 }, 0, 0.1, [0.02, 0.05], [0.004, 0.008], [0.4, 0.46]);
  const c = Math.cos(turn), s = Math.sin(turn);
  const corner = (u: number, v: number): [number, number] => [px + u * c - v * s, py + u * s + v * c];
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const [x, y] = corner(u * (hw - rr * 2.5), v * (hh - rr * 2.5));
    tile.disc(x, y, rr * 1.4, SHADE, RIVET_RING);
    tile.disc(x, y, rr, SHADE, RIVET_HEAD);
  }
  for (const u of [-1, 1]) {
    const [x, y] = corner(u * (hw - rr * 2.5), -(hh - rr * 2.5));
    rustStreak(tile, random, x, y, between(random, 0.05, 0.14), 0.005);
  }

  // A crack on another plate, taped over: the tape hides the crack where it covers it.
  const tapeRow = (patchRow + 1) % rows, tapeCol = (patchCol + 1) % cols;
  const tx = offset(tapeRow) + (tapeCol + between(random, 0.3, 0.7)) * colW, ty = (tapeRow + between(random, 0.35, 0.65)) * rowH;
  const crackAngle = between(random, -0.6, 0.6) - Math.PI / 2;
  const line = crack(tile, random, tx, ty + 0.07, crackAngle, 0.15, 0.0022, SHADE, 0.12, "set");
  // One strip across the middle of the crack, square to its overall run.
  const [sx, sy] = line[0]!, [ex, ey] = line[line.length - 1]!;
  const [mx, my] = line[Math.floor(line.length / 2)]!;
  const across = Math.atan2(ey - sy, ex - sx) + Math.PI / 2 + between(random, -0.15, 0.15), tapeHalf = between(random, 0.045, 0.055);
  tile.rect(mx, my, tapeHalf, 0.016, across, SHADE, 0.5);
  tile.rect(mx, my, tapeHalf, 0.016, across, MARK, TAPE, "max");

  // Chips where things knock into it: mostly along seams, more at plate corners, a few anywhere.
  for (let i = 0; i < look.chips; i++) {
    const kind = random();
    const r = between(random, 0.003, 0.01);
    if (kind < 0.55) {
      const row = Math.floor(random() * rows);
      chip(tile, random, random(), row * rowH + between(random, -2, 2) * sw, r);
    } else if (kind < 0.85) {
      const row = Math.floor(random() * rows), col = Math.floor(random() * cols);
      const x = offset(row) + col * colW, y = row * rowH;
      for (let k = 0; k < 3; k++) chip(tile, random, x + between(random, -0.02, 0.02), y + between(random, -0.015, 0.015), r * 0.8);
    } else {
      chip(tile, random, random(), random(), r * 0.6);
    }
  }
}
