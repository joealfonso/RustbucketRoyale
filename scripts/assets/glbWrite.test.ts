import { describe, expect, it } from "vitest";
import { countTriangles, readGltfJson } from "./glbCheck";
import { boxMesh, quantizePositions, writeGlb } from "./glbWrite";

describe("glb writer", () => {
  it("writes a file the checker reads back, with its nodes, material and triangle count", () => {
    const gltf = readGltfJson(writeGlb([{ name: "LOD0", mesh: boxMesh([0, 0, 0], [1, 2, 3], 2) }, { name: "Fx", translation: [0, 2, 0] }]));
    expect(gltf.nodes?.map((n) => n.name)).toEqual(["LOD0", "Fx"]);
    expect(gltf.materials).toEqual([{ name: "MasterToon" }]);
    expect(countTriangles(gltf)).toBe(6 * 2 * 2 * 2);
  });

  it("winds every triangle to face out, so outlines drawn from the inside work", () => {
    const m = boxMesh([-1, -1, -1], [1, 2, 1], 2);
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!]);
      const u = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!], v = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
      const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const n = m.indices[t]! * 3;
      expect(cross[0]! * m.normals[n]! + cross[1]! * m.normals[n + 1]! + cross[2]! * m.normals[n + 2]!).toBeGreaterThan(0);
    }
  });

  it("quantises positions to within a fraction of a millimetre, with the bounds and the triangle count unchanged", () => {
    const mesh = boxMesh([-0.3, 0.1, -1.2], [1.7, 2.45, 0.4], 3);
    const q = quantizePositions(mesh.positions);
    let worst = 0;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(q.offset[i]! + (q.scale * q.values[v * 4 + i]!) / 32767 - mesh.positions[v * 3 + i]!));
    }
    expect(worst).toBeLessThan(0.0001);
    const gltf = readGltfJson(writeGlb([{ name: "LOD0", translation: [0, 1, 0], mesh }], { quantize: true })) as ReturnType<typeof readGltfJson> & { extensionsRequired?: string[]; nodes: { translation?: number[]; scale?: number[] }[] };
    expect(gltf.extensionsRequired).toEqual(["KHR_mesh_quantization"]);
    [0.7, 2.275, -0.4].forEach((t, i) => expect(gltf.nodes[0]!.translation![i]).toBeCloseTo(t, 9));
    for (const s of gltf.nodes[0]!.scale!) expect(s).toBeCloseTo(1.175, 9); // half the longest side, 2.35 m along y
    expect(countTriangles(gltf)).toBe(6 * 3 * 3 * 2);
  });
});
