import type { DressBox, DressPiece, KindBuilder } from "./kinds";

// Checks one kind builder against the rules in kinds.ts, on a set of boxes. Returns what is wrong (empty when all is
// well). Every builder's test calls this; see container.test.ts for the pattern.
export function checkBuilder(builder: KindBuilder, boxes: DressBox[], trianglesPerCubicMetre = 40, maxTriangles = 2500): string[] {
  const problems: string[] = [];
  const slack = 0.06; // metres a piece may stick out of its box
  for (const box of boxes) {
    const label = `box ${box.min.join(",")} to ${box.max.join(",")}`;
    const pieces = builder(box);
    if (pieces.length === 0) problems.push(`${label}: no pieces`);
    let triangles = 0;
    for (const p of pieces) {
      const { positions, normals, indices } = p.mesh;
      triangles += indices.length / 3;
      if (typeof p.paint !== "string" || p.paint.length === 0) problems.push(`${label}: a piece has no paint`);
      for (let i = 0; i < positions.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          const v = positions[i + a]!;
          if (!Number.isFinite(v) || v < box.min[a]! - slack || v > box.max[a]! + slack) { problems.push(`${label}: a vertex is outside the box (${positions.slice(i, i + 3).map((n) => n.toFixed(2)).join(", ")})`); i = positions.length; break; }
        }
      }
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3];
        const u = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
        const v = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
        const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        const area = Math.hypot(...cross);
        if (area < 1e-9) continue;
        if (cross[0]! * normals[a]! + cross[1]! * normals[a + 1]! + cross[2]! * normals[a + 2]! <= 0) { problems.push(`${label}: a triangle faces the wrong way`); break; }
      }
    }
    const volume = (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * (box.max[2] - box.min[2]);
    const budget = Math.min(maxTriangles, Math.max(150, volume * trianglesPerCubicMetre));
    if (triangles > budget) problems.push(`${label}: ${triangles} triangles, over ${Math.round(budget)}`);
    if (JSON.stringify(pieces) !== JSON.stringify(builder(box))) problems.push(`${label}: not the same twice for the same box and seed`);
  }
  return problems;
}

// Some boxes of the sizes the chunk data really uses, at a few places and both ways round.
export function sampleBoxes(sizes: [number, number, number][], count = 3): DressBox[] {
  const boxes: DressBox[] = [];
  sizes.forEach((size, i) => {
    for (let k = 0; k < count; k++) {
      const [sx, sy, sz] = k % 2 === 0 ? size : [size[2], size[1], size[0]];
      const x = 40 * i - 100 + k * 7.5, z = -30 + k * 11.25, y = 0;
      boxes.push({ min: [x - sx / 2, y, z - sz / 2], max: [x + sx / 2, y + sy, z + sz / 2], seed: 1000 * i + k, color: "#8a5a3c" });
    }
  });
  return boxes;
}

export const triangleCount = (pieces: DressPiece[]) => pieces.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
