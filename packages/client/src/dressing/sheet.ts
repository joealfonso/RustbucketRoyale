import { triangleCount } from "./builderChecks";
import { byPaint, Details, door, downpipe, glazedWindow, ladder, onFace, shutter, toWorld, vent, vines, type Face } from "./details";
import type { SurfaceKind } from "../paint/paintLook";
import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { sheetColumn } from "./sheetColumn";
import { crate } from "./crate";
import { sheetRoof } from "./sheetRoof";
import { box, merge, turn, type MeshData } from "./shapes";
import { beam, join, rib, span } from "./structure";

// Sizes in metres. Across the wall's thickness, from the plain face to the posted face: corrugation folding out of the
// core, the core taking whatever thickness is left (so the wall reads solid from every side), corrugation again, then
// the steel frame standing proud: I-section posts, the girts between them that the sheets are screwed to, an eaves
// gutter under the cap. The wall stands on a concrete curb.
const ribDepth = 0.1;
const ribWidth = 0.26;
const ribPitch = 0.55;
const plainInset = 0.04; // the plain face's folds stop short of the box so patches can sit over them
const patchDepth = 0.06;
const postDepth = 0.25;
const postWidth = 0.3;
const flange = 0.06;
const postSpacing = 3;
const railHeight = 0.25; // the cap along the top
const curbHeight = 0.3;
const gutterHeight = 0.16;
const girtHeight = 0.14;
const girtDepth = 0.1;
const endTrim = 0.1; // the flashing down each end of the wall, over the cut ends of the sheets
const shutterHeight = 4.2;

// Odds for the per-wall variations. Each one goes in its own bay between two posts, so they never pile up.
const doorChance = 0.45; // a steel door, on walls tall enough for one
const windowChance = 0.6; // a window or two in a shed wall, a row of high ones in a warehouse wall
const shutterChance = 0.5; // a roller shutter in a tall wall, sometimes jammed part open
const braceChance = 0.7; // cross-bracing in the end bays of a long wall, stiffening the frame
const ventChance = 0.4; // an exhaust vent high up, its dark intake behind the louvres
const pipeChance = 0.5; // a downpipe draining the gutter into a grate
const ladderChance = 0.25; // a fixed ladder to the top
const tearChance = 0.3; // a sheet ripped open on the plain face, its flap hanging, the dark core showing
const footRotChance = 0.4; // rust along the foot of the plain face, where rain splashes and puddles
const vineChance = 0.5;

const panelPaints = ["scrapSteel", "rustOrange"];
const patchPaints = ["deepRust", "frameNavy"];

// The sheet-metal kind covers every part of a shed and a warehouse: its walls, the roof slab over a warehouse, the
// columns holding that roof up, and crates on the floor. The box's shape says which it is.
export const sheet: KindBuilder = (b: DressBox): DressPiece[] => {
  const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
  const long = Math.max(sx, sz), short = Math.min(sx, sz);
  if (sy < 1.5 && short > 4) return sheetRoof(b);
  if (long <= 2.5 && sy > 2 * long) return sheetColumn(b);
  if (short >= 1.8) return crate(b);
  return wall(b);
};

interface Opening { u0: number; u1: number; y0: number; y1: number; side: 1 | -1 | 0 } // side 0: both faces

