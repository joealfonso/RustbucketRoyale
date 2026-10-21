import type { PaintLook } from "./paintLook";
import { GRIME, RUST, RUST_DARK, SHADE, between, blankSurface, brushStrokes, chip, crack, rustStreak, type Random } from "./marks";
import { TileNoise, type Tile } from "./raster";

// Cast concrete: flat mottled patches in three shades (not a blur), faint board marks from the formwork, a line at
// each pour lift with a row of form-tie holes between them. Wear has a reason: dark water stains run down from each
// lift's ledge, the steel ties rust and bleed, cracks start at tie holes, and the lift edges chip.
// Each lift line and a control joint at the tile's left edge run the whole tile, drawn last so nothing crosses them,
// so the shader can start a tile cell on any lift (paintAtlas.ts cellSteps) and cells meet at a joint.

const JOINT = 0.34, JOINT_WIDTH = 0.0022, TIE_RIM = 0.42, TIE_HOLE = 0.2, TIE_LIP = 0.56;

export function paintConcrete(tile: Tile, look: PaintLook["concrete"], random: Random, wear: Uint8Array, seed: number): void {
  blankSurface(tile, wear);
  // Mottling in hard steps of shade.
  const coarse = new TileNoise(4, seed + 7), fine = new TileNoise(11, seed + 8);
  tile.field(SHADE, (x, y) => {
    const n = coarse.at(x, y) * 0.7 + fine.at(x, y) * 0.3;
    return n < 0.38 ? 0.46 : n > 0.63 ? 0.54 : 0.5;
  });
  // The formwork boards left a grain: short strokes, nearly level.
  brushStrokes(tile, random, look.brushStrokes, { x0: 0, y0: 0, x1: 1, y1: 1 }, 0, 0.08, [0.03, 0.1], look.brushWidth, [0.46, 0.48, 0.53]);

  const liftH = 1 / look.pourLifts, jointW = 1 / look.boardJoints;
  const ties: [number, number][] = [];
  const lines: [number, number][][] = [];
  for (let lift = 0; lift < look.pourLifts; lift++) {
    const y = lift * liftH;
    // The lift line, a little wavy, as a pour never sets dead level; drawn at the end.
    const line: [number, number][] = [];
    for (let i = 0; i <= 10; i++) line.push([i / 10, y + (i === 0 || i === 10 ? 0 : between(random, -0.002, 0.002))]);
    lines.push(line);
    // Board joints of this lift, faint, shifted from the lift below.
    const shift = random() * jointW;
    for (let j = 0; j < look.boardJoints; j++) tile.stroke(shift + j * jointW, y + 0.004, shift + j * jointW, y + liftH - 0.004, 0.0008, 0.0008, SHADE, 0.45);
    for (const v of [0.3, 0.7]) for (let j = 0; j < look.boardJoints; j++) ties.push([shift + (j + 0.5) * jointW, y + v * liftH]);
    // Dirt sits on the ledge and water stains run down from it.
    for (let i = 0; i < 4; i++) {
      const x = random();
      tile.blob(x, y + 0.005, between(random, 0.006, 0.012), 0.4, random, GRIME, 0.75, "max");
      const length = between(random, 0.04, liftH * 0.6), w = between(random, 0.003, 0.007);
      tile.line([[x, y], [x + between(random, -0.004, 0.004), y - length / 2], [x + between(random, -0.006, 0.006), y - length]], w, w * 0.3, GRIME, 0.62, "max");
    }
  }

  // Tie holes: a worn rim, the hole, and a light lip where its lower edge catches the light.
  for (const [x, y] of ties) {
    tile.disc(x, y, 0.008, SHADE, TIE_RIM);
    tile.disc(x, y - 0.0015, 0.005, SHADE, TIE_LIP);
    tile.disc(x, y, 0.0048, SHADE, TIE_HOLE);
  }
  for (let i = 0; i < look.streaks; i++) {
    const [x, y] = ties[Math.floor(random() * ties.length)]!;
    tile.disc(x, y, 0.0045, RUST, RUST_DARK, "max");
    rustStreak(tile, random, x, y - 0.004, between(random, 0.04, 0.16), between(random, 0.0025, 0.005));
  }

  // Cracks starting from tie holes, with flakes broken off along them.
  for (let i = 0; i < look.cracks; i++) {
    const [x, y] = ties[Math.floor(random() * ties.length)]!;
    const points = crack(tile, random, x, y, random() * Math.PI * 2, between(random, 0.12, 0.25), 0.0016, SHADE, 0.2, "set");
    for (const [cx, cy] of points) if (random() < 0.25) chip(tile, random, cx, cy, between(random, 0.0025, 0.006));
  }

  // Chips along the lift edges, where the formwork was stripped, and a few knocks anywhere.
  for (let i = 0; i < look.chips; i++) {
    const r = between(random, 0.0025, 0.008);
    if (random() < 0.7) chip(tile, random, random(), Math.floor(random() * look.pourLifts) * liftH + between(random, -0.006, 0.006), r);
    else chip(tile, random, random(), random(), r * 0.7);
  }

  // The whole joints, last: every lift line and the control joint up the tile's left edge.
  for (const line of lines) tile.line(line, JOINT_WIDTH, JOINT_WIDTH, SHADE, JOINT);
  tile.stroke(0, 0, 0, 1, JOINT_WIDTH, JOINT_WIDTH, SHADE, JOINT);
}
