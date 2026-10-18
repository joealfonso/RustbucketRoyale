import { rng } from "../dressing/kinds";
import { box, convex, cylinder, mirrorX, turn, type MeshData, type V3 } from "../dressing/shapes";
import { fit, lerp, painter, type PropBuilder } from "./parts";

// An explosive barrel: a yellow drum with two black hazard bands, rolled rims, a lid with a bung, and a black warning
// diamond facing +z. Yellow and black is the read at range; the diamond is for up close. Burst, it is a blackened
// stump with torn plates curling outward and a couple of bits thrown into the corners.

const SIDES = 12;

export const barrel: PropBuilder = (size, seed) => {
  const [sx, sy, sz] = size;
  const r = rng(seed);
  const rim = Math.min(sx, sz) / 2, body = rim - 0.05;
  const k = sy / 1.8; // heights below are for the 1.8 m drum in props.json, scaled to the real one

  const intact = painter();
  const top = 1.7 * k;
  intact.add("sparkYellow", cylinder([0, top / 2, 0], body, top, "y", SIDES));
  for (const y of [0.045 * k, top - 0.045 * k]) intact.add("sparkYellow", cylinder([0, y, 0], rim, 0.09 * k, "y", SIDES));
  for (const y of [0.36 * k, 1.34 * k]) intact.add("soot", cylinder([0, y, 0], body + 0.02, 0.16 * k, "y", SIDES));
  intact.add("sparkYellow", cylinder([0, top + 0.015 * k, 0], body - 0.08, 0.07 * k, "y", SIDES));
  const bung = lerp(r, 0, Math.PI * 2), bungR = (body - 0.08) * 0.55;
  intact.add("soot", cylinder([Math.cos(bung) * bungR, sy - 0.035 * k, Math.sin(bung) * bungR], 0.08, 0.07 * k, "y", 6));
  intact.add("soot", ...diamond(body, 0.85 * k, 0.34 * k));

  return { intact: intact.pieces(), destroyed: burst(sx, sz, body, r) };
};

// A warning diamond lying flat on the two drum faces either side of +z (the cylinder has a corner there), built as a
// right half and its mirror. The halves overlap by 2 cm at the middle so no yellow seam shows between them.
function diamond(radius: number, centreY: number, halfHeight: number): MeshData[] {
  const step = (Math.PI * 2) / SIDES;
  const v0: V3 = [0, 0, radius], v1: V3 = [Math.sin(step) * radius, 0, Math.cos(step) * radius];
  const chord = Math.hypot(v1[0] - v0[0], v1[2] - v0[2]);
  const n: V3 = [Math.sin(step / 2), 0, Math.cos(step / 2)];
  const along = (t: number, y: number): V3 => [v0[0] + (v1[0] - v0[0]) * t, y, v0[2] + (v1[2] - v0[2]) * t];
  const back = -0.02 / chord, side = 0.95;
  const flat: V3[] = [along(back, centreY + halfHeight), along(side, centreY), along(back, centreY - halfHeight)];
  const lift = (p: V3, o: number): V3 => [p[0] + n[0] * o, p[1], p[2] + n[2] * o];
  const inner = flat.map((p) => lift(p, -0.01)), outer = flat.map((p) => lift(p, 0.05));
  const sidesOf = inner.map((_, i) => { const j = (i + 1) % 3; return [inner[i]!, inner[j]!, outer[j]!, outer[i]!]; });
  const half = convex([inner, outer, ...sidesOf]);
  return [half, mirrorX(half)];
}

const MAX_BURST = 0.58; // under the 0.6 m a burst barrel may reach

function burst(sx: number, sz: number, body: number, r: () => number) {
  const out = painter();
  const shell = body - 0.03, shellTop = 0.34;
  out.add("soot", cylinder([0, shellTop / 2, 0], shell, shellTop, "y", 10));
  const lo: V3 = [-sx / 2, 0, -sz / 2], hi: V3 = [sx / 2, MAX_BURST, sz / 2];

  // Torn plates rooted in the shell wall, leaning out. One is scorched rust rather than black.
  const count = 5, start = r() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const h = lerp(r, 0.18, 0.26), w = lerp(r, 0.26, 0.32);
    const plate = box([0, h / 2, 0], [w, h, 0.06], 0.02);
    const leaned = turn(plate, [lerp(r, 0.25, 0.6), 0, lerp(r, -0.15, 0.15)], [0, 0, 0], [0, shellTop - 0.08, shell - 0.03]);
    const placed = turn(leaned, [0, start + (i / count) * Math.PI * 2 + lerp(r, -0.2, 0.2), 0]);
    out.add(i === 0 ? "deepRust" : "soot", fit(placed, lo, hi));
  }

  // Two bits in opposite corners, outside the round stump: one still yellow, one rust.
  const corner = r() < 0.5 ? 1 : -1;
  for (const [s, paint] of [[1, "sparkYellow"], [-1, "deepRust"]] as const) {
    const bit = turn(box([0, 0.03, 0], [0.22, 0.06, 0.14]), [0, r() * Math.PI, lerp(r, -0.1, 0.1)], [0, 0, 0],
      [s * corner * (sx / 2 - 0.14), 0.02, s * (sz / 2 - 0.14)]);
    out.add(paint, fit(bit, lo, hi));
  }
  return out.pieces();
}
