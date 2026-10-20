import { describe, expect, it } from "vitest";
import { box, cylinder, merge } from "../../packages/client/src/dressing/shapes";
import { hardSurface, parseHardSurfaceLook } from "./hardSurface";

const look = { smoothAngleDegrees: 50, bigShare: 0.4, wearWidthMeters: 0.09 };
const at = (a: number[], v: number) => [a[v * 3]!, a[v * 3 + 1]!, a[v * 3 + 2]!];
const close = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]!) < 1e-6);

describe("hard-surface normals", () => {
  // A 2 x 1 x 1 m box with 5 cm chamfers: big flat sides, thin 45 degree strips along every edge.
  const mesh = box([0, 0, 0], [2, 1, 1], 0.05);
  const { normals, wear } = hardSurface(mesh, look);
  const vertices = mesh.positions.length / 3;
  const axis = (n: number[]) => n.filter((x) => Math.abs(x) > 0.999).length === 1;

  it("keeps every big face's own flat normal, so the plates shade flat", () => {
    let big = 0;
    for (let v = 0; v < vertices; v++) {
      if (!axis(at(mesh.normals, v))) continue; // the sides of the box face along an axis; chamfers do not
      big++;
      expect(at(normals, v)).toEqual(at(mesh.normals, v));
      expect(wear[v]).toBe(0);
    }
    expect(big).toBe(4 * 4 + 2 * 8); // four corners on each long side, eight on each octagonal end (as box() builds it)
  });

  it("turns each chamfer from one plate's normal to the other's across its width, and marks it as an edge", () => {
    // The chamfer along the top front edge (between +y and +z, running along x): two corners on the top face, two on the front.
    const chamfer: number[] = [];
    for (let v = 0; v < vertices; v++) {
      const n = at(mesh.normals, v);
      if (Math.abs(n[0]!) < 1e-6 && n[1]! > 0.7 && n[2]! > 0.7) chamfer.push(v);
    }
    expect(chamfer.length).toBe(4);
    for (const v of chamfer) {
      const [, y, z] = at(mesh.positions, v);
      // The corner on the top face's edge takes the top's normal; the one on the front face's edge takes the front's.
      if (y! > 0.499) expect(close(at(normals, v), [0, 1, 0])).toBe(true);
      else if (z! > 0.499) expect(close(at(normals, v), [0, 0, 1])).toBe(true);
      else throw new Error("a chamfer corner off both faces");
      expect(wear[v]).toBe(1);
    }
  });

  it("leaves a plain box alone: equal faces at right angles are all big, and none is an edge", () => {
    const plain = box([0, 0, 0], [1, 1, 1]);
    const out = hardSurface(plain, look);
    expect(out.normals).toEqual(plain.normals);
    expect(out.wear.every((w) => w === 0)).toBe(true);
  });

  it("leaves the narrow sides of a thin plate hard, but marks them as its worn rim", () => {
    const plate = box([0, 0, 0], [1, 0.04, 1]);
    const out = hardSurface(plate, look);
    expect(out.normals).toEqual(plate.normals); // at 90 degrees they are past the smoothing angle
    for (let v = 0; v < plate.positions.length / 3; v++) expect(out.wear[v]).toBe(Math.abs(at(plate.normals, v)[1]!) > 0.5 ? 0 : 1);
  });

  it("does not mark the sides of a thick slab as worn edges, so chips stay thin lines", () => {
    const slab = box([0, 0, 0], [1, 0.15, 1]);
    expect(hardSurface(slab, look).wear.every((w) => w === 0)).toBe(true);
  });

  it("never blends across two separate solids that only touch", () => {
    // A small block standing on a big one shares corner positions with its top, but no edge with its faces.
    const pair = merge(box([0, 0, 0], [2, 1, 2]), box([0.95, 0.55, 0.95], [0.1, 0.1, 0.1]));
    const out = hardSurface(pair, look);
    expect(out.normals).toEqual(pair.normals);
  });

  it("keeps a cylinder's equal sides faceted, as its script built it", () => {
    const tube = cylinder([0, 0, 0], 0.2, 1, "y", 8);
    expect(hardSurface(tube, look).normals).toEqual(tube.normals);
  });

  it("checks its numbers", () => {
    expect(() => parseHardSurfaceLook({ ...look, smoothAngleDegrees: 95 })).toThrow(/smoothAngleDegrees/);
    expect(() => parseHardSurfaceLook({ ...look, bigShare: 0 })).toThrow(/bigShare/);
  });
});
