import { hash01 } from "./flipbook";

// The painted sheet every pooled sprite draws from: fireball frames, smoke puffs, shockwave rings, scorch marks, jet
// flames and a spark streak, made once at startup by code (no image to download). Each cell stores shape, not colour:
//  - R: where the toon bands fall, 0 to 3 across the three bands (light, mid, dark). The shader picks the band, so one
//    sheet serves every palette (fire, smoke, dust, sparks) and a puff can darken by shifting its bands.
//  - G: dissolve order, low first. A sprite fades by eating away its lowest values, in hard-edged steps, never by
//    going see-through.
//  - B: how far in from the shape's edge, 0 at the edge to 1 at INK_SPAN in, so an inked pool (sprites.ts) can draw
//    a hand-drawn outline of any width along it. Pools without ink ignore it.
//  - A: the shape, soft over a few pixels so its edge stays clean when the shader cuts it at one half.
// Shapes are drawn wobbly on purpose, like a brush, from a fixed hash so the sheet is the same every time.

export const CELL = 64;
export const COLUMNS = 8;
export const ROWS = 3;

// Where each shape's frames start in the sheet, and how many there are.
export const FRAMES = {
  fireball: { first: 0, count: 4 },
  smoke: { first: 4, count: 3 },
  ring: { first: 7, count: 4 },
  scorch: { first: 11, count: 3 },
  flame: { first: 14, count: 3 },
  spark: { first: 17, count: 1 },
  streak: { first: 18, count: 1 },
} as const;

// How far in from the edge, in cell units (the cell runs -1 to 1), the B channel reaches 1: an ink line can be up to
// an eighth of a cell wide.
export const INK_SPAN = 0.25;

interface Ink { band: number; dissolve: number; inside: number } // band 0 to 3, dissolve 0 to 1, inside as a signed distance in cell units

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash01(a * 7919 + b * 104729 + seed * 1299709);
  const top = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx;
  const bottom = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx;
  return top + (bottom - top) * sy;
}

// A distance 0 (middle) to 1 (edge) turned into a band coordinate, given where band 0 and band 1 end.
function bands(d: number, coreEdge: number, midEdge: number): number {
  if (d < coreEdge) return d / coreEdge;
  if (d < midEdge) return 1 + (d - coreEdge) / (midEdge - coreEdge);
  return 2 + Math.min(0.99, (d - midEdge) / Math.max(0.01, 1 - midEdge));
}

// A lumpy outline: the radius at an angle, with a few sine lobes of their own phase per seed.
function lumpy(angle: number, seed: number, amount: number): number {
  return 1 + amount * (0.5 * Math.sin(5 * angle + seed * 1.7) + 0.3 * Math.sin(9 * angle + seed * 3.1) + 0.2 * Math.sin(13 * angle + seed * 4.3));
}

// A blast frame: a round burst that grows, its hot core shrinking frame by frame, breaking into rust rags at the end.
const FIRE_SIZE = [0.62, 0.9, 0.95, 0.88];
const FIRE_CORE = [0.62, 0.42, 0.2, 0.02];
const FIRE_MID = [0.9, 0.76, 0.56, 0.32];
const FIRE_HOLES = [0, 0, 0.3, 0.5];
function fireball(x: number, y: number, frame: number): Ink {
  const r = Math.hypot(x, y), a = Math.atan2(y, x);
  const edge = FIRE_SIZE[frame]! * lumpy(a, frame + 1, 0.16);
  const n = noise(x * 3 + 5, y * 3 + 9, frame);
  // Late frames tear open: noise cuts holes into the ball, so it reads as breaking up rather than shrinking.
  const holes = FIRE_HOLES[frame]! > 0 ? (n - FIRE_HOLES[frame]!) * 0.5 : 1;
  const d = r / edge + (noise(x * 5, y * 5, frame + 20) - 0.5) * 0.18;
  return { band: bands(d, FIRE_CORE[frame]!, FIRE_MID[frame]!), dissolve: 1 - (0.6 * Math.min(1, r / edge) + 0.4 * n), inside: Math.min(edge - r, holes) };
}

