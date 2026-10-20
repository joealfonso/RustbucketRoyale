import { describe, expect, it } from "vitest";
import forestJson from "../../../../data/forest.json";
import propsJson from "../../../../data/props.json";
import { parseForest } from "./config";
import { farPine, pineModel, stump, triangleCount, type Part } from "./pineModel";
import { treeLook } from "./variety";

const forest = parseForest(forestJson);
const look = forest.pine;
const box = propsJson.types.find((t) => t.id === "pine")!.size; // the trunk's collision box: [1, 12, 1]
const widest = look.scale.width[1], tallest = look.scale.height[1];

// The furthest any vertex of the parts reaches from the trunk's middle line, on the ground plan, at the widest scale.
function spread(parts: Part[]): number {
  let most = 0;
  for (const { mesh } of parts) for (let i = 0; i < mesh.positions.length; i += 3) most = Math.max(most, Math.abs(mesh.positions[i]!), Math.abs(mesh.positions[i + 2]!));
  return most * widest;
}

function facesOutward(parts: Part[]): boolean {
  for (const { mesh } of parts) {
    const { positions: p, normals: n, indices } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3];
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!], v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      if (Math.hypot(...cross) < 1e-9) continue;
      if (cross[0]! * n[a]! + cross[1]! * n[a + 1]! + cross[2]! * n[a + 2]! <= 0) return false;
    }
  }
  return true;
}

describe("pine model", () => {
  it("keeps every trunk inside its 1 m collision box at the widest a tree is drawn", () => {
    look.shapes.forEach((_, s) => expect(spread(pineModel(look, s).wood)).toBeLessThanOrEqual(box[0]! / 2));
    expect(spread(stump(look))).toBeLessThanOrEqual(box[0]! / 2);
    // The far model's trunk is its first part.
    expect(spread(farPine(look).slice(0, 1))).toBeLessThanOrEqual(box[0]! / 2);
  });

  it("stands as tall as its box at most, with the crown high enough to walk a mech under", () => {
    for (let s = 0; s < look.shapes.length; s++) {
      const m = pineModel(look, s);
      expect(m.top * tallest).toBeLessThanOrEqual(box[1]! + 0.01);
      for (const t of look.shapes[s]!.tiers) expect(t.bottom).toBeGreaterThanOrEqual(look.crown.fromMeters - 0.5);
    }
  });

  it("faces every triangle outward, so the outline drawn from inside only shows at the rim", () => {
    for (let s = 0; s < look.shapes.length; s++) {
      const m = pineModel(look, s);
      expect(facesOutward([...m.wood, ...m.crown])).toBe(true);
    }
    expect(facesOutward(farPine(look))).toBe(true);
    expect(facesOutward(stump(look))).toBe(true);
  });

  it("is cheap near and much cheaper far", () => {
    for (let s = 0; s < look.shapes.length; s++) {
      const m = pineModel(look, s);
      expect(triangleCount([...m.wood, ...m.crown])).toBeLessThan(160);
    }
    expect(triangleCount(farPine(look))).toBeLessThan(40);
  });

  it("keeps the far model the same height and spread as the near one, so the switch does not jump", () => {
    const near = pineModel(look, 0), far = farPine(look);
    let farTop = 0;
    for (const { mesh } of far) for (let i = 1; i < mesh.positions.length; i += 3) farTop = Math.max(farTop, mesh.positions[i]!);
    expect(Math.abs(farTop - near.top)).toBeLessThan(0.5);
    expect(spread(far)).toBeLessThanOrEqual(spread(near.crown));
    expect(spread(far)).toBeGreaterThan(spread(near.crown) * 0.8);
  });
});

describe("tree variety", () => {
  it("is the same tree for the same map and id, and differs between ids", () => {
    expect(treeLook(look, 11, 40)).toEqual(treeLook(look, 11, 40));
    const looks = Array.from({ length: 200 }, (_, id) => treeLook(look, 11, id));
    expect(new Set(looks.map((l) => l.color)).size).toBe(look.colors.length);
    expect(new Set(looks.map((l) => l.shape)).size).toBe(look.shapes.length);
    for (const l of looks) {
      expect(l.width).toBeGreaterThanOrEqual(look.scale.width[0]);
      expect(l.width).toBeLessThanOrEqual(look.scale.width[1]);
      expect(l.height).toBeGreaterThanOrEqual(look.scale.height[0]);
      expect(l.height).toBeLessThanOrEqual(look.scale.height[1]);
    }
  });
});

describe("forest config", () => {
  it("refuses a trunk that would poke out of its collision box", () => {
    const wide = structuredClone(forestJson);
    wide.pine.trunk.radius = 0.48;
    expect(() => parseForest(wide)).toThrow(/collision box/);
  });
});
