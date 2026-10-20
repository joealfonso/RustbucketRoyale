import { vent, vines, onFace, toWorld } from "./details";
import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import type { MeshData } from "./shapes";
import { join, rib, rod, roofRib, span } from "./structure";

// Sizes in metres. A container is a steel frame (corner castings, the posts between them, rails along the top and
// bottom) with corrugated sheet hung inside it, and a pair of doors locked by bars at one end.
const casting = 0.24; // the corner blocks the cranes lift by and the twist-locks of a stack lock into
const castingHeight = 0.2;
const frameInset = 0.02; // posts and rails sit just inside the castings, so the castings read as the corners
const post = 0.2;
const bottomRail = 0.24;
const topRail = 0.16;
const ribWidth = 0.3;
const ribDepth = 0.07;
const ribPitch = 0.48;
const roofRibPitch = 0.9;
const roofDrop = 0.06; // the roof panel sags between the top rails; its folds stop just under the box top
const doorFace = 0.12; // the door panels stand this far back from the end, so their bars and handles fit in front
const barRadius = 0.04;
const seam = 0.04;

// sparkYellow is left out: too bright for a whole yard of containers.
const bodyPaints = ["rustOrange", "deepRust", "scrapSteel", "frameNavy"];

// Odds for the per-box variations: each container has lived its own life in the yard.
const doorGoneChance = 0.2; // one door torn off its hinges, the dark hold showing
const ventChance = 0.6; // the little vents up by the corners that real containers have
const repairChance = 0.35; // a plate welded over a rusted-through stretch of side, in another paint
const vineChance = 0.35;