// A puff of smoke: a cluster of balls lit from the upper left, three hard bands of light like the toon ramp.
const PUFFS = [
  [[0, -0.1, 0.62], [-0.38, -0.25, 0.42], [0.36, -0.22, 0.45], [0.05, 0.35, 0.45]],
  [[0, -0.05, 0.58], [-0.42, -0.1, 0.4], [0.3, 0.28, 0.42], [0.4, -0.3, 0.36]],
  [[-0.1, 0, 0.55], [0.35, -0.15, 0.48], [-0.3, 0.35, 0.36], [0.2, 0.42, 0.34]],
] as const;
const LIGHT = [-0.45, 0.65, 0.61]; // unit-ish, from up and to the left, towards the viewer
function smoke(x: number, y: number, variant: number): Ink {
  let best = -Infinity, nx = 0, ny = 0;
  const wobble = (noise(x * 4 + 3, y * 4 + 1, variant + 40) - 0.5) * 0.12;
  for (const [cx, cy, rc] of PUFFS[variant]!) {
    const dx = x - cx, dy = y - cy;
    const depth = (rc + wobble - Math.hypot(dx, dy)) / rc;
    if (depth > best) { best = depth; nx = dx / rc; ny = dy / rc; }
  }
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const lit = nx * LIGHT[0]! + ny * LIGHT[1]! + nz * LIGHT[2]!;
  const band = lit > 0.6 ? (1 - lit) / 0.4 : lit > 0.1 ? 1 + (0.6 - lit) / 0.5 : 2 + Math.min(0.99, (0.1 - lit) / 1.1);
  const n = noise(x * 3, y * 3, variant + 60);
  return { band, dissolve: 0.5 * Math.min(1, Math.max(0, best) * 2) + 0.5 * n, inside: best * 0.5 };
}

// A shockwave ring, thinning frame by frame, with a ragged inside edge; dark at its outer lip where the dust piles up.
const RING_WIDTH = [0.42, 0.26, 0.15, 0.08];
function ring(x: number, y: number, frame: number): Ink {
  const r = Math.hypot(x, y), a = Math.atan2(y, x);
  const outer = 0.96 * lumpy(a, frame + 7, 0.02);
  const width = RING_WIDTH[frame]! * (0.75 + 0.5 * noise(Math.cos(a) * 3 + 4, Math.sin(a) * 3 + 4, frame + 80));
  const inner = outer - width;
  const across = (r - inner) / width; // 0 at the inside edge, 1 at the outer lip
  return { band: bands(across, 0.45, 0.8), dissolve: noise(x * 4, y * 4, frame + 90), inside: Math.min(outer - r, r - inner) };
}

// A scorch mark: a dark splat with spiky rays and a few flecks round it.
function scorch(x: number, y: number, variant: number): Ink {
  const r = Math.hypot(x, y), a = Math.atan2(y, x);
  const rays = 0.35 * Math.max(0, Math.sin(7 * a + variant * 2.3)) ** 6 + 0.25 * Math.max(0, Math.sin(11 * a + variant * 5.1)) ** 8;
  const edge = 0.58 * (1 + rays + 0.08 * Math.sin(3 * a + variant));
  const n = noise(x * 6 + 11, y * 6 + 3, variant + 100);
  const fleck = n > 0.78 && r < edge * 1.35 && r > edge ? (n - 0.78) * 0.4 : -1;
  const d = r / edge + (noise(x * 5, y * 5, variant + 120) - 0.5) * 0.2;
  return { band: bands(Math.min(d, 1.2), 0.45, 0.8), dissolve: 1 - (0.6 * Math.min(1, r / edge) + 0.4 * n), inside: Math.max(edge - r, fleck) };
}

