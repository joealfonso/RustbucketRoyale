import { toWorld } from "./details";
import { rng, type DressBox, type DressPiece } from "./kinds";
import { box, type MeshData } from "./shapes";
import { join, rod, span } from "./structure";

// A warehouse column holding up the roof: a steel stanchion cased in concrete on a footing, a steel cap plate the
// roof beams bear on, and steel angle guards painted yellow round its foot, where forklifts kept hitting it. Square
// and solid to the edges of its box, so it never looks thinner than the cover it is.

const footing = 0.45;
const caseInset = 0.06;
const cap = 0.14;
const guardHeight = 1.4;
const guard = 0.26; // each leg of an angle guard
const guardThick = 0.05;

export function sheetColumn(b: DressBox): DressPiece[] {
  const random = rng(b.seed);
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, H = y1 - y0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const at = (m: MeshData): MeshData => toWorld(m, true, [cx, y0, cz]);

  const concrete: MeshData[] = [span(-hx, hx, 0, footing, -hz, hz)];
  concrete.push(box([0, (footing + H - cap) / 2, 0], [2 * (hx - caseInset), H - cap - footing, 2 * (hz - caseInset)], 0.05));
  const steel: MeshData[] = [span(-hx, hx, H - cap, H, -hz, hz)];
  // Bolts through the cap plate into the beam above, and anchor bolts into the footing.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    steel.push(rod(sx * (hx - 0.18), H - cap - 0.06, H - cap, sz * (hz - 0.18), 0.04));
    steel.push(rod(sx * (hx - 0.03 - caseInset), footing, footing + 0.08, sz * (hz - 0.2), 0.035));
  }
  const yellow: MeshData[] = [];
  const guarded = random() < 0.75;
  if (guarded) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ex = sx * hx, ez = sz * hz, g0 = footing, g1 = footing + guardHeight;
      yellow.push(span(Math.min(ex, ex - sx * guard), Math.max(ex, ex - sx * guard), g0, g1, Math.min(ez, ez - sz * guardThick), Math.max(ez, ez - sz * guardThick)));
      yellow.push(span(Math.min(ex, ex - sx * guardThick), Math.max(ex, ex - sx * guardThick), g0, g1, Math.min(ez, ez - sz * guard), Math.max(ez, ez - sz * guard)));
    }
  }
  const pieces: DressPiece[] = [
    { paint: random() < 0.5 ? "warmLight" : "scrapSteel", mesh: at(join(concrete)), surface: "concrete" },
    { paint: "soot", mesh: at(join(steel)) },
  ];
  if (guarded) pieces.push({ paint: "sparkYellow", mesh: at(join(yellow)) });
  return pieces;
}