// A shipping container, built in a local frame (u along the long side, y up, w across, centred on the box) and laid
// along whichever world axis the box is longer in.
export const container: KindBuilder = (b: DressBox): DressPiece[] => {
  const random = rng(b.seed);
  const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
  const length = alongX ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
  const width = alongX ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
  const height = b.max[1] - b.min[1];
  const L = length / 2, W = width / 2, H = height;

  const bodyPaint = bodyPaints[Math.floor(random() * bodyPaints.length)]!;
  const doorEnd = random() < 0.5 ? 1 : -1;
  const body: MeshData[] = [], frame: MeshData[] = [], dark: MeshData[] = [], steel: MeshData[] = [];
  const extra: DressPiece[] = [];

  // The frame. Castings at the eight corners, each with the oval holes of a real one on its side, end and top.
  const fo = frameInset;
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    const cu = su * (L - casting / 2), cw = sw * (W - casting / 2);
    for (const top of [false, true]) {
      const y0 = top ? H - castingHeight : 0, cy = y0 + castingHeight / 2;
      frame.push(span(cu - casting / 2, cu + casting / 2, y0, y0 + castingHeight, cw - casting / 2, cw + casting / 2));
      dark.push(span(cu - 0.06, cu + 0.06, cy - 0.035, cy + 0.035, sw * W - 0.012, sw * W + 0.012));
      dark.push(span(su * L - 0.012, su * L + 0.012, cy - 0.035, cy + 0.035, cw - 0.05, cw + 0.05));
      if (top) dark.push(span(cu - 0.06, cu + 0.06, H - 0.012, H + 0.012, cw - 0.035, cw + 0.035));
    }
    frame.push(span(su * (L - fo) - (su > 0 ? post : 0), su * (L - fo) + (su < 0 ? post : 0), castingHeight, H - castingHeight,
      sw * (W - fo) - (sw > 0 ? post : 0), sw * (W - fo) + (sw < 0 ? post : 0)));
  }
  const railU = L - casting;
  for (const sw of [-1, 1]) {
    const w0 = sw * (W - fo), w1 = sw * (W - fo - post);
    frame.push(span(-railU, railU, 0, bottomRail, Math.min(w0, w1), Math.max(w0, w1)));
    frame.push(span(-railU, railU, H - topRail, H, Math.min(w0, w1), Math.max(w0, w1)));
  }
  const railW = W - casting;
  for (const su of [-1, 1]) {
    const u0 = su * (L - fo), u1 = su * (L - fo - post);
    frame.push(span(Math.min(u0, u1), Math.max(u0, u1), 0, bottomRail, -railW, railW));
    frame.push(span(Math.min(u0, u1), Math.max(u0, u1), H - topRail, H, -railW, railW));
  }

  // The body: the corrugated sides fold out to just inside the rails; the doors and their bars fill the door end.
  const sideFace = W - fo - 0.02 - ribDepth;
  const closedEnd = -doorEnd, endFace = L - fo - 0.02 - ribDepth;
  const doorBack = L - doorFace - 0.06;
  const bodyU0 = closedEnd < 0 ? -endFace : -doorBack, bodyU1 = closedEnd < 0 ? doorBack : endFace;
  body.push(span(bodyU0, bodyU1, 0.04, H - roofDrop, -sideFace, sideFace));

  // Vents high up near each end of one side; the folds where a vent sits stop under it.
  const ribRun = 2 * (L - fo - post);
  const ribs = Math.max(2, Math.floor(ribRun / ribPitch));
  const ribStep = ribRun / ribs;
  const ribU = (i: number) => -ribRun / 2 + (i + 0.5) * ribStep;
  const vents: { side: number; u: number }[] = [];
  if (random() < ventChance && ribs >= 6) {
    const side = random() < 0.5 ? -1 : 1;
    for (const end of [-1, 1]) vents.push({ side, u: ribU(end < 0 ? 1 : ribs - 2) });
  }
  const ventY = H - topRail - 0.3, ventTall = 0.24, ventWide = ribStep * 1.3;
  for (let i = 0; i < ribs; i++) {
    const u = ribU(i);
    for (const side of [-1, 1] as const) {
      const under = vents.some((v) => v.side === side && Math.abs(v.u - u) < ventWide / 2 + ribWidth / 2);
      const top = under ? ventY - ventTall / 2 - 0.1 : H - topRail;
      body.push(rib(u, bottomRail, top, side * sideFace, side, ribWidth, ribDepth));
    }
  }
  for (const v of vents) {
    const { frame: f, intake } = vent(v.u, ventY, ventWide, ventTall);
    const face = { at: v.side * sideFace, out: v.side as 1 | -1 };
    frame.push(onFace(f, face));
    dark.push(onFace(intake, face));
  }
  // The closed end is corrugated too, the folds running up between its posts.
  const endRun = 2 * (W - fo - post), endRibs = Math.max(2, Math.floor(endRun / ribPitch));
  for (let i = 0; i < endRibs; i++) {
    const w = -endRun / 2 + (i + 0.5) * (endRun / endRibs);
    body.push(turnToEnd(rib(w, bottomRail, H - topRail, closedEnd * endFace, closedEnd as 1 | -1, ribWidth, ribDepth)));
  }
  // The roof sags a little between the rails, shallow folds across it.
  const roofRibs = Math.max(2, Math.floor((2 * railU) / roofRibPitch));
  for (let i = 0; i < roofRibs; i++) body.push(roofRib(-railU + (i + 0.5) * ((2 * railU) / roofRibs), -sideFace, sideFace, H - roofDrop, 0.4, 0.04));

  // The doors: two panels with a seam between, folds down each, two locking bars a door with cams turning in keepers
  // on the header and sill, a handle on each bar, and hinges down the outer edge.
  const panelWidth = (2 * railW - seam) / 2;
  const doorTop = H - topRail, doorBottom = bottomRail;
  const face = doorEnd * (L - doorFace);
  const gone = random() < doorGoneChance ? (random() < 0.5 ? -1 : 1) : 0;
  for (const side of [-1, 1]) {
    const inner = side * seam / 2, outer = side * (seam / 2 + panelWidth);
    const w0 = Math.min(inner, outer), w1 = Math.max(inner, outer);
    for (let k = 0; k < 4; k++) {
      // Hinge knuckles on the post; a torn-off door leaves them behind.
      const y = doorBottom + 0.25 + k * ((doorTop - doorBottom - 0.5) / 3);
      steel.push(rod(doorEnd * (L - doorFace + 0.05), y - 0.1, y + 0.1, outer - side * 0.02, 0.05));
    }
    if (side === gone) {
      dark.push(span(Math.min(doorEnd * doorBack, doorEnd * (doorBack + 0.02)), Math.max(doorEnd * doorBack, doorEnd * (doorBack + 0.02)), doorBottom, doorTop, w0, w1));
      continue;
    }
    body.push(span(Math.min(face, doorEnd * doorBack), Math.max(face, doorEnd * doorBack), doorBottom, doorTop, w0, w1));
    for (let k = 0; k < 3; k++) {
      const w = w0 + (k + 0.5) * (panelWidth / 3);
      body.push(turnToEnd(rib(w, doorBottom + 0.1, doorTop - 0.1, face, doorEnd as 1 | -1, 0.22, 0.04)));
    }
    for (const at of [0.22, 0.72]) {
      const w = inner + side * panelWidth * at, barU = doorEnd * (L - doorFace + barRadius + 0.01);
      steel.push(rod(barU, doorBottom - 0.03, doorTop + 0.03, w, barRadius));
      for (const y of [doorBottom + 0.03, doorTop - 0.03]) frame.push(spanU(barU, 0.1, y - 0.05, y + 0.05, w - 0.06, w + 0.06));
      for (const y of [doorBottom + 0.7, doorTop - 0.7]) frame.push(spanU(barU - doorEnd * 0.01, 0.06, y - 0.04, y + 0.04, w - 0.07, w + 0.07));
      // The handle swings down from the bar towards the seam, held in its retainer.
      const hy = doorBottom + 1.0;
      steel.push(spanU(barU + doorEnd * 0.02, 0.05, hy - 0.03, hy + 0.03, Math.min(w, w - side * 0.42), Math.max(w, w - side * 0.42)));
      frame.push(spanU(barU, 0.06, hy - 0.1, hy + 0.05, w - side * 0.42 - 0.04, w - side * 0.42 + 0.04));
    }
  }

  if (random() < repairChance) {
    const side = random() < 0.5 ? -1 : 1, su = 1.2 + random() * 1.6, sy = 0.8 + random() * (H - bottomRail - topRail - 1);
    const u = (random() - 0.5) * Math.max(0, ribRun - su), y = bottomRail + sy / 2 + random() * (H - bottomRail - topRail - sy);
    const w = side * (sideFace + ribDepth + 0.025);
    extra.push({ paint: bodyPaints[(bodyPaints.indexOf(bodyPaint) + 1 + Math.floor(random() * 3)) % bodyPaints.length]!, mesh: local(span(u - su / 2, u + su / 2, y - sy / 2, y + sy / 2, w - 0.025, w + 0.025)) });
  }
  if (random() < vineChance) {
    const side = random() < 0.5 ? -1 : 1;
    const v = vines(random, (random() - 0.5) * length * 0.6, 2.5, H - 0.4, -L + casting, L - casting);
    const face = { at: side * (sideFace + ribDepth), out: side as 1 | -1 };
    extra.push({ paint: "darkMoss", mesh: local(onFace(v.stems, face)), surface: null }, { paint: "moss", mesh: local(onFace(v.leaves, face)), surface: null });
  }

  return [
    { paint: bodyPaint, mesh: local(join(body)) },
    { paint: "soot", mesh: local(join([...frame, ...dark])) },
    { paint: "scrapSteel", mesh: local(join(steel)) },
    ...extra,
  ];

  function local(m: MeshData): MeshData {
    return toWorld(m, alongX, [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]);
  }
};

// A rib built for a side (u along, w out) turned to stand on an end face instead (w along, u out).
function turnToEnd(m: MeshData): MeshData {
  const out: MeshData = { positions: [], normals: [], indices: [...m.indices] };
  for (let i = 0; i < m.positions.length; i += 3) {
    out.positions.push(m.positions[i + 2]!, m.positions[i + 1]!, m.positions[i]!);
    out.normals.push(m.normals[i + 2]!, m.normals[i + 1]!, m.normals[i]!);
  }
  // Swapping two axes mirrors the mesh, so each triangle is wound the other way round to keep facing out.
  for (let i = 0; i < out.indices.length; i += 3) [out.indices[i + 1], out.indices[i + 2]] = [out.indices[i + 2]!, out.indices[i + 1]!];
  return out;
}

// A box `depth` thick along u, centred on `u`.
const spanU = (u: number, depth: number, y0: number, y1: number, w0: number, w1: number) => span(u - depth / 2, u + depth / 2, y0, y1, w0, w1);