// A jet flame along the cell from its foot (v = 0, the nozzle) to its tip, a hot short core inside a longer orange
// tongue with a rust skin. Each frame wobbles differently, so cycling them flickers.
function flame(x: number, v: number, frame: number): Ink {
  const half = 0.92 * (1 - v) ** 0.7 * (1 + 0.12 * Math.sin(v * 13 + frame * 2.1)) * Math.min(1, 0.55 + v * 6);
  const s = Math.abs(x) / Math.max(0.01, half);
  const n = noise(x * 4 + frame * 7, v * 6, frame + 140);
  const core = 0.42 * (1 - v / 0.5), mid = 0.8 * (1 - v / 0.95);
  const band = s < core ? (s / Math.max(0.01, core)) : s < mid ? 1 + (s - core) / Math.max(0.01, mid - core) : 2 + Math.min(0.99, s - mid);
  const tip = 0.96 - n * 0.2;
  return { band, dissolve: 1 - v * 0.7 - n * 0.3, inside: Math.min(half - Math.abs(x), (tip - v) * 0.5) };
}

// A spark streak from its head (v = 0) back along its tail: white hot core, yellow, orange skin.
function spark(x: number, v: number): Ink {
  const half = 0.85 * (1 - v) ** 0.8;
  const s = Math.abs(x) / Math.max(0.01, half);
  // The head is rounded rather than cut flat by the cell edge.
  const head = v < 0.12 ? half - Math.hypot(x, (0.12 - v) * 7) : half - Math.abs(x);
  return { band: s < 0.35 ? s / 0.35 : s < 0.7 ? 1 + (s - 0.35) / 0.35 : 2 + Math.min(0.99, s - 0.7), dissolve: 1 - v, inside: Math.min(head, 0.97 - v) };
}

// A comic speed streak: a long thin spear, fattest a third of the way along and tapering to a point at both ends,
// lit along its middle. Drawn along the cell from v = 0 to v = 1.
function streak(x: number, v: number): Ink {
  const half = 0.7 * Math.sin(Math.PI * Math.min(1, v ** 0.75));
  const s = Math.abs(x) / Math.max(0.01, half);
  return { band: s < 0.5 ? s / 0.5 : 1 + Math.min(1.99, (s - 0.5) / 0.25), dissolve: v, inside: Math.min(half - Math.abs(x), 0.98 - Math.abs(v * 2 - 1)) };
}

function inkAt(frame: number, u: number, v: number): Ink {
  const x = u * 2 - 1, y = v * 2 - 1;
  const f = FRAMES;
  if (frame < f.smoke.first) return fireball(x, y, frame - f.fireball.first);
  if (frame < f.ring.first) return smoke(x, y, frame - f.smoke.first);
  if (frame < f.scorch.first) return ring(x, y, frame - f.ring.first);
  if (frame < f.flame.first) return scorch(x, y, frame - f.scorch.first);
  if (frame < f.spark.first) return flame(x, v, frame - f.flame.first);
  if (frame < f.streak.first) return spark(x, v);
  return streak(x, v);
}

const SOFT_EDGE = 8; // how quickly the shape edge goes from out to in, per cell unit: about four pixels

// The whole sheet as RGBA bytes, COLUMNS * CELL wide and ROWS * CELL tall, row 0 at the bottom (texture v = 0).
export function paintSpriteSheet(): Uint8Array {
  const width = COLUMNS * CELL, height = ROWS * CELL;
  const data = new Uint8Array(width * height * 4);
  const used = FRAMES.streak.first + FRAMES.streak.count;
  for (let frame = 0; frame < used; frame++) {
    const cx = (frame % COLUMNS) * CELL, cy = Math.floor(frame / COLUMNS) * CELL;
    for (let j = 0; j < CELL; j++) {
      for (let i = 0; i < CELL; i++) {
        const ink = inkAt(frame, (i + 0.5) / CELL, (j + 0.5) / CELL);
        const at = ((cy + j) * width + cx + i) * 4;
        data[at] = Math.round(Math.max(0, Math.min(2.999, ink.band)) / 3 * 255);
        data[at + 1] = Math.round(Math.max(0, Math.min(1, ink.dissolve)) * 255);
        data[at + 2] = Math.round(Math.max(0, Math.min(1, ink.inside / INK_SPAN)) * 255);
        data[at + 3] = Math.round(Math.max(0, Math.min(1, 0.5 + ink.inside * SOFT_EDGE)) * 255);
      }
    }
  }
  return data;
}
