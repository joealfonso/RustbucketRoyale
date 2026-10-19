import { box, cylinder, merge, prism, turn, type MeshData, type V3 } from "../dressing/shapes";
import { bayCentres, hazardStripes, hexEdges, type HangarConfig } from "./layout";

// The hangar's fixed shell, built in code from data/hangar.json: the panelled floor with the development grid's
// hexagons of light strips on it, the grated loading bay over its pit, painted hazard lines, engineers at work, the walls, the roof trusses with their work lamps, and the welding bench. Returns meshes
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
  roof(c, pieces);
  bench(c, pieces);
  hexGrid(c, pieces);
  engineers(c, pieces);
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

// Wall plates with dark seams on a dark backing, a kick plate along the foot and a trim band along the top.
function walls(c: HangarConfig, pieces: Pieces): void {
  const { halfWidth, backZ, frontZ, height, wallPanel } = c.hall;
  const t = 0.3, seam = 0.1, kick = 1.2;
  add(pieces, "pit", box([0, height / 2, backZ - t], [halfWidth * 2, height, 0.1]));
  for (let x = -halfWidth; x < halfWidth - 1e-6; x += wallPanel) {
    for (let y = kick; y < height - 1e-6; y += wallPanel) {
      const h = Math.min(wallPanel, height - y);
      add(pieces, "wall", box([x + wallPanel / 2, y + h / 2, backZ - t / 2], [wallPanel - seam, h - seam, t]));
    }
  }
  add(pieces, "wallTrim", box([0, kick / 2, backZ - t / 2 + 0.08], [halfWidth * 2, kick, t]));
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

// Engineers for scale: a plain figure in coveralls, standing, made of a few blocks. Dark so they read as people in
// the background and never pull the eye from the mechs.
function engineers(c: HangarConfig, pieces: Pieces): void {
  const h = c.engineers.height;
  const u = h / 1.8; // built at 1.8 m, scaled to the data file's height
  for (const [x, z, degrees] of c.engineers.spots) {
    const figure = merge(
      box([-0.1 * u, 0.42 * u, 0], [0.15 * u, 0.84 * u, 0.18 * u]),
      box([0.1 * u, 0.42 * u, 0], [0.15 * u, 0.84 * u, 0.18 * u]),
      box([0, 1.15 * u, 0], [0.42 * u, 0.62 * u, 0.24 * u], 0.03),
      box([-0.27 * u, 1.12 * u, 0.04 * u], [0.11 * u, 0.58 * u, 0.13 * u]),
      box([0.27 * u, 1.12 * u, 0.04 * u], [0.11 * u, 0.58 * u, 0.13 * u]),
      box([0, 1.6 * u, 0], [0.21 * u, 0.24 * u, 0.23 * u], 0.04),
    );
    add(pieces, "engineer", turn(figure, [0, (degrees * Math.PI) / 180, 0], [0, 0, 0], [x, 0, z]));
  }
}

// Merged per paint, ready for toGeometry.
export function mergedPieces(pieces: Pieces): Map<string, MeshData> {
  return new Map([...pieces].map(([paint, meshes]) => [paint, merge(...meshes)]));
}
