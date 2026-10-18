import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { box, merge, type MeshData } from "./shapes";

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
  const piers = (span: number, place: (a: number, c: number) => MeshData) => {
    const inner = span / 2 - pilaster;
    const count = Math.max(1, Math.floor((inner * 2) / bay));
    const step = (inner * 2) / count, opening = step * windowShare;
    let at = -inner;
    for (let i = 0; i < count; i++) {
      const left = -inner + step * i + (step - opening) / 2;
      body.push(place(at, left));
      at = left + opening;
    }
    body.push(place(at, inner));
  };
  // Up to the top slab only, so they don't share its top face.
  piers(sx, (a, c) => slab(a, c, 0, below, gz0, gz1));
  piers(sz, (a, c) => slab(gx0, gx1, 0, below, a, c));

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

  return [
    { paint: r() < 0.5 ? "warmLight" : "scrapSteel", mesh: merge(...body) },
    { paint: "soot", mesh: merge(...dark) },
    { paint: r() < 0.5 ? "rustOrange" : "frameNavy", mesh: merge(...roof) },
  ];
};
