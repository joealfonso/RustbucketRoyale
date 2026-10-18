import { rng, type DressBox, type DressPiece, type KindBuilder } from "./kinds";
import { box, merge, type MeshData, type V3 } from "./shapes";

// Sizes in metres. Posts and rails are the frame, the ribs stand out from the body to the box face, and the doors
// and their locking bars stand out from the body at the door end.
const frame = 0.2;
const ribDepth = 0.08;
const ribWidth = 0.12;
const ribSpacing = 0.6;
const doorDepth = 0.08;
const barSize = 0.08;
const seam = 0.04;

// sparkYellow is left out: too bright for a whole yard of containers.
const bodyPaints = ["rustOrange", "deepRust", "scrapSteel", "frameNavy"];

// A shipping container. Built in a local frame (u along the long side, y up, w across), then laid along whichever
// world axis the box is longer in.
export const container: KindBuilder = (b: DressBox): DressPiece[] => {
  const random = rng(b.seed);
  const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
  const length = alongX ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
  const width = alongX ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
  const height = b.max[1] - b.min[1];
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
  const L = length / 2, W = width / 2;

  const part = (u: number, y: number, w: number, su: number, sy: number, sw: number): MeshData =>
    alongX ? box([cx + u, y0 + y, cz + w] as V3, [su, sy, sw]) : box([cx + w, y0 + y, cz + u] as V3, [sw, sy, su]);

  const bodyPaint = bodyPaints[Math.floor(random() * bodyPaints.length)]!;
  const doorEnd = random() < 0.5 ? 1 : -1;

  const body: MeshData[] = [];
  const trim: MeshData[] = [];

  // The body: inset from the long faces by the ribs and from the door end by the doors and bars.
  const bodyBack = L - ribDepth, bodyFront = L - doorDepth - barSize;
  const bodyLength = bodyBack + bodyFront;
  const bodyCentre = doorEnd * (bodyFront - bodyBack) / 2;
  body.push(part(bodyCentre, height / 2, 0, bodyLength, height - 0.04, width - 2 * ribDepth));

  // Corrugation ribs along both long sides, between the frame and the rails.
  const ribRun = length - 2 * frame;
  const ribs = Math.max(2, Math.floor(ribRun / ribSpacing));
  const ribHeight = height - 2 * frame;
  for (let i = 0; i < ribs; i++) {
    const u = -ribRun / 2 + (i + 0.5) * (ribRun / ribs);
    for (const side of [-1, 1]) body.push(part(u, height / 2, side * (W - ribDepth / 2), ribWidth, ribHeight, ribDepth));
  }

  // Double doors: two panels with a seam down the middle, each with a locking bar standing out in front.
  const doorFace = doorEnd * (L - barSize - doorDepth / 2);
  const panelWidth = (width - 2 * frame - seam) / 2;
  const panelHeight = height - 2 * frame;
  for (const side of [-1, 1]) {
    const w = side * (seam / 2 + panelWidth / 2);
    body.push(part(doorFace, height / 2, w, doorDepth, panelHeight, panelWidth));
    trim.push(part(doorEnd * (L - barSize / 2), height / 2, w + side * panelWidth * 0.15, barSize, panelHeight - 0.1, barSize));
  }

  // Corner posts at the four vertical edges, rails round the top and bottom.
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    trim.push(part(su * (L - frame / 2), height / 2, sw * (W - frame / 2), frame, height, frame));
  }
  for (const y of [frame / 2, height - frame / 2]) {
    for (const sw of [-1, 1]) trim.push(part(0, y, sw * (W - frame / 2), length - 2 * frame, frame, frame));
    for (const su of [-1, 1]) trim.push(part(su * (L - frame / 2), y, 0, frame, frame, width - 2 * frame));
  }

  return [
    { paint: bodyPaint, mesh: merge(...body) },
    { paint: "soot", mesh: merge(...trim) },
  ];
};
