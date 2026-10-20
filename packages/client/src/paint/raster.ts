// A tiny painter for the paint atlas: hard-edged shapes (one pixel of antialiasing, the toon look) drawn into one
// channel of one square layer of an RGBA byte array. Positions and sizes are in tile widths (0 to 1), so the same
// painting works at any tileSize, and every shape wraps round the edges, so each layer tiles with no seam.
// Row 0 is the bottom of the tile: up in the tile is up on a wall (paintChunk.ts reads it that way), so rust streaks
// painted toward smaller y run down.

export type Mode = "set" | "max" | "min";

export class Tile {
  constructor(readonly data: Uint8Array, readonly size: number, private start: number) {}

  fill(channel: number, value: number): void {
    const v = toByte(value);
    for (let i = this.start + channel, end = this.start + this.size * this.size * 4; i < end; i += 4) this.data[i] = v;
  }

  // One channel copied from a byte a pixel.
  copy(channel: number, bytes: Uint8Array): void {
    for (let i = 0, j = this.start + channel; i < bytes.length; i++, j += 4) this.data[j] = bytes[i]!;
  }

  get(x: number, y: number, channel: number): number {
    const n = this.size;
    const px = ((Math.floor(x * n) % n) + n) % n, py = ((Math.floor(y * n) % n) + n) % n;
    return this.data[this.start + (py * n + px) * 4 + channel]! / 255;
  }

  // Every pixel set from a function of its centre, in tile widths.
  field(channel: number, value: (x: number, y: number) => number): void {
    const n = this.size;
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) this.data[this.start + (py * n + px) * 4 + channel] = toByte(value((px + 0.5) / n, (py + 0.5) / n));
    }
  }

  disc(x: number, y: number, r: number, channel: number, value: number, mode: Mode = "set"): void {
    const n = this.size, cx = x * n, cy = y * n, rp = r * n;
    this.shape(cx - rp, cy - rp, cx + rp, cy + rp, channel, value, mode, (px, py) => len(px - cx, py - cy) - rp);
  }

  // A brush stroke from one point to another, `r0` wide (as a radius) at the start and `r1` at the end. Most of the
  // painting is strokes, so this one has its own loop rather than a distance function per pixel.
  stroke(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, channel: number, value: number, mode: Mode = "set"): void {
    const n = this.size, v = value * 255, data = this.data;
    const ax = x0 * n, ay = y0 * n, bx = x1 * n, by = y1 * n, ra = r0 * n, rb = r1 * n;
    const dx = bx - ax, dy = by - ay, len2 = Math.max(1e-6, dx * dx + dy * dy), rm = Math.max(ra, rb);
    const left = Math.floor(Math.min(ax, bx) - rm) - 1, right = Math.ceil(Math.max(ax, bx) + rm);
    for (let py = Math.floor(Math.min(ay, by) - rm) - 1; py <= Math.ceil(Math.max(ay, by) + rm); py++) {
      const row = this.start + (((py % n) + n) % n) * n * 4 + channel, qy = py + 0.5 - ay;
      for (let px = left; px <= right; px++) {
        const qx = px + 0.5 - ax;
        let t = (qx * dx + qy * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = qx - dx * t, ey = qy - dy * t;
        const cover = 0.5 - Math.sqrt(ex * ex + ey * ey) + ra + (rb - ra) * t;
        if (cover > 0) put(data, row + (((px % n) + n) % n) * 4, v, cover, mode);
      }
    }
  }

  // A stroke through several points, tapering from `r0` at the first to `r1` at the last.
  line(points: readonly (readonly [number, number])[], r0: number, r1: number, channel: number, value: number, mode: Mode = "set"): void {
    for (let i = 0; i + 1 < points.length; i++) {
      const t0 = i / (points.length - 1), t1 = (i + 1) / (points.length - 1);
      const [ax, ay] = points[i]!, [bx, by] = points[i + 1]!;
      this.stroke(ax, ay, bx, by, r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, channel, value, mode);
    }
  }

  // A rectangle `hw` by `hh` either side of its centre, turned by `angle` radians.
  rect(x: number, y: number, hw: number, hh: number, angle: number, channel: number, value: number, mode: Mode = "set"): void {
    const n = this.size, cx = x * n, cy = y * n, w = hw * n, h = hh * n, c = Math.cos(angle), s = Math.sin(angle);
    const ex = Math.abs(w * c) + Math.abs(h * s), ey = Math.abs(w * s) + Math.abs(h * c);
    this.shape(cx - ex, cy - ey, cx + ex, cy + ey, channel, value, mode, (px, py) => {
      const u = Math.abs((px - cx) * c + (py - cy) * s) - w, v = Math.abs(-(px - cx) * s + (py - cy) * c) - h;
      return Math.max(u, v);
    });
  }

  // A ragged round blob, its edge pushed in and out by up to `ragged` of its radius at `corners` points round it.
  blob(x: number, y: number, r: number, ragged: number, random: () => number, channel: number, value: number, mode: Mode = "set", corners = 7): void {
    const n = this.size, cx = x * n, cy = y * n, rp = r * n;
    const radii = Array.from({ length: corners }, () => rp * (1 - ragged + 2 * ragged * random()));
    const reach = rp * (1 + ragged);
    this.shape(cx - reach, cy - reach, cx + reach, cy + reach, channel, value, mode, (px, py) => {
      const a = (Math.atan2(py - cy, px - cx) / (Math.PI * 2) + 1) * corners;
      const i = Math.floor(a) % corners, f = a - Math.floor(a);
      return len(px - cx, py - cy) - (radii[i]! + (radii[(i + 1) % corners]! - radii[i]!) * f);
    });
  }

  // Paints every pixel near the box from x0..x1, y0..y1 (in pixels) whose centre is inside `distance` (negative inside,
  // in pixels), blending the last pixel of the edge so it is not stair-stepped.
  private shape(x0: number, y0: number, x1: number, y1: number, channel: number, value: number, mode: Mode, distance: (px: number, py: number) => number): void {
    const n = this.size, v = value * 255;
    for (let py = Math.floor(y0) - 1; py <= Math.ceil(y1); py++) {
      const row = this.start + (((py % n) + n) % n) * n * 4 + channel;
      for (let px = Math.floor(x0) - 1; px <= Math.ceil(x1); px++) {
        const cover = 0.5 - distance(px + 0.5, py + 0.5);
        if (cover > 0) put(this.data, row + (((px % n) + n) % n) * 4, v, cover, mode);
      }
    }
  }
}

