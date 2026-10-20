import { triangleCount } from "./builderChecks";
import { byPaint, Details, downpipe, ladder, onFace, toWorld, vines, type Face } from "./details";
import type { SurfaceKind } from "../paint/paintLook";
import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { box, cylinder, merge, type MeshData } from "./shapes";
import { beam, span } from "./structure";

// A squat concrete tower block. The windows are not cut holes: a dark core fills the box a little way in, and a
// concrete grid of floor slabs and piers stands in front of it, so wherever the grid leaves a gap you see a dark,
// recessed window slot. That is a handful of boxes for any number of windows. Corner pilasters and floor ledges stand
// proud of the grid, and a proud rim bands the top storey. Mechs stand on the box top, so the rim's top is the box top
// and the deck sits just a hand's width below it: enough room for a sunk hatch and vents, too little to look like
// anyone is floating. Nothing goes above the box.

const CORE_INSET = 0.35; // the dark core, back from the box face
const GRID_INSET = 0.1; // the concrete grid; windows are CORE_INSET - GRID_INSET deep
const LEDGE_INSET = 0.02;
const LEDGE_HEIGHT = 0.25;
const FLOOR_HEIGHT = 3.2;
const RIM_HEIGHT = 0.6; // the band round the top storey
const RIM_THICK = 0.35;
const DECK_DROP = 0.12; // deck below the box top; mechs stand on the box top, so this must stay small
const DETAIL_GAP = 0.02; // roof details stop this far under the rim top, so their tops never fight with it
// The per-tower variations, so no two blocks look alike. Each is kept only while the tower stays under TRIANGLE_CAP.
const TRIANGLE_CAP = 3600;
const GLAZED_SHARE = 0.4; // windows still holding their steel glazing bars, some panes whole
const BRACED_CHANCE = 0.7; // steel cross-bracing bolted over one face, holding the cracked block together
const BOARDED_SHARE = 0.15; // windows boarded over with a plate, where someone kept the weather out
const MAX_BOARDED = 8;
const COOLER_CHANCE = 0.5; // an air-conditioning box set in a window, a fan grille on its front
const PIPE_CHANCE = 0.7; // a downpipe draining the deck through the rim, down a corner to a grate
const LADDER_CHANCE = 0.4; // a fixed ladder from the ground to the underside of the rim
const VINE_CHANCE = 0.45;

