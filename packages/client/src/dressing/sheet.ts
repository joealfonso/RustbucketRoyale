import { triangleCount } from "./builderChecks";
import { byPaint, Details, door, downpipe, ladder, onFace, toWorld, vent, vines, type Face } from "./details";
import type { SurfaceKind } from "../paint/paintLook";
import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { box, merge, turn, type MeshData, type V3 } from "./shapes";

// Sizes in metres. Across the wall's thickness, from the plain face to the posted face: a patch layer, ribs, the
// core panel, ribs again, then the posts standing proud. The core takes up whatever thickness is left, so the wall
// still reads solid from every side however thick its box is.
const ribDepth = 0.1;
const ribWidth = 0.15;
const ribSpacing = 0.5;
const plainInset = 0.04; // the plain face's ribs stop short of the box so patches can sit over them
const patchDepth = 0.12;
const postDepth = 0.25;
const postWidth = 0.3;
const postSpacing = 3;
const railHeight = 0.25;

// Odds for the per-wall variations. Each one goes in its own bay between two posts, so they never pile up.
const doorChance = 0.45; // a steel door, on walls tall enough for one
const ventChance = 0.4; // an exhaust vent high up, its dark intake behind the louvres
const pipeChance = 0.4; // a downpipe draining the top rail into a grate
const ladderChance = 0.25; // a fixed ladder to the top
const tearChance = 0.3; // a sheet ripped open on the plain face, its flap hanging, the dark core showing
const footRotChance = 0.4; // rust along the foot of the plain face, where rain splashes and puddles
const vineChance = 0.5;

const panelPaints = ["scrapSteel", "rustOrange"];
const patchPaints = ["deepRust", "frameNavy"];

