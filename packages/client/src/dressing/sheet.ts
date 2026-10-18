import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { box, merge, type MeshData, type V3 } from "./shapes";

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

  return [
    { paint: panelPaint, mesh: merge(...panel) },
    { paint: "soot", mesh: merge(...steel) },
    { paint: patchPaint, mesh: merge(...patches) },
  ];
};
