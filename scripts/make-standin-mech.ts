// Builds the stand-in mech kit: every part of a mech in its three damage states, each with three levels of detail,
// effect points and the gun mount, as .glb files under assets/models/mechs/standin/. It is plain boxes in the grey-box
// mech's proportions, made only to prove the kit pipeline (loading, damage swaps, LODs, effect points) before real art
// exists. It never ships as art. Run: npx tsx scripts/make-standin-mech.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boxMesh, writeGlb, type MeshData, type NodeData } from "./assets/glbWrite";

type V3 = [number, number, number];
interface Box { min: V3; max: V3 }

const box = (center: V3, size: V3): Box => ({
  min: [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
  max: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
});

// Damaged: the part with a dent: the bottom of the box whole, the top pushed in and narrower.
function dented(b: Box): Box[] {
  const split = b.min[1] + (b.max[1] - b.min[1]) * 0.65;
  return [
    { min: b.min, max: [b.max[0], split, b.max[2]] },
    { min: [b.min[0] + 0.06, split, b.min[2] + 0.1], max: [b.max[0] - 0.14, b.max[1] - 0.06, b.max[2] - 0.04] },
  ];
}

// Broken: only the end nearest the body is left, `keep` of its length along `axis`, from the `fromMax` end.
function stub(b: Box, axis: 0 | 1 | 2, keep: number, fromMax: boolean): Box[] {
  const length = (b.max[axis] - b.min[axis]) * keep;
  const min = [...b.min] as V3, max = [...b.max] as V3;
  if (fromMax) min[axis] = b.max[axis] - length;
  else max[axis] = b.min[axis] + length;
  return [{ min, max }];
}

function crushed(b: Box): Box[] {
  return [{ min: b.min, max: [b.max[0], b.min[1] + (b.max[1] - b.min[1]) * 0.55, b.max[2]] }];
}

const bounds = (boxes: Box[]): Box => ({
  min: [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i]!))) as V3,
  max: [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i]!))) as V3,
});

function mesh(boxes: Box[], segments: number): MeshData {
  const out: MeshData = { positions: [], normals: [], indices: [] };
  for (const b of boxes) boxMesh(b.min, b.max, segments, out);
  return out;
}

const top = (b: Box): V3 => [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];

// The parts, in the mech's own frame: feet at y 0, forward is -Z. Same proportions as the grey-box mech.
const parts: { name: string; body: Box; broken: (b: Box) => Box[]; extra?: (b: Box) => NodeData[] }[] = [
  { name: "Torso", body: box([0, 2.4, 0], [1.8, 1.6, 1.2]), broken: crushed },
  { name: "Jets", body: box([0, 2.6, 0.8], [1.0, 1.0, 0.4]), broken: (b) => stub(b, 1, 0.5, false) },
  { name: "Sensor", body: box([0, 3.45, -0.2], [0.7, 0.5, 0.6]), broken: crushed },
  { name: "Leg_L", body: box([-0.6, 0.8, 0], [0.6, 1.6, 0.7]), broken: (b) => stub(b, 1, 0.3, true) },
  { name: "Leg_R", body: box([0.6, 0.8, 0], [0.6, 1.6, 0.7]), broken: (b) => stub(b, 1, 0.3, true) },
  { name: "Arm_L", body: box([-1.2, 2.4, 0], [0.5, 1.2, 0.5]), broken: (b) => stub(b, 1, 0.35, true) },
  {
    name: "Arm_R", body: box([1.2, 2.4, -0.6], [0.5, 0.6, 1.6]), broken: (b) => stub(b, 2, 0.3, true),
    // Where the gun sits: the end of the arm.
    extra: () => [{ name: "Mount_Gun", translation: [1.2, 2.4, -1.65] }],
  },
];

const STATES = ["Intact", "Damaged", "Broken"] as const;
const dir = join(new URL("..", import.meta.url).pathname, "assets/models/mechs/standin");
mkdirSync(dir, { recursive: true });

for (const part of parts) {
  for (const state of STATES) {
    const boxes = state === "Intact" ? [part.body] : state === "Damaged" ? dented(part.body) : part.broken(part.body);
    const nodes: NodeData[] = [
      { name: "LOD0", mesh: mesh(boxes, 3) }, // near: faces split, standing in for real detail
      { name: "LOD1", mesh: mesh(boxes, 1) }, // middle: plain boxes
      { name: "LOD2", mesh: mesh([bounds(boxes)], 1) }, // far: one box round the whole part
      { name: "Fx", translation: top(bounds(boxes)) }, // where sparks and smoke come from
      ...(part.extra?.(part.body) ?? []),
    ];
    const file = join(dir, `Mech_Standin_${part.name}_${state}.glb`);
    writeFileSync(file, writeGlb(nodes));
  }
}
console.log(`Wrote ${parts.length * STATES.length} stand-in parts to ${dir}`);