// Blends one byte toward `v` (0 to 255) by how much of the pixel the shape covers.
function put(data: Uint8Array, i: number, v: number, cover: number, mode: Mode): void {
  const old = data[i]!;
  const target = mode === "max" ? (old > v ? old : v) : mode === "min" ? (old < v ? old : v) : v;
  data[i] = Math.round(old + (target - old) * (cover < 1 ? cover : 1));
}

// Math.hypot is many times slower than this in V8, and the painter calls it for every pixel of every shape.
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

function toByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

// A whole number hash of two cells and a seed, as a share in [0, 1).
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul(y + 0x165667b1, 0xc2b2ae35) ^ Math.imul(seed, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise in [0, 1] that repeats every tile: `cells` lattice cells across it. The lattice is hashed once,
// so filling a whole layer costs a few multiplies a pixel.
export class TileNoise {
  private lattice: Float32Array;

  constructor(private cells: number, seed: number) {
    this.lattice = new Float32Array(cells * cells);
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) this.lattice[y * cells + x] = hash2(x, y, seed);
  }

  at(x: number, y: number): number {
    const n = this.cells, fx = x * n, fy = y * n;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % n) + n) % n, y0 = ((iy % n) + n) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const l = this.lattice;
    const a = l[y0 * n + x0]!, b = l[y0 * n + x1]!, c = l[y1 * n + x0]!, d = l[y1 * n + x1]!;
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
}