export const tower: KindBuilder = (b: DressBox): DressPiece[] => {
  const r = rng(b.seed);
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  const sx = x1 - x0, sz = z1 - z0, height = y1 - y0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const deck = height - DECK_DROP, rimBase = height - RIM_HEIGHT;
  const pilaster = Math.min(1, Math.max(0.5, Math.min(sx, sz) * 0.06));

  // A box from its corners, given as offsets from the box's own floor centre.
  const slab = (ax: number, bx: number, ay: number, by: number, az: number, bz: number, bevel = 0) =>
    box([cx + (ax + bx) / 2, y0 + (ay + by) / 2, cz + (az + bz) / 2], [bx - ax, by - ay, bz - az], bevel);
  const hx = sx / 2, hz = sz / 2;

  const body: MeshData[] = [], dark: MeshData[] = [], roof: MeshData[] = [];
  // The core stops short of the deck so its top never fights with the deck's.
  dark.push(slab(-hx + CORE_INSET, hx - CORE_INSET, 0, deck - 0.05, -hz + CORE_INSET, hz - CORE_INSET));

  // Floors: a slab between each row of windows (the bottom one is the plinth, the top one carries the deck).
  const floors = Math.max(1, Math.round(deck / FLOOR_HEIGHT));
  const floorHeight = deck / floors;
  const sill = 0.3 + r() * 0.08, head = 0.72 + r() * 0.06; // of a floor's height
  const gx0 = -hx + GRID_INSET, gx1 = hx - GRID_INSET, gz0 = -hz + GRID_INSET, gz1 = hz - GRID_INSET;
  let below = 0;
  for (let f = 0; f < floors; f++) {
    body.push(slab(gx0, gx1, below, f * floorHeight + sill * floorHeight, gz0, gz1));
    below = f * floorHeight + head * floorHeight;
    if (f > 0) {
      const ly = f * floorHeight;
      body.push(slab(-hx + LEDGE_INSET, hx - LEDGE_INSET, ly - LEDGE_HEIGHT / 2, ly + LEDGE_HEIGHT / 2, -hz + LEDGE_INSET, hz - LEDGE_INSET));
    }
  }
  body.push(slab(gx0, gx1, below, deck, gz0, gz1));

  // Piers between window columns, each a slab right through the block so one box serves both opposite faces.
  const bay = 2 + r() * 0.6, windowShare = 0.45 + r() * 0.15;
  // Each call also lists its window openings (from, to along the face), for the variations below.
  const piers = (span: number, place: (a: number, c: number) => MeshData): [number, number][] => {
    const inner = span / 2 - pilaster;
    const count = Math.max(1, Math.floor((inner * 2) / bay));
    const step = (inner * 2) / count, opening = step * windowShare;
    const openings: [number, number][] = [];
    let at = -inner;
    for (let i = 0; i < count; i++) {
      const left = -inner + step * i + (step - opening) / 2;
      body.push(place(at, left));
      openings.push([left, left + opening]);
      at = left + opening;
    }
    body.push(place(at, inner));
    return openings;
  };
  // Up to the top slab only, so they don't share its top face.
  const alongXOpenings = piers(sx, (a, c) => slab(a, c, 0, below, gz0, gz1));
  const alongZOpenings = piers(sz, (a, c) => slab(gx0, gx1, 0, below, a, c));

  // Corner pilasters, up to the rim.
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const ax = px < 0 ? -hx : hx - pilaster, az = pz < 0 ? -hz : hz - pilaster;
    body.push(slab(ax, ax + pilaster, 0, rimBase, az, az + pilaster, 0.05));
  }

  // The rim: a proud band round the top storey whose top is the box top, standing a hand's width above the deck.
  const ri = LEDGE_INSET, rt = RIM_THICK;
  body.push(
    slab(-hx + ri, hx - ri, rimBase, height, -hz + ri, -hz + ri + rt),
    slab(-hx + ri, hx - ri, rimBase, height, hz - ri - rt, hz - ri),
    slab(-hx + ri, -hx + ri + rt, rimBase, height, -hz + ri + rt, hz - ri - rt),
    slab(hx - ri - rt, hx - ri, rimBase, height, -hz + ri + rt, hz - ri - rt),
  );

  // Low roof details sunk between deck and rim top: a hatch and a few vents, placed by seed.
  const room = { x: hx - ri - rt - 0.2, z: hz - ri - rt - 0.2 };
  const top = height - DETAIL_GAP;
  const spot = (halfX: number, halfZ: number): [number, number] => [
    (r() * 2 - 1) * Math.max(0, room.x - halfX), (r() * 2 - 1) * Math.max(0, room.z - halfZ),
  ];
  const hatch = Math.min(1.2, room.x, room.z);
  const [hxAt, hzAt] = spot(hatch / 2, hatch / 2);
  roof.push(slab(hxAt - hatch / 2, hxAt + hatch / 2, deck, top, hzAt - hatch / 2, hzAt + hatch / 2, 0.03));
  const vents = 2 + Math.floor(r() * 2);
  for (let i = 0; i < vents; i++) {
    const w = 0.4 + r() * 0.3, d = 0.4 + r() * 0.3;
    const [vx, vz] = spot(w / 2, d / 2);
    roof.push(slab(vx - w / 2, vx + w / 2, deck, top, vz - d / 2, vz + d / 2));
  }

  const base: DressPiece[] = [
    { paint: r() < 0.5 ? "warmLight" : "scrapSteel", mesh: merge(...body), surface: "concrete" },
    { paint: "soot", mesh: merge(...dark) },
    { paint: r() < 0.5 ? "rustOrange" : "frameNavy", mesh: merge(...roof) },
  ];

  // The variations, on the four faces. A face is (u along it, y up, w out of it); w = 0 is set on the box face, the
  // grid face or the core, depending on how deep the detail sits, and nothing reaches past the box face.
  const details = new Details(b, triangleCount(base), TRIANGLE_CAP);
  const faces = [
    { alongX: true, half: hz, span: sx, openings: alongXOpenings, out: -1 as const },
    { alongX: true, half: hz, span: sx, openings: alongXOpenings, out: 1 as const },
    { alongX: false, half: hx, span: sz, openings: alongZOpenings, out: -1 as const },
    { alongX: false, half: hx, span: sz, openings: alongZOpenings, out: 1 as const },
  ];
  // A face frame `depth` metres behind the box face.
  const put = (f: (typeof faces)[number], depth: number, paint: string, mesh: MeshData, surface?: SurfaceKind | null): DressPiece => {
    const piece: DressPiece = { paint, mesh: toWorld(onFace(mesh, { at: f.out * (f.half - depth), out: f.out } as Face), f.alongX, [cx, y0, cz]) };
    if (surface !== undefined) piece.surface = surface;
    return piece;
  };
  const windows = faces.flatMap((f, fi) => f.openings.flatMap(([a, c]) => Array.from({ length: floors }, (_, floor) => ({ fi, a, c, floor }))));
  // Every window has a sill standing out of the grid to shed the rain; some still have their glazing bars.
  const sills: DressPiece[] = [], glazing: DressPiece[] = [];
  for (const w of windows) {
    const ys = w.floor * floorHeight + sill * floorHeight, yh = w.floor * floorHeight + head * floorHeight;
    sills.push(put(faces[w.fi]!, GRID_INSET, base[0]!.paint, span(w.a - 0.1, w.c + 0.1, ys - 0.1, ys + 0.02, 0, 0.08), "concrete"));
    if (r() >= GLAZED_SHARE) continue;
    const mid = (w.a + w.c) / 2, ym = ys + (yh - ys) * 0.62;
    const bars = merge(span(mid - 0.04, mid + 0.04, ys, yh, 0, 0.06), span(w.a, w.c, ym - 0.04, ym + 0.04, 0, 0.06));
    const panes = [[w.a, mid - 0.04, ys, ym - 0.04], [mid + 0.04, w.c, ys, ym - 0.04], [w.a, mid - 0.04, ym + 0.04, yh], [mid + 0.04, w.c, ym + 0.04, yh]]
      .filter(() => r() < 0.45).map(([a, c, y0, y1]) => span(a!, c!, y0!, y1!, -0.02, 0));
    glazing.push(put(faces[w.fi]!, CORE_INSET - 0.08, "soot", bars));
    if (panes.length > 0) glazing.push(put(faces[w.fi]!, CORE_INSET - 0.08, "scrapSteel", merge(...panes)));
  }
  details.add(sills);
  details.add(glazing);
  const bracedFace = Math.floor(r() * faces.length);
  for (const fi of [bracedFace, bracedFace ^ 1]) {
    // Flat steel straps corner to corner across two storeys at a time, bolted through gusset plates at each end; the
    // face opposite sometimes got the same.
    if (r() >= (fi === bracedFace ? BRACED_CHANCE : BRACED_CHANCE * 0.5)) continue;
    const f = faces[fi]!;
    const lo = -f.span / 2 + pilaster + 0.15, hi = f.span / 2 - pilaster - 0.15;
    const straps: MeshData[] = [];
    for (let floor = 0; floor + 2 <= floors; floor += 2) {
      const y0 = floor * floorHeight + 0.3, y1 = (floor + 2) * floorHeight - 0.3;
      straps.push(beam([lo, y0, 0.04], [hi, y1, 0.04], 0.07, 0.24), beam([hi, y0, 0.04], [lo, y1, 0.04], 0.07, 0.24));
      for (const [u, y] of [[lo, y0], [hi, y0], [lo, y1], [hi, y1]] as const) straps.push(span(u - 0.25, u + 0.25, y - 0.25, y + 0.25, 0, 0.05));
    }
    if (straps.length > 0) details.add([put(f, GRID_INSET, "deepRust", merge(...straps))]);
  }
  // Boarded windows: a plate over the slot on the grid face, two planks nailed across it.
  const boardPaint = r() < 0.5 ? "deepRust" : "rustOrange";
  let boarded = 0;
  for (const w of windows) {
    if (r() >= BOARDED_SHARE || boarded >= MAX_BOARDED) continue;
    const y0w = w.floor * floorHeight + sill * floorHeight, y1w = w.floor * floorHeight + head * floorHeight;
    const plate = box([(w.a + w.c) / 2, (y0w + y1w) / 2, 0.02], [w.c - w.a + 0.16, y1w - y0w + 0.12, 0.04]);
    const plank = box([(w.a + w.c) / 2, (y0w + y1w) / 2, 0.06], [w.c - w.a + 0.24, 0.18, 0.04]);
    if (details.add([put(faces[w.fi]!, GRID_INSET, boardPaint, plate), put(faces[w.fi]!, GRID_INSET, "#7A5A2E", plank, "wood")])) boarded++;
  }
  if (r() < COOLER_CHANCE && windows.length > 0) {
    // An air conditioner sat on a sill in the window recess, its fan grille facing out, its dark intake round it.
    const w = windows[Math.floor(r() * windows.length)]!;
    const width = Math.min(0.9, (w.c - w.a) * 0.6), tall = Math.min(0.6, (head - sill) * floorHeight * 0.6);
    const u = (w.a + w.c) / 2, ys = w.floor * floorHeight + sill * floorHeight;
    const unit = box([u, ys + tall / 2, 0.12], [width, tall, 0.22]);
    const fan = cylinder([u, ys + tall / 2, 0.235], tall * 0.35, 0.02, "z", 8);
    details.add([put(faces[w.fi]!, CORE_INSET, "paintWhite", unit), put(faces[w.fi]!, CORE_INSET, "soot", fan)]);
  }
  const face = faces[Math.floor(r() * faces.length)]!;
  if (r() < PIPE_CHANCE) {
    // Next to a corner pilaster, inside the grid's inset so it never stands past the box face.
    const corner = r() < 0.5 ? -1 : 1;
    const p = downpipe(corner * (face.span / 2 - pilaster - 0.18), rimBase, 0.05, 0);
    details.add([put(face, GRID_INSET + 0.02, r() < 0.5 ? "scrapSteel" : "rustOrange", p.pipe), put(face, GRID_INSET + 0.02, "soot", p.brackets)]);
  }
  if (r() < LADDER_CHANCE) {
    // Up a pier between two windows, to the rim: the rungs stand in the grid's inset.
    const piersAt = face.openings.slice(1).map(([a], i) => (a + face.openings[i]![1]) / 2);
    if (piersAt.length > 0) {
      const u = piersAt[Math.floor(r() * piersAt.length)]!;
      details.add([put(face, GRID_INSET, "soot", ladder(u, rimBase, 0.02))]);
    }
  }
  if (r() < VINE_CHANCE) {
    const v = vines(r, (r() - 0.5) * face.span * 0.6, 3, Math.min(deck, 3 + r() * 4), -face.span / 2 + pilaster, face.span / 2 - pilaster);
    details.add([put(face, 0.06, "darkMoss", v.stems, null), put(face, 0.06, "moss", v.leaves, null)]);
  }
  return [...base, ...byPaint(details.pieces)];
};
