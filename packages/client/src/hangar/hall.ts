import { box, cylinder, merge, prism, turn, type MeshData, type V3 } from "../dressing/shapes";
import { bayCentres, hazardStripes, hexEdges, type HangarConfig } from "./layout";

// The hangar's fixed shell, built in code from data/hangar.json: the panelled floor with the development grid's
// hexagons of light strips on it, the grated loading bay over its pit, painted hazard lines, the walls
// with the big door and the catwalks, the roof trusses with their work lamps, and the welding bench. Returns meshes
// by paint (a key of `paints` in the data file), so each paint is one draw call plus its outline.
// Gantries move, so they are built in gantry.ts; screens in screens.ts.

export type Pieces = Map<string, MeshData[]>;

const add = (pieces: Pieces, paint: string, ...meshes: MeshData[]) => {
  const list = pieces.get(paint);
  if (list) list.push(...meshes);
  else pieces.set(paint, [...meshes]);
};

export function buildHall(c: HangarConfig): Pieces {
  const pieces: Pieces = new Map();
  floor(c, pieces);
  loadingBay(c, pieces);
  bayLines(c, pieces);
  walls(c, pieces);
  door(c, pieces);
  catwalks(c, pieces);
  roof(c, pieces);
  bench(c, pieces);
  hexGrid(c, pieces);
  return pieces;
}

// Square deck plates with a dark gap between them, so the floor reads as plates bolted over a frame. Plates are
// left out over the loading bay, which has its own grating.
function floor(c: HangarConfig, pieces: Pieces): void {
  const { panel, seam, plate } = c.floor;
  const { halfWidth, backZ, frontZ } = c.hall;
  const bay = c.loadingBay;
  add(pieces, "pit", box([0, -plate - 0.05, (backZ + frontZ) / 2], [halfWidth * 2, 0.1, frontZ - backZ]));
  for (let x = -halfWidth; x < halfWidth - 1e-6; x += panel) {
    for (let z = backZ; z < frontZ - 1e-6; z += panel) {
      const cx = x + panel / 2, cz = z + panel / 2;
      if (Math.abs(cx - bay.x) < bay.halfWidth && Math.abs(cz - bay.z) < bay.halfDepth) continue;
      add(pieces, "floor", box([cx, -plate / 2, cz], [panel - seam, plate, panel - seam]));
    }
  }
}

// The loading bay: a pit under a grating of slats across it, on two rails, with a hazard band round the edge.
function loadingBay(c: HangarConfig, pieces: Pieces): void {
  const b = c.loadingBay;
  add(pieces, "pit", box([b.x, -b.pitDepth - 0.05, b.z], [b.halfWidth * 2, 0.1, b.halfDepth * 2]));
  for (const side of [-1, 1]) add(pieces, "frame", box([b.x + side * b.halfWidth * 0.5, -b.pitDepth / 2, b.z], [0.2, b.pitDepth - 0.05, b.halfDepth * 2]));
  const pitch = b.slat + b.slatGap;
  for (let z = b.z - b.halfDepth + pitch / 2; z < b.z + b.halfDepth; z += pitch) {
    add(pieces, "slat", box([b.x, -0.04, z], [b.halfWidth * 2, 0.08, b.slat]));
  }
  hazardRect(c, pieces, b.x, b.z, b.halfWidth, b.halfDepth);
}

// A hazard band along the front of every bay: where a mech steps out, nobody stands.
function bayLines(c: HangarConfig, pieces: Pieces): void {
  for (const bay of bayCentres(c)) {
    const z = bay.z + c.bays.halfDepth;
    hazardBand(c, pieces, bay.x - c.bays.halfWidth, z, bay.x + c.bays.halfWidth, z);
  }
}

function hazardRect(c: HangarConfig, pieces: Pieces, x: number, z: number, hw: number, hd: number): void {
  const w = c.hazard.width / 2;
  hazardBand(c, pieces, x - hw - w, z - hd - w, x + hw + w, z - hd - w);
  hazardBand(c, pieces, x - hw - w, z + hd + w, x + hw + w, z + hd + w);
  hazardBand(c, pieces, x - hw - w, z - hd + w, x - hw - w, z + hd - w);
  hazardBand(c, pieces, x + hw + w, z - hd + w, x + hw + w, z + hd - w);
}

