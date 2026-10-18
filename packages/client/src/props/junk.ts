import { rng } from "../dressing/kinds";
import { box, cylinder, turn, type MeshData, type V3 } from "../dressing/shapes";
import { fit, lerp, painter, settle, squashY, type PropBuilder } from "./parts";

// A junk pile worth smashing: a crushed slab fills the footprint as cover, with a bent navy cabinet, a standing and a
// lying drum, pipes and loose plates on top and a tyre stuck in its front. Smashed, the same things lie flattened
// round a low slab. The seed picks which side the cabinet is on and nudges everything else.

export const junk: PropBuilder = (size, seed) => {
  const [sx, sy, sz] = size;
  const hx = sx / 2, hz = sz / 2;
  const r = rng(seed);
  const side = r() < 0.5 ? 1 : -1; // the cabinet's end
  const lo: V3 = [-hx, 0, -hz], hi: V3 = [hx, sy, hz];
  const intact = painter();
  const put = (paint: string, m: MeshData) => intact.add(paint, fit(m, lo, hi));

  const base = sy * 0.36;
  put("deepRust", box([0, base / 2, 0], [sx - 0.08, base, sz - 0.08], 0.12));

  // The cabinet, a little bent over, reaching the top of the box.
  const cab: V3 = [hx * 0.75, sy - base, hz * 0.7];
  put("frameNavy", turn(box([0, cab[1] / 2, 0], cab, 0.05), [0, lerp(r, -0.2, 0.2), side * lerp(r, 0.04, 0.1)], [0, 0, 0],
    [side * hx * 0.45, base, lerp(r, -0.15, 0.15)]));

  // A standing drum with rims on the other end, and a drum on its side beside it.
  const drumR = Math.min(0.32, hz * 0.26), drumH = Math.min(0.9, (sy - base) * 0.9);
  const standing: V3 = [-side * hx * lerp(r, 0.4, 0.5), base, -hz * 0.35];
  put("rustOrange", cylinder([standing[0], base + drumH / 2, standing[2]], drumR, drumH, "y", 10));
  for (const y of [base + 0.05, base + drumH - 0.05]) put("deepRust", cylinder([standing[0], y, standing[2]], drumR + 0.025, 0.07, "y", 10));
  const lyingR = drumR * 0.95;
  put("scrapSteel", turn(cylinder([0, 0, 0], lyingR, drumH * 0.95, "x", 10), [0, lerp(r, -0.3, 0.3), 0], [0, 0, 0],
    [-side * hx * 0.4, base + lyingR, hz * 0.45]));

  // A tyre half buried in the slab's front, with its hub.
  const tyreR = Math.min(0.42, base * 0.75), tyreAt: V3 = [-side * hx * lerp(r, 0.05, 0.3), tyreR + 0.02, hz - 0.14];
  put("soot", cylinder(tyreAt, tyreR, 0.26, "z", 10));
  put("scrapSteel", cylinder([tyreAt[0], tyreAt[1], tyreAt[2] + 0.02], tyreR * 0.42, 0.26, "z", 8));

  // Two pipes thrown across the top.
  for (let i = 0; i < 2; i++) {
    const pipe = cylinder([0, 0, 0], 0.08, sx * lerp(r, 0.55, 0.75), "x", 6);
    put("scrapSteel", turn(pipe, [0, lerp(r, -0.4, 0.4), lerp(r, -0.12, 0.12)], [0, 0, 0], [lerp(r, -0.3, 0.3), base + 0.08 + i * 0.12, lerp(r, -hz * 0.3, hz * 0.3)]));
  }

  // Plates leaning on the pile.
  for (let i = 0; i < 3; i++) {
    const plate = box([0, 0, 0], [lerp(r, 0.6, 0.9), 0.07, lerp(r, 0.45, 0.65)]);
    const at: V3 = [lerp(r, -hx * 0.5, hx * 0.5), base + lerp(r, 0.15, 0.35), lerp(r, -hz * 0.5, hz * 0.5)];
    put(i === 1 ? "deepRust" : "rustOrange", turn(plate, [lerp(r, -0.6, 0.6), r() * Math.PI, lerp(r, -0.6, 0.6)], [0, 0, 0], at));
  }

  return { intact: intact.pieces(), destroyed: flattened(sx, sz, r) };
};

const MAX_FLAT = 0.48; // under the 0.5 m a smashed pile may reach

function flattened(sx: number, sz: number, r: () => number) {
  const hx = sx / 2, hz = sz / 2;
  const lo: V3 = [-hx, 0, -hz], hi: V3 = [hx, MAX_FLAT, hz];
  const out = painter();
  const put = (paint: string, m: MeshData) => out.add(paint, fit(m, lo, hi));
  const spot = (): V3 => [lerp(r, -hx * 0.6, hx * 0.6), 0, lerp(r, -hz * 0.6, hz * 0.6)];

  const slab: V3 = [lerp(r, -0.2, 0.2), 0.2, lerp(r, -0.2, 0.2)];
  const onSlab = ([x, , z]: V3) => Math.abs(x - slab[0]) < sx * 0.25 && Math.abs(z - slab[2]) < sz * 0.25;
  put("deepRust", box([slab[0], slab[1] / 2, slab[2]], [sx * 0.6, slab[1], sz * 0.6], 0.06));
  put("frameNavy", turn(box([0, 0, 0], [hx * 0.8, 0.16, hz * 0.7]), [lerp(r, -0.08, 0.08), r() * Math.PI, lerp(r, -0.08, 0.08)], [0, 0, 0],
    [lerp(r, -0.3, 0.3), 0.3, lerp(r, -0.3, 0.3)]));

  // Crushed drums on the ground, one each paint.
  for (const paint of ["rustOrange", "scrapSteel"]) {
    const drum = squashY(cylinder([0, 0.3, 0], 0.3, 0.85, "x", 10), 0.5);
    const [x, , z] = spot();
    put(paint, turn(drum, [0, r() * Math.PI, 0], [0, 0, 0], [x, -0.15, z]));
  }
  const [tx, , tz] = spot();
  put("soot", cylinder([tx, 0.11, tz], 0.4, 0.22, "y", 10));
  for (let i = 0; i < 2; i++) {
    const [x, , z] = spot();
    put("scrapSteel", turn(cylinder([0, 0, 0], 0.08, sx * lerp(r, 0.4, 0.6), "x", 6), [0, r() * Math.PI, lerp(r, -0.05, 0.05)], [0, 0, 0], [x, 0.08, z]));
  }
  for (let i = 0; i < 3; i++) {
    const at = spot();
    const plate = turn(box([0, 0, 0], [lerp(r, 0.6, 0.9), 0.07, lerp(r, 0.45, 0.65)]), [lerp(r, -0.15, 0.15), r() * Math.PI, lerp(r, -0.15, 0.15)], [0, 0, 0], at);
    put(i === 1 ? "deepRust" : "rustOrange", settle(plate, onSlab(at) ? slab[1] - 0.04 : 0));
  }
  return out.pieces();
}
