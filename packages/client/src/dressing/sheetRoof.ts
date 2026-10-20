import { rng, type DressBox, type DressPiece } from "./kinds";
import { toWorld } from "./details";
import type { MeshData } from "./shapes";
import { join, roofRib, span } from "./structure";

// The roof slab over a warehouse, as a real roof: corrugated sheets running across it on a deck, a fascia and gutter
// along the long edges, skylights let into the sheets (some broken through, dark beneath), and under it the steel
// that carries it, I-section rafters across the span and purlins along it, which is what you see looking up from
// inside. The folds' crests are the box top, so a mech on the roof stands on them.

const deckThick = 0.2; // the sheets lie on it; the steel hangs below
const ribDepth = 0.12;
const ribWidth = 0.32;
const ribPitch = 0.6;
const fascia = 0.14;
const rafterSpacing = 6;
const purlinSpacing = 1.6;
const skylightChance = 0.8;
const brokenSkylight = 0.35;

export function sheetRoof(b: DressBox): DressPiece[] {
  const random = rng(b.seed);
  const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
  const length = alongX ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
  const width = alongX ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
  const height = b.max[1] - b.min[1];
  const L = length / 2, W = width / 2;
  const top = height - ribDepth;

  const sheets: MeshData[] = [], steel: MeshData[] = [], dark: MeshData[] = [], glass: MeshData[] = [];
  const inner = W - fascia;
  sheets.push(span(-L + fascia, L - fascia, top - deckThick, top, -inner, inner));

  // Skylights: a strip across the span every few bays, each framed, whole or broken through.
  const lights: { u0: number; u1: number; w0: number; w1: number }[] = [];
  if (random() < skylightChance) {
    const count = Math.max(1, Math.floor(length / 10));
    for (let i = 0; i < count; i++) {
      const u = -L + (i + 0.5) * (length / count) + (random() - 0.5) * 2, half = 0.9;
      for (const side of [-1, 1]) {
        const w0 = side < 0 ? -inner + 2 : 1, w1 = side < 0 ? -1 : inner - 2;
        if (w1 - w0 < 2) continue;
        lights.push({ u0: u - half, u1: u + half, w0, w1 });
        steel.push(span(u - half - 0.1, u + half + 0.1, top, height - 0.02, w0 - 0.1, w0), span(u - half - 0.1, u + half + 0.1, top, height - 0.02, w1, w1 + 0.1));
        steel.push(span(u - half - 0.1, u - half, top, height - 0.02, w0, w1), span(u + half, u + half + 0.1, top, height - 0.02, w0, w1));
        if (random() < brokenSkylight) dark.push(span(u - half, u + half, top, top + 0.01, w0, w1));
        else glass.push(span(u - half, u + half, top + 0.04, top + 0.07, w0, w1));
      }
    }
  }
  // The folds run across the roof from gutter to gutter, stopping at a skylight.
  const ribs = Math.max(2, Math.floor((length - 2 * fascia) / ribPitch));
  for (let i = 0; i < ribs; i++) {
    const u = -L + fascia + (i + 0.5) * ((length - 2 * fascia) / ribs);
    let from = -inner;
    for (const l of lights.filter((l) => u + ribWidth / 2 > l.u0 - 0.1 && u - ribWidth / 2 < l.u1 + 0.1).sort((a, c) => a.w0 - c.w0)) {
      if (l.w0 - 0.1 - from > 0.2) sheets.push(roofRib(u, from, l.w0 - 0.1, top, ribWidth, height - top));
      from = l.w1 + 0.1;
    }
    if (inner - from > 0.2) sheets.push(roofRib(u, from, inner, top, ribWidth, height - top));
  }

  // The edges: a fascia with the gutter behind it along each long side, a barge board across each end.
  for (const s of [-1, 1]) {
    steel.push(span(-L, L, top - deckThick - 0.1, height, s > 0 ? W - 0.04 : -W, s > 0 ? W : -W + 0.04));
    steel.push(span(-L, L, top - deckThick, top - 0.02, s > 0 ? inner : -W + 0.04, s > 0 ? W - 0.04 : -inner));
    steel.push(span(s > 0 ? L - fascia : -L, s > 0 ? L : -L + fascia, top - deckThick - 0.1, height, -W + 0.04, W - 0.04));
  }
  // Underneath: rafters across the span, I-sections, and purlins along it resting on them.
  const under = top - deckThick;
  const rafters = Math.max(2, Math.round(length / rafterSpacing) + 1);
  for (let i = 0; i < rafters; i++) {
    const u = -L + fascia + 0.15 + i * ((length - 2 * fascia - 0.3) / (rafters - 1));
    steel.push(span(u - 0.15, u + 0.15, 0, 0.05, -inner, inner), span(u - 0.035, u + 0.035, 0.05, under, -inner, inner));
  }
  const purlins = Math.max(2, Math.floor((2 * inner) / purlinSpacing));
  for (let i = 0; i < purlins; i++) {
    const w = -inner + (i + 0.5) * ((2 * inner) / purlins);
    steel.push(span(-L + fascia, L - fascia, under - 0.14, under, w - 0.05, w + 0.05));
  }

  const local = (m: MeshData) => toWorld(m, alongX, [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]);
  return [
    { paint: random() < 0.5 ? "scrapSteel" : "rustOrange", mesh: local(join(sheets)) },
    { paint: "soot", mesh: local(join([...steel, ...dark])) },
    { paint: "scrapSteel", mesh: local(join(glass)) },
  ].filter((p) => p.mesh.indices.length > 0);
}