// Painted on the floor: a dark band with yellow stripes on top. Both are thin slabs, the stripes a hair higher.
function hazardBand(c: HangarConfig, pieces: Pieces, x0: number, z0: number, x1: number, z1: number): void {
  const { width, stripe, lift } = c.hazard;
  const length = Math.hypot(x1 - x0, z1 - z0);
  const angle = Math.atan2(z1 - z0, x1 - x0);
  add(pieces, "hazardDark", turn(box([0, lift / 2, 0], [length, lift, width]), [0, -angle, 0], [0, 0, 0], [(x0 + x1) / 2, 0, (z0 + z1) / 2]));
  for (const corners of hazardStripes(x0, z0, x1, z1, width, stripe)) {
    // prism along y takes (z, x) pairs.
    add(pieces, "hazard", prism(corners.map(([x, z]) => [z, x] as [number, number]), "y", lift, lift * 2));
  }
}

// Wall plates with dark seams on a dark backing, a kick plate along the foot and a trim band along the top. The back
// wall leaves an opening for the big door, so the daylight through its gap is really behind the wall.
function walls(c: HangarConfig, pieces: Pieces): void {
  const { halfWidth, backZ, frontZ, height, wallPanel, door } = c.hall;
  const t = 0.3, seam = 0.1, kick = 1.2;
  const left = door.from + halfWidth, right = halfWidth - door.to;
  add(pieces, "pit", box([-halfWidth + left / 2, height / 2, backZ - t], [left, height, 0.1]));
  add(pieces, "pit", box([halfWidth - right / 2, height / 2, backZ - t], [right, height, 0.1]));
  add(pieces, "pit", box([(door.from + door.to) / 2, (height + door.height) / 2, backZ - t], [door.to - door.from, height - door.height, 0.1]));
  for (let x = -halfWidth; x < halfWidth - 1e-6; x += wallPanel) {
    const overDoor = x >= door.from - 1e-6 && x < door.to - 1e-6;
    for (let y = kick; y < height - 1e-6; y += wallPanel) {
      const bottom = overDoor ? Math.max(y, door.height) : y;
      const h = Math.min(y + wallPanel, height) - bottom;
      if (h <= seam) continue;
      add(pieces, "wall", box([x + wallPanel / 2, bottom + h / 2, backZ - t / 2], [wallPanel - seam, h - seam, t]));
    }
  }
  add(pieces, "wallTrim", box([-halfWidth + left / 2, kick / 2, backZ - t / 2 + 0.08], [left, kick, t]));
  add(pieces, "wallTrim", box([halfWidth - right / 2, kick / 2, backZ - t / 2 + 0.08], [right, kick, t]));
  for (const side of [-1, 1]) {
    const x = side * (halfWidth + t / 2);
    for (let z = backZ; z < frontZ - 1e-6; z += wallPanel) {
      for (let y = kick; y < height - 1e-6; y += wallPanel) {
        const h = Math.min(wallPanel, height - y);
        add(pieces, "wall", box([x, y + h / 2, z + wallPanel / 2], [t, h - seam, wallPanel - seam]));
      }
    }
    add(pieces, "pit", box([x + side * t, height / 2, (backZ + frontZ) / 2], [0.1, height, frontZ - backZ]));
    add(pieces, "wallTrim", box([x - side * 0.08, kick / 2, (backZ + frontZ) / 2], [t, kick, frontZ - backZ]));
  }
}

// The big door in the back wall, its two ribbed leaves slid apart so a band of daylight shows between them (the sky
// and the yard outside are drawn in framing.ts). A heavy frame round the opening, hazard stripes down the leaves'
// meeting edges and across the threshold: the hall is a real building with an outside, not a box.
function door(c: HangarConfig, pieces: Pieces): void {
  const { backZ, door: d } = c.hall;
  const f = d.frame, z = backZ - 0.18, depth = 0.25;
  for (const x of [d.from - f / 2, d.to + f / 2]) add(pieces, "frame", box([x, (d.height + f) / 2, backZ + 0.05], [f, d.height + f, 0.7]));
  add(pieces, "frame", box([(d.from + d.to) / 2, d.height + f / 2, backZ + 0.05], [d.to - d.from + f * 2, f, 0.7]));
  for (const [x0, x1, edge] of [[d.from, d.gap[0], d.gap[0]], [d.gap[1], d.to, d.gap[1]]] as const) {
    add(pieces, "gantry", box([(x0 + x1) / 2, d.height / 2, z], [x1 - x0, d.height, depth]));
    for (let y = d.rib; y < d.height - 0.2; y += d.rib) add(pieces, "frame", box([(x0 + x1) / 2, y, z + depth / 2 + 0.04], [x1 - x0 - 0.1, 0.14, 0.08]));
    // The meeting edge: a dark band with yellow stripes, like the hazard lines on the deck but stood up.
    const band = 0.5, side = edge === x0 ? 1 : -1, bx = edge + side * band / 2, front = z + depth / 2;
    add(pieces, "hazardDark", box([bx, d.height / 2, front + 0.05], [band, d.height, 0.1]));
    for (const corners of hazardStripes(bx, 0, bx, d.height, band, c.hazard.stripe)) {
      // The stripes come back as (x, z) floor points; here the second is height. prism along z takes (x, y) pairs.
      add(pieces, "hazard", prism(corners, "z", front + 0.1, front + 0.12));
    }
  }
  hazardBand(c, pieces, d.from, backZ + 0.4, d.to, backZ + 0.4);
}