// A corrugated sheet-metal wall. Built in a local frame (u along the wall, y up, w through it), then laid along
// whichever world axis the box is longer in.
export const sheet: KindBuilder = (b: DressBox): DressPiece[] => {
  const random = rng(b.seed);
  const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
  const length = alongX ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
  const thickness = alongX ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
  const height = b.max[1] - b.min[1];
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
  const L = length / 2, T = thickness / 2;

  const part = (u: number, y: number, w: number, su: number, sy: number, sw: number): MeshData =>
    alongX ? box([cx + u, y0 + y, cz + w] as V3, [su, sy, sw]) : box([cx + w, y0 + y, cz + u] as V3, [sw, sy, su]);

  const panelPaint = panelPaints[Math.floor(random() * panelPaints.length)]!;
  const patchPaint = patchPaints[Math.floor(random() * patchPaints.length)]!;
  const postSide = random() < 0.5 ? 1 : -1; // which face carries the posts; the other is the plain face

  const panel: MeshData[] = [];
  const steel: MeshData[] = [];
  const patches: MeshData[] = [];

  // Through the wall, in w measured towards the posted face.
  const plainFace = -T + plainInset;
  const coreBack = plainFace + ribDepth;
  const coreFront = T - postDepth;
  const ribTop = height - railHeight;
  const at = (w: number) => postSide * w;

  panel.push(part(0, ribTop / 2, at((coreBack + coreFront) / 2), length, ribTop, coreFront - coreBack));

  // Posts: one at each end and evenly between, about every postSpacing metres.
  const posts = Math.max(2, Math.round(length / postSpacing) + 1);
  const postU = Array.from({ length: posts }, (_, i) => -L + postWidth / 2 + i * ((length - postWidth) / (posts - 1)));
  for (const u of postU) steel.push(part(u, height / 2, at(T - postDepth / 2), postWidth, height, postDepth));
  steel.push(part(0, height - railHeight / 2, 0, length, railHeight, thickness));

  // Corrugation on both faces. On the posted face, ribs hidden inside a post are left out.
  const ribs = Math.max(2, Math.floor(length / ribSpacing));
  for (let i = 0; i < ribs; i++) {
    const u = -L + (i + 0.5) * (length / ribs);
    panel.push(part(u, ribTop / 2, at(plainFace + ribDepth / 2), ribWidth, ribTop, ribDepth));
    if (postU.some((p) => Math.abs(p - u) < (postWidth + ribWidth) / 2)) continue;
    panel.push(part(u, ribTop / 2, at(coreFront + ribDepth / 2), ribWidth, ribTop, ribDepth));
  }

  // A few patched panels, one more for every 8 m or so, on either face, standing just proud of the ribs.
  const patchCount = 1 + Math.floor(random() * (1 + length / 8));
  for (let i = 0; i < patchCount; i++) {
    const su = 1.2 + random() * 1.3, sy = Math.min(ribTop - 0.4, 1 + random() * 1.2);
    const u = -L + su / 2 + random() * Math.max(0, length - su);
    const y = 0.2 + sy / 2 + random() * Math.max(0, ribTop - 0.4 - sy);
    const onPlain = random() < 0.5;
    const back = onPlain ? -T : coreFront + ribDepth - patchDepth + plainInset;
    patches.push(part(u, y, at(back + patchDepth / 2), su, sy, patchDepth));
  }

  // The variations. The posted face's details sit on its ribs, between posts; the plain face's on its patch layer.
  const local = (m: MeshData) => toWorld(m, alongX, [cx, y0, cz]);
  const posted: Face = { at: at(coreFront + ribDepth), out: postSide as 1 | -1 };
  const plain: Face = { at: at(-T + 0.06), out: -postSide as 1 | -1 };
  const room = postDepth - ribDepth; // in front of the posted face's ribs, behind the posts' faces
  const base: DressPiece[] = [
    { paint: panelPaint, mesh: merge(...panel) },
    { paint: "soot", mesh: merge(...steel) },
    { paint: patchPaint, mesh: merge(...patches) },
  ];
  const details = new Details(b, triangleCount(base));
  const on = (paint: string, mesh: MeshData, face: Face, surface?: SurfaceKind | null): DressPiece =>
    (surface === undefined ? { paint, mesh: local(onFace(mesh, face)) } : { paint, mesh: local(onFace(mesh, face)), surface });
  const bays = postU.slice(1).map((u, i) => ({ u: (u + postU[i]!) / 2, width: u - postU[i]! - postWidth }));
  // Each detail takes a bay at random; with no bay left it is skipped.
  const free = bays.map((_, i) => i);
  const takeBay = (minWidth: number) => {
    const fits = free.filter((i) => bays[i]!.width >= minWidth);
    if (fits.length === 0) return null;
    const i = fits[Math.floor(random() * fits.length)]!;
    free.splice(free.indexOf(i), 1);
    return bays[i]!;
  };
  if (height >= 2.8 && random() < doorChance) {
    const bay = takeBay(1.4);
    if (bay) {
      const d = door(bay.u, Math.min(1.1, bay.width - 0.3), 2.1);
      const face = random() < 0.5 ? posted : plain;
      details.add([on("soot", merge(d.frame, d.step), face), on(random() < 0.5 ? "frameNavy" : "deepRust", d.panel, face)]);
    }
  }
  if (ribTop > 2.4 && random() < ventChance) {
    const bay = takeBay(1);
    if (bay) {
      const v = vent(bay.u, ribTop - 0.6, Math.min(0.9, bay.width - 0.3), 0.5);
      details.add([on("soot", merge(v.frame, v.intake), posted)]);
    }
  }
  if (random() < pipeChance) {
    const bay = takeBay(0.6);
    if (bay) {
      const p = downpipe(bay.u + (random() - 0.5) * (bay.width - 0.4), height - railHeight, 0.05, 0.01);
      details.add([on(random() < 0.5 ? "scrapSteel" : "rustOrange", p.pipe, posted), on("soot", p.brackets, posted)]);
    }
  }
  if (height >= 3 && random() < ladderChance) {
    const bay = takeBay(0.8);
    if (bay) details.add([on("soot", ladder(bay.u, height - railHeight, room - 0.08), posted)]);
  }
  if (random() < tearChance && length > 3) {
    // A tear: the dark core behind, a ragged second bite out of it, and the torn flap hanging from its top edge.
    const su = 0.8 + random() * 0.8, sy = Math.min(ribTop - 0.8, 0.9 + random() * 0.8);
    const u = -L + 0.6 + su / 2 + random() * Math.max(0, length - 1.2 - su), y = 0.4 + sy / 2 + random() * Math.max(0, ribTop - 0.8 - sy);
    const hole = merge(box([u, y, 0.015], [su, sy, 0.03]), box([u + su * 0.3, y - sy * 0.35, 0.015], [su * 0.5, sy * 0.4, 0.03]));
    const flap = turn(box([0, -sy * 0.3, 0.02], [su * 0.8, sy * 0.6, 0.04]), [0.35, 0, (random() - 0.5) * 0.4], [0, 0, 0], [u, y + sy / 2, 0.03]);
    details.add([on("soot", hole, plain), on(panelPaint, flap, plain)]);
  }
  if (random() < footRotChance) {
    const su = Math.min(length - 0.4, 2 + random() * length * 0.6), sy = 0.3 + random() * 0.35;
    const u = -L + 0.2 + su / 2 + random() * Math.max(0, length - 0.4 - su);
    details.add([on("deepRust", box([u, sy / 2, 0.02], [su, sy, 0.04]), plain)]);
  }
  if (random() < vineChance) {
    const onPlain = random() < 0.6;
    const v = vines(random, -L + random() * length, 2, Math.min(ribTop, 2 + random() * (ribTop - 1.5)), -L, L);
    const face: Face = onPlain ? { at: at(-T + 0.02), out: -postSide as 1 | -1 } : posted;
    details.add([on("darkMoss", v.stems, face, null), on("moss", v.leaves, face, null)]);
  }

  return byPaint([...base, ...details.pieces]);
};
