import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { box, cylinder, triangles, turn, wedge, type MeshData, type V3 } from "./shapes";

// A scrap box: a junk pile. A big base mass (a crushed car, or two crushed blocks) fills the footprint up to a bit
// over half the height, one tall thing (a stack of tyres, drums or crates) reaches the top of the box, and smaller
// junk (drums, crates, pipes, leaning plates) fills in around them. Everything is nudged back inside the box after
// it is placed, so seeded sizes and tilts can never poke out of the collision.

const lerp = (r: () => number, a: number, b: number) => a + (b - a) * r();

export const scrap: KindBuilder = (dressBox: DressBox): DressPiece[] => {
  const r = rng(dressBox.seed);
  const sx = dressBox.max[0] - dressBox.min[0], sz = dressBox.max[2] - dressBox.min[2], h = dressBox.max[1] - dressBox.min[1];
  // Built in a frame with the long side along x, centred on x = z = 0 and standing on y = 0, then turned to match.
  const hx = Math.max(sx, sz) / 2, hz = Math.min(sx, sz) / 2;
  const budget = Math.min(2500, Math.max(150, sx * sz * h * 40)) * 0.9; // a little under checkBuilder's limit

  const pieces: { paint: string; mesh: MeshData }[] = [];
  let used = 0;
  // Moves a mesh by the least amount that puts it inside the box (centring it on any axis it is too big for).
  const inside = (m: MeshData): MeshData => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i++) { lo[i % 3] = Math.min(lo[i % 3]!, m.positions[i]!); hi[i % 3] = Math.max(hi[i % 3]!, m.positions[i]!); }
    const boxLo = [-hx, 0, -hz], boxHi = [hx, h, hz];
    const move = [0, 1, 2].map((a) => {
      if (hi[a]! - lo[a]! > boxHi[a]! - boxLo[a]!) return (boxLo[a]! + boxHi[a]!) / 2 - (lo[a]! + hi[a]!) / 2;
      return lo[a]! < boxLo[a]! ? boxLo[a]! - lo[a]! : hi[a]! > boxHi[a]! ? boxHi[a]! - hi[a]! : 0;
    }) as V3;
    return turn(m, [0, 0, 0], [0, 0, 0], move);
  };
  // Required pieces always go in; optional ones only while the triangle budget allows.
  const add = (paint: string, m: MeshData, required = false): boolean => {
    if (!required && used + triangles(m) > budget) return false;
    used += triangles(m);
    pieces.push({ paint, mesh: inside(m) });
    return true;
  };

  // One or two items wear a bright accent so the pile is not all brown.
  const accent = r() < 0.5 ? "sparkYellow" : "frameNavy";
  let accents = r() < 0.5 ? 1 : 2;
  const paint = (usual: string[]) => {
    if (accents > 0 && r() < 0.3) { accents--; return accent; }
    return usual[Math.floor(r() * usual.length)]!;
  };

  // The base mass.
  const base = h * lerp(r, 0.5, 0.6);
  const small = hx < 1.4;
  if (small || r() < 0.55) {
    // A crushed car body with its squashed cabin on top.
    const carPaint = paint(["rustOrange", "deepRust", "rustOrange"]);
    add(carPaint, box([0, base / 2, 0], [hx * 2 - 0.06, base, hz * 2 - 0.06], small ? 0.08 : 0.18), true);
    const cabinLength = hx * lerp(r, 0.7, 1), cabinHeight = Math.min(h - base, h * lerp(r, 0.12, 0.2));
    // Wedges slope along z, so build it lengthwise in z and turn it to lie along the car, pushed off centre.
    const cabin = wedge([0, base + cabinHeight / 2, 0], [hz * 1.6, cabinHeight, cabinLength], lerp(r, 0.25, 0.4));
    add(carPaint, turn(cabin, [0, Math.PI / 2 * (r() < 0.5 ? 1 : -1), 0], [0, 0, 0], [hx * lerp(r, -0.3, 0.3), 0, 0]));
  } else {
    // Two crushed blocks, overlapping where they meet, at slightly different heights.
    const split = hx * lerp(r, -0.25, 0.25);
    const left = split + 0.3, right = split - 0.3;
    const h1 = base * lerp(r, 0.9, 1.05), h2 = base * lerp(r, 0.9, 1.05);
    add("deepRust", box([(-hx + left) / 2, h1 / 2, 0], [left + hx, h1, hz * 2 - 0.04], 0.15), true);
    add("scrapSteel", box([(right + hx) / 2, h2 / 2, lerp(r, -0.05, 0.05)], [hx - right, h2, hz * 2 - 0.1], 0.12), true);
  }

  // The tall thing that reaches the top of the box, standing on the base.
  const rise = h - base;
  const tallX = hx * lerp(r, -0.6, 0.6), tallZ = hz * lerp(r, -0.3, 0.3);
  const tall = r();
  if (tall < 0.4) {
    // A stack of tyres, a little wobbly.
    const radius = Math.min(0.5, hz * 0.75) * lerp(r, 0.85, 1);
    const count = Math.max(1, Math.round(rise / 0.28));
    const each = rise / count;
    for (let i = 0; i < count; i++) {
      const tyre = cylinder([tallX + lerp(r, -0.06, 0.06), base + each * (i + 0.5), tallZ + lerp(r, -0.06, 0.06)], radius, each, "y", 10);
      add("soot", tyre, i === 0);
    }
  } else if (tall < 0.75) {
    // Upright oil drums, one on another if the rise is tall.
    const count = Math.max(1, Math.round(rise / 0.95));
    const each = rise / count;
    const radius = Math.min(0.32, hz * 0.7);
    for (let i = 0; i < count; i++) add(paint(["deepRust", "scrapSteel", "rustOrange"]), cylinder([tallX, base + each * (i + 0.5), tallZ], radius, each, "y", 8), i === 0);
  } else {
    // Crates stacked, each turned a little.
    const count = Math.max(1, Math.round(rise / 0.8));
    const each = rise / count;
    for (let i = 0; i < count; i++) {
      const size = Math.min(1.1, hz * 1.4) * lerp(r, 0.75, 1);
      const crate = box([tallX, base + each * (i + 0.5), tallZ], [size, each, size * lerp(r, 0.8, 1)], 0);
      add(paint(["rustOrange", "scrapSteel"]), turn(crate, [0, lerp(r, -0.4, 0.4), 0], [tallX, 0, tallZ]), i === 0);
    }
  }

  // Smaller junk on and around the base, more of it for a bigger footprint.
  const fillers = Math.max(2, Math.min(7, Math.round((hx * hz * 4) / 3)));
  for (let n = 0; n < fillers; n++) {
    const x = hx * lerp(r, -0.8, 0.8), z = hz * lerp(r, -0.6, 0.6);
    const pick = r();
    if (pick < 0.25) {
      // An oil drum lying on its side, along or across the pile.
      const radius = Math.min(0.3, (h - base) / 2, hz * 0.6);
      const along = r() < 0.6;
      const length = Math.min(0.9, (along ? hx : hz) * 1.6);
      add(paint(["deepRust", "scrapSteel", "rustOrange"]), cylinder([x, base + radius, z], radius, length, along ? "x" : "z", 8));
    } else if (pick < 0.45) {
      const size = Math.min(0.8, hz, (h - base) * 1.2) * lerp(r, 0.7, 1);
      const crate = box([x, base + size * 0.4, z], [size, size * 0.8, size], 0);
      add(paint(["rustOrange", "scrapSteel"]), turn(crate, [0, lerp(r, -0.5, 0.5), 0], [x, 0, z]));
    } else if (pick < 0.65) {
      // A few pipes lying side by side.
      const radius = lerp(r, 0.1, 0.15), length = hx * lerp(r, 0.8, 1.4);
      for (let i = 0; i < 3; i++) add("scrapSteel", cylinder([x, base + radius, z + (i - 1) * radius * 2.1], radius, length, "x", 6));
    } else if (pick < 0.85) {
      // A metal plate leaning against a side of the pile.
      const side = r() < 0.5 ? -1 : 1;
      const height = h * lerp(r, 0.55, 0.8), width = Math.min(hx, lerp(r, 0.8, 1.6));
      const plate = box([x, height / 2, side * (hz - 0.05)], [width, height, 0.1], 0);
      add(paint(["scrapSteel", "deepRust"]), turn(plate, [-side * lerp(r, 0.2, 0.4), lerp(r, -0.2, 0.2), 0], [x, 0, side * (hz - 0.05)]));
    } else {
      // A single tyre lying flat.
      const radius = Math.min(0.45, hz * 0.6);
      add("soot", cylinder([x, base + 0.13, z], radius, 0.26, "y", 10));
    }
  }

  const cx = (dressBox.min[0] + dressBox.max[0]) / 2, cz = (dressBox.min[2] + dressBox.max[2]) / 2;
  const angles: V3 = sx >= sz ? [0, 0, 0] : [0, Math.PI / 2, 0];
  return pieces.map((p) => ({ paint: p.paint, mesh: turn(p.mesh, angles, [0, 0, 0], [cx, dressBox.min[1], cz]) }));
};