// Catwalks at height along the back wall and part way up each side wall: a deck on brackets, a fascia, and a railing
// with posts, a mid rail and a toe board. The screens hang on the back railing (data/hangar.json screens).
function catwalks(c: HangarConfig, pieces: Pieces): void {
  const { halfWidth, backZ, catwalk: w } = c.hall;
  const deck = w.deck, front = backZ + w.depth;
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    add(pieces, "frame", segment([x0, deck + w.rail, z0], [x1, deck + w.rail, z1], 0.08));
    add(pieces, "frame", segment([x0, deck + w.rail / 2, z0], [x1, deck + w.rail / 2, z1], 0.05));
    add(pieces, "wallTrim", segment([x0, deck + 0.08, z0], [x1, deck + 0.08, z1], 0.14));
    const length = Math.hypot(x1 - x0, z1 - z0), posts = Math.max(1, Math.round(length / w.post));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      add(pieces, "frame", box([x0 + (x1 - x0) * t, deck + w.rail / 2, z0 + (z1 - z0) * t], [0.07, w.rail, 0.07]));
    }
  };
  // The back run, from side wall to side wall.
  add(pieces, "slat", box([0, deck - 0.04, backZ + w.depth / 2], [halfWidth * 2, 0.08, w.depth]));
  add(pieces, "frame", box([0, deck - 0.15, front - 0.05], [halfWidth * 2, 0.3, 0.1]));
  for (let x = -halfWidth + w.post * 2; x < halfWidth - 1e-6; x += w.post * 2) {
    if (x > c.hall.door.from - 0.5 && x < c.hall.door.to + 0.5) continue; // the door's header carries it there
    add(pieces, "frame", segment([x, deck - 1.1, backZ], [x, deck - 0.2, front - 0.15], 0.1));
  }
  rail(-halfWidth + w.depth, front, halfWidth - w.depth, front);
  // The side runs, each ending in a railing across its end.
  for (const side of [-1, 1]) {
    const x = side * (halfWidth - w.depth / 2), inner = side * (halfWidth - w.depth);
    const length = w.sideTo - backZ - w.depth;
    add(pieces, "slat", box([x, deck - 0.04, front + length / 2], [w.depth, 0.08, length]));
    add(pieces, "frame", box([inner + side * 0.05, deck - 0.15, front + length / 2], [0.1, 0.3, length]));
    for (let z = front + w.post; z < w.sideTo - 1e-6; z += w.post * 2) {
      add(pieces, "frame", segment([side * halfWidth, deck - 1.1, z], [inner + side * 0.15, deck - 0.2, z], 0.1));
    }
    rail(inner, front, inner, w.sideTo);
    rail(inner, w.sideTo, side * halfWidth, w.sideTo);
  }
}

