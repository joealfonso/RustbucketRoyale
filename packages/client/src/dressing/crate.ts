import { toWorld } from "./details";
import { rng, type DressBox, type DressPiece } from "./kinds";
import type { MeshData, V3 } from "./shapes";
import { beam, join, span } from "./structure";

// A block on a shed or warehouse floor: a wooden shipping crate (boards, a batten down every edge, a brace across
// each side, two steel straps holding the lid on) or a steel stillage (a cage of corner posts and rails round a
// solid load, on skids for the forklift). Both are solid to the edges of the box, as the cover they are.

const batten = 0.1;
const strap = 0.08;
const crateChance = 0.65;
const wood = "#7A5A2E";

export function crate(b: DressBox): DressPiece[] {
  const random = rng(b.seed);
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, H = y1 - y0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const at = (m: MeshData): MeshData => toWorld(m, true, [cx, y0, cz]);
  return random() < crateChance ? woodenCrate(hx, hz, H, at) : stillage(random, hx, hz, H, at);
}

function woodenCrate(hx: number, hz: number, H: number, at: (m: MeshData) => MeshData): DressPiece[] {
  const t = batten, inset = 0.04;
  const boards: MeshData[] = [span(-hx + inset, hx - inset, 0, H - inset, -hz + inset, hz - inset)];
  const frame: MeshData[] = [];
  // A batten down every vertical edge and round the top and bottom of every side.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push(span(sx > 0 ? hx - t : -hx, sx > 0 ? hx : -hx + t, 0, H, sz > 0 ? hz - t : -hz, sz > 0 ? hz : -hz + t));
  for (const y of [0, H - t]) {
    for (const sz of [-1, 1]) frame.push(span(-hx + t, hx - t, y, y + t, sz > 0 ? hz - t : -hz, sz > 0 ? hz : -hz + t));
    for (const sx of [-1, 1]) frame.push(span(sx > 0 ? hx - t : -hx, sx > 0 ? hx : -hx + t, y, y + t, -hz + t, hz - t));
  }
  // A brace corner to corner across each side, the way it keeps the crate square, flush with the battens.
  for (const sz of [-1, 1]) {
    const w = sz * (hz - inset / 2 - 0.005);
    frame.push(beam([-hx + t, t, w], [hx - t, H - t, w] as V3, inset, t * 0.9));
  }
  for (const sx of [-1, 1]) {
    const u = sx * (hx - inset / 2 - 0.005);
    frame.push(beam([u, t, hz - t], [u, H - t, -hz + t] as V3, inset, t * 0.9));
  }
  // The steel straps over the lid and down two sides.
  const steel: MeshData[] = [];
  for (const k of [-1, 1]) {
    const u = k * hx * 0.5;
    steel.push(span(u - strap / 2, u + strap / 2, H - 0.01, H + 0.01, -hz, hz));
    for (const sz of [-1, 1]) steel.push(span(u - strap / 2, u + strap / 2, 0.1, H, sz > 0 ? hz - 0.005 : -hz - 0.015, sz > 0 ? hz + 0.015 : -hz + 0.005));
  }
  return [
    { paint: wood, mesh: at(join([...boards, ...frame])), surface: "wood" },
    { paint: "soot", mesh: at(join(steel)) },
  ];
}

function stillage(random: () => number, hx: number, hz: number, H: number, at: (m: MeshData) => MeshData): DressPiece[] {
  const post = 0.12, skid = 0.16;
  const load: MeshData[] = [span(-hx + 0.08, hx - 0.08, skid, H - 0.06, -hz + 0.08, hz - 0.08)];
  const cage: MeshData[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cage.push(span(sx > 0 ? hx - post : -hx, sx > 0 ? hx : -hx + post, 0, H, sz > 0 ? hz - post : -hz, sz > 0 ? hz : -hz + post));
  // Skids underneath for the forks, with the dark gap between them.
  for (const sz of [-1, 0, 1]) cage.push(span(-hx + post, hx - post, 0, skid, sz * (hz - 0.2) - 0.1, sz * (hz - 0.2) + 0.1));
  const dark = [span(-hx + post, hx - post, 0.01, skid - 0.01, -hz + 0.1, hz - 0.1)];
  // Rails round the sides at a third and two thirds of the height, and round the top.
  for (const y of [H / 3, (2 * H) / 3, H - 0.05]) {
    for (const sz of [-1, 1]) cage.push(span(-hx + post, hx - post, y - 0.04, y + 0.04, sz > 0 ? hz - 0.08 : -hz, sz > 0 ? hz : -hz + 0.08));
    for (const sx of [-1, 1]) cage.push(span(sx > 0 ? hx - 0.08 : -hx, sx > 0 ? hx : -hx + 0.08, y - 0.04, y + 0.04, -hz + post, hz - post));
  }
  return [
    { paint: random() < 0.5 ? "frameNavy" : "deepRust", mesh: at(join(cage)) },
    { paint: random() < 0.5 ? "scrapSteel" : "rustOrange", mesh: at(join(load)) },
    { paint: "soot", mesh: at(join(dark)) },
  ];
}