// A corrugated sheet-metal wall, built with its posted face towards +w, then turned to the face the seed picked and
// laid along whichever world axis the box is longer in.
function wall(b: DressBox): DressPiece[] {
  const random = rng(b.seed);
  const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
  const length = alongX ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
  const thickness = alongX ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
  const height = b.max[1] - b.min[1];
  const L = length / 2, T = thickness / 2;

  const panelPaint = panelPaints[Math.floor(random() * panelPaints.length)]!;
  const patchPaint = patchPaints[Math.floor(random() * patchPaints.length)]!;
  const postSide = random() < 0.5 ? 1 : -1; // which face carries the frame; the other is the plain face

  const panel: MeshData[] = [], steel: MeshData[] = [], patches: MeshData[] = [], concrete: MeshData[] = [], dark: MeshData[] = [], glass: MeshData[] = [];
  const plainFace = -T + plainInset, coreBack = plainFace + ribDepth, coreFront = T - postDepth, ribFront = coreFront + ribDepth;
  const ribTop = height - railHeight, postTop = ribTop - gutterHeight;
  const tall = height >= 6;

  concrete.push(span(-L, L, 0, curbHeight, -T, T));
  panel.push(span(-L + endTrim, L - endTrim, curbHeight, ribTop, coreBack, coreFront));
  steel.push(span(-L, L, ribTop, height, -T, T));
  // The end flashing is painted like the sheets: where two walls meet at a corner it is a whole metre of end face.
  for (const s of [-1, 1]) panel.push(span(s > 0 ? L - endTrim : -L, s > 0 ? L : -L + endTrim, curbHeight, ribTop, -T + 0.02, coreFront + ribDepth));
  steel.push(span(-L + endTrim, L - endTrim, postTop, ribTop, ribFront, T)); // the gutter, at the head of the posts

  // Posts about every postSpacing metres, one at each end. A tall wall may give up a middle post for a roller shutter
  // spanning the two bays beside it, its header carried on the posts either side.
  const count = Math.max(2, Math.round(length / postSpacing) + 1);
  let postU = Array.from({ length: count }, (_, i) => -L + endTrim + postWidth / 2 + i * ((length - 2 * endTrim - postWidth) / (count - 1)));
  const openings: Opening[] = [];
  const used = new Set<number>(); // bays (by index of their left post) already holding something
  let shutterAt: { u: number; width: number; open: number } | null = null;
  if (tall && count >= 4 && random() < shutterChance) {
    const drop = 1 + Math.floor(random() * (count - 2));
    const u0 = postU[drop - 1]! + postWidth / 2, u1 = postU[drop + 1]! - postWidth / 2;
    postU = postU.filter((_, i) => i !== drop);
    shutterAt = { u: (u0 + u1) / 2, width: u1 - u0 - 0.3, open: random() < 0.4 ? 0.8 + random() * 1.2 : 0 };
    used.add(drop - 1);
    openings.push({ u0: u0 + 0.01, u1: u1 - 0.01, y0: curbHeight, y1: curbHeight + shutterHeight + 0.5, side: 0 });
  }
  const bays = postU.slice(1).map((u, i) => ({ i, u: (u + postU[i]!) / 2, width: u - postU[i]! - postWidth }));
  const takeBay = (minWidth: number) => {
    const fits = bays.filter((bay) => !used.has(bay.i) && bay.width >= minWidth);
    if (fits.length === 0) return null;
    const bay = fits[Math.floor(random() * fits.length)]!;
    used.add(bay.i);
    return bay;
  };

  // Windows: in a warehouse wall a row of high ones in every other bay, in a shed wall one or two at eye height.
  const windows: { u: number; y: number; width: number; height: number }[] = [];
  if (ribTop >= 3.4 && random() < windowChance) {
    if (tall) {
      const first = Math.floor(random() * 2);
      for (const bay of bays) {
        if ((bay.i + first) % 2 !== 0 || used.has(bay.i) || bay.width < 1.6) continue;
        windows.push({ u: bay.u, y: ribTop - 1.5, width: Math.min(2.2, bay.width - 0.5), height: 1.2 });
        used.add(bay.i);
      }
    } else {
      const many = length > 10 && random() < 0.5 ? 2 : 1;
      for (let k = 0; k < many; k++) {
        const bay = takeBay(1.6);
        if (bay) windows.push({ u: bay.u, y: 2.1, width: Math.min(1.6, bay.width - 0.5), height: 1.1 });
      }
    }
  }
  for (const w of windows) openings.push({ u0: w.u - w.width / 2 - 0.08, u1: w.u + w.width / 2 + 0.08, y0: w.y - w.height / 2 - 0.1, y1: w.y + w.height / 2 + 0.08, side: 0 });
  // A door is hung over the folds, so it cuts none; it only keeps the girts out of its bay.
  const doorBay = height >= 2.8 && random() < doorChance ? takeBay(1.4) : null;
  const doorOnPosted = random() < 0.5;
  const doorWidth = doorBay ? Math.min(1.1, doorBay.width - 0.3) : 0;
  const girtBlocks = doorBay && doorOnPosted ? [...openings, { u0: doorBay.u - doorWidth / 2 - 0.1, u1: doorBay.u + doorWidth / 2 + 0.1, y0: 0, y1: curbHeight + 2.3, side: 1 as const }] : openings;

  // Posts: I-sections, front flange, web and back flange, on a base plate.
  for (const u of postU) {
    steel.push(
      span(u - postWidth / 2, u + postWidth / 2, curbHeight, postTop, T - flange, T),
      span(u - 0.05, u + 0.05, curbHeight, postTop, coreFront, T - flange),
      span(u - postWidth / 2, u + postWidth / 2, curbHeight, postTop, coreFront, coreFront + 0.05),
      span(u - postWidth / 2 - 0.08, u + postWidth / 2 + 0.08, curbHeight, curbHeight + 0.05, coreFront, T),
    );
  }
  // Girts between the posts, one row in a shed wall and two in a warehouse wall, broken where an opening is.
  const girtYs = tall ? [ribTop * 0.36, ribTop * 0.7] : [ribTop * 0.52];
  for (const bay of bays) {
    const a = postU[bay.i]! + postWidth / 2, c = postU[bay.i + 1]! - postWidth / 2;
    for (const gy of girtYs) {
      if (girtBlocks.some((o) => o.u1 > a && o.u0 < c && o.y0 < gy + girtHeight && o.y1 > gy - girtHeight)) continue;
      steel.push(span(a, c, gy - girtHeight / 2, gy + girtHeight / 2, ribFront, ribFront + girtDepth));
    }
  }
  // Cross-bracing in the end bays of a long wall, standing in front of the girts.
  if (length >= 10 && random() < braceChance) {
    for (const bay of [bays[0]!, bays[bays.length - 1]!]) {
      if (used.has(bay.i)) continue;
      used.add(bay.i);
      const a = postU[bay.i]! + postWidth / 2, c = postU[bay.i + 1]! - postWidth / 2, w = T - 0.035;
      steel.push(beam([a, curbHeight + 0.2, w], [c, postTop - 0.1, w], 0.08, 0.06), beam([c, curbHeight + 0.2, w], [a, postTop - 0.1, w], 0.08, 0.06));
    }
  }

  // Corrugation on both faces, cut round the openings. On the posted face, folds hidden inside a post are left out.
  const ribs = Math.max(2, Math.floor((length - 2 * endTrim) / ribPitch));
  const ribStep = (length - 2 * endTrim) / ribs;
  for (let i = 0; i < ribs; i++) {
    const u = -L + endTrim + (i + 0.5) * ribStep;
    for (const side of [-1, 1] as const) {
      if (side > 0 && postU.some((p) => Math.abs(p - u) < (postWidth + ribWidth) / 2)) continue;
      const top = side > 0 ? postTop : ribTop;
      for (const [y0, y1] of runs(u, curbHeight, top, openings.filter((o) => o.side === 0 || o.side === side))) {
        panel.push(rib(u, y0, y1, side > 0 ? coreFront : coreBack, side, ribWidth, ribDepth));
      }
    }
  }

  // Openings set into the core: windows on both faces, the shutter's slats on both and its guides on the posted face.
  for (const w of windows) {
    for (const side of [-1, 1] as const) {
      const g = glazedWindow(random, w.u, w.y, w.width, w.height, ribDepth);
      const face: Face = { at: side > 0 ? coreFront : coreBack, out: side };
      steel.push(onFace(g.frame, face)); dark.push(onFace(g.dark, face)); glass.push(onFace(g.glass, face));
    }
  }
  if (shutterAt) {
    for (const side of [-1, 1] as const) {
      const s = shutter(shutterAt.u, shutterAt.width, shutterHeight, shutterAt.open, ribDepth * 0.5);
      const face: Face = { at: side > 0 ? coreFront : coreBack, out: side };
      panel.push(onFace(lift(s.slats, curbHeight), face)); dark.push(onFace(lift(s.dark, curbHeight), face));
      if (side > 0) steel.push(onFace(lift(s.steel, curbHeight), face));
    }
  }

  // A few patched panels on the plain face, one more for every 8 m or so, over its folds.
  const patchCount = 1 + Math.floor(random() * (1 + length / 8));
  for (let i = 0; i < patchCount; i++) {
    const su = 1.2 + random() * 1.3, sy = Math.min(ribTop - curbHeight - 0.4, 1 + random() * 1.2);
    const u = -L + 0.3 + su / 2 + random() * Math.max(0, length - 0.6 - su);
    const y = curbHeight + 0.2 + sy / 2 + random() * Math.max(0, ribTop - curbHeight - 0.4 - sy);
    if (openings.some((o) => o.u1 > u - su / 2 && o.u0 < u + su / 2 && o.y1 > y - sy / 2 && o.y0 < y + sy / 2)) continue;
    patches.push(span(u - su / 2, u + su / 2, y - sy / 2, y + sy / 2, -T, -T + patchDepth));
  }

  // Everything above is built posted face towards +w; this turns it to the face the seed picked, then into the world.
  const local = (m: MeshData) => toWorld(postSide < 0 ? onFace(m, { at: 0, out: -1 }) : m, alongX, [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]);
  const base: DressPiece[] = [
    { paint: panelPaint, mesh: local(join(panel)) },
    { paint: "soot", mesh: local(join([...steel, ...dark])) },
    { paint: patchPaint, mesh: local(join(patches)) },
    { paint: "scrapSteel", mesh: local(join(concrete)), surface: "concrete" },
    { paint: "scrapSteel", mesh: local(join(glass)) },
  ];

  // The optional variations, while the triangle budget allows.
  const details = new Details(b, triangleCount(base));
  const posted: Face = { at: ribFront, out: 1 };
  const plain: Face = { at: -T + 0.06, out: -1 };
  const on = (paint: string, mesh: MeshData, face: Face, surface?: SurfaceKind | null): DressPiece =>
    (surface === undefined ? { paint, mesh: local(onFace(mesh, face)) } : { paint, mesh: local(onFace(mesh, face)), surface });
  if (doorBay) {
    // Lifted so its step stands on the curb.
    const d = door(doorBay.u, doorWidth, 2.1);
    const face = doorOnPosted ? posted : plain;
    details.add([on("soot", lift(merge(d.frame, d.step), curbHeight - 0.15), face), on(random() < 0.5 ? "frameNavy" : "deepRust", lift(d.panel, curbHeight - 0.15), face)]);
  }
  if (ribTop > 2.4 && random() < ventChance) {
    const bay = takeBay(1);
    if (bay) {
      const v = vent(bay.u, postTop - 0.5, Math.min(0.9, bay.width - 0.3), 0.5);
      details.add([on("soot", merge(v.frame, v.intake), posted)]);
    }
  }
  if (random() < pipeChance) {
    // From the gutter, down the posted face beside a post, into a grate on the curb.
    const p = postU[1 + Math.floor(random() * Math.max(1, postU.length - 2))]! + (random() < 0.5 ? -1 : 1) * (postWidth / 2 + 0.12);
    const pipe = downpipe(p, postTop - curbHeight + 0.05, 0.04, 0.1);
    details.add([on(random() < 0.5 ? "scrapSteel" : "rustOrange", lift(pipe.pipe, curbHeight), posted), on("soot", lift(pipe.brackets, curbHeight), posted)]);
  }
  if (height >= 3 && random() < ladderChance) {
    const bay = takeBay(0.8);
    if (bay) details.add([on("soot", ladder(bay.u, height - railHeight, postDepth - ribDepth - 0.08), posted)]);
  }
  if (random() < tearChance && length > 3) {
    // A tear: the dark core behind, a ragged second bite out of it, and the torn flap hanging from its top edge.
    const su = 0.8 + random() * 0.8, sy = Math.min(ribTop - 1.1, 0.9 + random() * 0.8);
    const u = -L + 0.6 + su / 2 + random() * Math.max(0, length - 1.2 - su), y = curbHeight + 0.4 + sy / 2 + random() * Math.max(0, ribTop - curbHeight - 0.8 - sy);
    const hole = merge(box([u, y, 0.015], [su, sy, 0.03]), box([u + su * 0.3, y - sy * 0.35, 0.015], [su * 0.5, sy * 0.4, 0.03]));
    const flap = turn(box([0, -sy * 0.3, 0.02], [su * 0.8, sy * 0.6, 0.04]), [0.35, 0, (random() - 0.5) * 0.4], [0, 0, 0], [u, y + sy / 2, 0.03]);
    if (!openings.some((o) => o.u1 > u - su / 2 && o.u0 < u + su / 2 && o.y1 > y - sy && o.y0 < y + sy / 2)) details.add([on("soot", hole, plain), on(panelPaint, flap, plain)]);
  }
  if (random() < footRotChance) {
    const su = Math.min(length - 0.4, 2 + random() * length * 0.6), sy = 0.3 + random() * 0.35;
    const u = -L + 0.2 + su / 2 + random() * Math.max(0, length - 0.4 - su);
    details.add([on("deepRust", box([u, curbHeight + sy / 2, 0.02], [su, sy, 0.04]), plain)]);
  }
  if (random() < vineChance) {
    const onPlain = random() < 0.6;
    const v = vines(random, -L + random() * length, 2, Math.min(ribTop, 2 + random() * (ribTop - 1.5)), -L, L);
    const face: Face = onPlain ? { at: -T + 0.02, out: -1 } : posted;
    details.add([on("darkMoss", v.stems, face, null), on("moss", v.leaves, face, null)]);
  }

  return byPaint([...base, ...details.pieces]);
}

const lift = (m: MeshData, y: number) => turn(m, [0, 0, 0], [0, 0, 0], [0, y, 0]);

// The stretches of one fold at `u` from y0 to y1 left after cutting out the openings it crosses.
function runs(u: number, y0: number, y1: number, openings: Opening[]): [number, number][] {
  let out: [number, number][] = [[y0, y1]];
  for (const o of openings) {
    if (o.u1 < u - ribWidth / 2 || o.u0 > u + ribWidth / 2) continue;
    out = out.flatMap(([a, c]): [number, number][] => {
      if (o.y1 <= a || o.y0 >= c) return [[a, c]];
      const left: [number, number][] = [[a, o.y0], [o.y1, c]];
      return left.filter(([p, q]) => q - p > 0.15);
    });
  }
  return out;
}