// Roof trusses across the hall (top and bottom chord, posts between), carrying the work lamp on a drop rod over the
// loading bay. The lamps' lit faces are drawn by the caller, as flat light, from `lampSpots`.
function roof(c: HangarConfig, pieces: Pieces): void {
  const { halfWidth, backZ, frontZ, height, trussSpacing } = c.hall;
  const chord = 0.35, depth = 1.2;
  for (let z = backZ + trussSpacing / 2; z < frontZ; z += trussSpacing) {
    add(pieces, "frame", box([0, height - chord / 2, z], [halfWidth * 2, chord, chord]));
    add(pieces, "frame", box([0, height - depth, z], [halfWidth * 2, chord, chord]));
    for (let x = -halfWidth; x <= halfWidth + 1e-6; x += 2) add(pieces, "frame", box([x, height - depth / 2, z], [0.18, depth, 0.18]));
  }
  for (const spot of lampSpots(c)) {
    const [hx, hy, hz] = c.lamps.housing;
    add(pieces, "cable", cylinder([spot[0], spot[1] + hy / 2 + c.lamps.drop / 2, spot[2]], 0.04, c.lamps.drop, "y", 6));
    add(pieces, "frame", box([spot[0], spot[1] + hy / 2, spot[2]], [hx, hy, hz], 0.05));
  }
}

// Where each work lamp hangs, the middle of its housing. Only the loading bay has one: lamps over the bays would
// hang in front of the screens and the name on the back wall.
export function lampSpots(c: HangarConfig): V3[] {
  return [[c.loadingBay.x, c.hall.height - 1.2 - c.lamps.drop, c.loadingBay.z]];
}

// A workbench with a spare armour plate held upright in a jig, and a welding arm on a post whose torch is on the
// plate's seam: the sparks in sparks.ts come from its tip.
function bench(c: HangarConfig, pieces: Pieces): void {
  const [bx, , bz] = c.welder.bench;
  const [tx, ty, tz] = c.welder.torch;
  const top = 0.9;
  add(pieces, "bench", box([bx, top - 0.06, bz], [2.2, 0.12, 1.0], 0.03));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(pieces, "frame", box([bx + sx * 0.95, (top - 0.12) / 2, bz + sz * 0.38], [0.1, top - 0.12, 0.1]));
  // The jig holds the plate by its foot; the plate leans back a little against it.
  add(pieces, "frame", box([bx + 0.3, top + 0.08, bz - 0.15], [1.2, 0.16, 0.2]));
  add(pieces, "plate", turn(box([0, 0.45, 0], [1.1, 0.9, 0.08], 0.03), [-0.12, 0, 0], [0, 0, 0], [bx + 0.3, top + 0.12, bz - 0.15]));
  // The arm: a post at the back corner of the bench, an upper arm out from its top, a forearm down to the torch.
  const postX = bx - 0.9, postZ = bz - 0.6, postTop = 1.9;
  add(pieces, "gantry", box([postX, postTop / 2, postZ], [0.2, postTop, 0.2]));
  add(pieces, "arm", segment([postX, postTop, postZ], [tx - 0.2, ty + 0.55, tz + 0.15], 0.14));
  add(pieces, "arm", segment([tx - 0.2, ty + 0.55, tz + 0.15], [tx, ty + 0.06, tz], 0.1));
  add(pieces, "frame", cylinder([postX, postTop, postZ], 0.14, 0.3, "z", 8));
}

// A square bar from one point to another.
export function segment(a: V3, b: V3, thickness: number): MeshData {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  // Built along x, then tipped up by its pitch and turned to its heading.
  const bar = box([0, 0, 0], [length, thickness, thickness]);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const heading = Math.atan2(-dz, dx);
  return turn(turn(bar, [0, 0, pitch]), [0, heading, 0], [0, 0, 0], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

// The development grid (MECH_ROSTER.md, The hangar; allowed in the hangar only by DESIGN.md): flush light strips
// along every hexagon edge, drawn as flat light under the key "light". Left off the loading bay's grating, which
// has its own hazard band.
function hexGrid(c: HangarConfig, pieces: Pieces): void {
  const { radius, strip, lift, from, to } = c.hexGrid;
  const b = c.loadingBay;
  const pad = c.hazard.width * 2;
  for (const [x0, z0, x1, z1] of hexEdges(radius, from, to)) {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    if (Math.abs(mx - b.x) < b.halfWidth + pad && Math.abs(mz - b.z) < b.halfDepth + pad) continue;
    const length = Math.hypot(x1 - x0, z1 - z0);
    const angle = Math.atan2(z1 - z0, x1 - x0);
    add(pieces, "light", turn(box([0, lift / 2, 0], [length, lift, strip]), [0, -angle, 0], [0, 0, 0], [mx, 0, mz]));
  }
}

// Merged per paint, ready for toGeometry.
export function mergedPieces(pieces: Pieces): Map<string, MeshData> {
  return new Map([...pieces].map(([paint, meshes]) => [paint, merge(...meshes)]));
}
