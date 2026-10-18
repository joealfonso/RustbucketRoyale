import { describe, expect, it } from "vitest";
import propsJson from "../../../../data/props.json";
import type { DressPiece } from "../dressing/kinds";
import { triangleCount } from "../dressing/builderChecks";
import { PROP_MODELS } from "./index";

const SLACK = 0.06;
const BUDGET: Record<string, { intact: number; destroyed: number; brokenHeight: number }> = {
  crate: { intact: 500, destroyed: 400, brokenHeight: 0.5 },
  junk: { intact: 700, destroyed: 400, brokenHeight: 0.5 },
  barrel: { intact: 400, destroyed: 400, brokenHeight: 0.6 },
};
const SEEDS = [1, 4242, 987654321];

// What is wrong with a set of pieces in a prop's frame (empty when all is well): vertices outside the box, faces
// wound against their normals, pieces with no paint or more than one piece per paint.
function problems(pieces: DressPiece[], size: [number, number, number]): string[] {
  const out: string[] = [];
  const lo = [-size[0] / 2 - SLACK, -SLACK, -size[2] / 2 - SLACK], hi = [size[0] / 2 + SLACK, size[1] + SLACK, size[2] / 2 + SLACK];
  if (new Set(pieces.map((p) => p.paint)).size !== pieces.length) out.push("two pieces share a paint");
  for (const { paint, mesh } of pieces) {
    if (!paint) out.push("a piece has no paint");
    const { positions: p, normals: n, indices } = mesh;
    for (let i = 0; i < p.length; i += 3) {
      for (let a = 0; a < 3; a++) if (!Number.isFinite(p[i + a]!) || p[i + a]! < lo[a]! || p[i + a]! > hi[a]!) { out.push(`${paint}: vertex outside (${p.slice(i, i + 3).map((v) => v.toFixed(2))})`); i = p.length; break; }
    }
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3];
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
      const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      if (Math.hypot(...cross) < 1e-9) continue;
      if (cross[0]! * n[a]! + cross[1]! * n[a + 1]! + cross[2]! * n[a + 2]! <= 0) { out.push(`${paint}: a triangle faces the wrong way`); break; }
    }
  }
  return out;
}

const topOf = (pieces: DressPiece[]) => Math.max(...pieces.flatMap((p) => p.mesh.positions.filter((_, i) => i % 3 === 1)));

describe("prop models", () => {
  for (const type of propsJson.types) {
    const size = type.size as [number, number, number];
    describe(type.id, () => {
      const build = PROP_MODELS[type.id]!;
      const budget = BUDGET[type.id]!;

      it("has a model", () => expect(build).toBeDefined());

      for (const seed of SEEDS) {
        it(`keeps the rules for seed ${seed}`, () => {
          const { intact, destroyed } = build(size, seed);
          expect(intact.length).toBeGreaterThan(0);
          expect(destroyed.length).toBeGreaterThan(0);
          expect(problems(intact, size)).toEqual([]);
          expect(problems(destroyed, size)).toEqual([]);
          expect(triangleCount(intact)).toBeLessThan(budget.intact);
          expect(triangleCount(destroyed)).toBeLessThan(budget.destroyed);
          expect(topOf(destroyed)).toBeLessThan(budget.brokenHeight);
          expect(JSON.stringify(build(size, seed))).toBe(JSON.stringify({ intact, destroyed }));
        });
      }

      it("stands as cover up to near its full height", () => {
        expect(topOf(build(size, SEEDS[0]!).intact)).toBeGreaterThan(size[1] - 0.1);
      });
    });
  }
});
