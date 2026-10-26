import { describe, expect, it } from "vitest";
import dressingJson from "../../../../data/dressing.json";
import { boulder, parseStone } from "./rock";
import { box, type MeshData } from "./shapes";
import { ellipsoidNormal, smoothNormals, towardEllipsoid } from "./softNormals";
import { rng } from "./kinds";

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));
const normalAt = (m: MeshData, v: number) => [m.normals[v * 3]!, m.normals[v * 3 + 1]!, m.normals[v * 3 + 2]!];

describe("soft normals", () => {
  it("points out from the middle of a sphere, and across a squashed ellipsoid's surface", () => {
    close(ellipsoidNormal([3, 0, 0], [0, 0, 0], [2, 2, 2]), [1, 0, 0]);
    close(ellipsoidNormal([1, 1, 0], [0, 0, 0], [2, 2, 2]), [Math.SQRT1_2, Math.SQRT1_2, 0]);
    // On a flat ellipsoid (twice as wide as tall) a point halfway up the diagonal faces up more than out.
    const n = ellipsoidNormal([1, 1, 0], [0, 0, 0], [2, 1, 2]);
    expect(n[1]).toBeGreaterThan(n[0]);
    expect(Math.hypot(...n)).toBeCloseTo(1, 6);
    close(ellipsoidNormal([5, 5, 5], [5, 5, 5], [1, 1, 1]), [0, 1, 0]);
  });

  it("bends normals by the share asked, leaving positions alone", () => {
    const flat = box([0, 0, 0], [2, 2, 2]);
    const positions = [...flat.positions];
    const none = towardEllipsoid(box([0, 0, 0], [2, 2, 2]), [0, 0, 0], [1, 1, 1], 0);
    none.normals.forEach((n, i) => expect(n).toBeCloseTo(flat.normals[i]!, 9));
    const full = towardEllipsoid(box([0, 0, 0], [2, 2, 2]), [0, 0, 0], [1, 1, 1], 1);
    expect(full.positions).toEqual(positions);
    // Every corner of the cube now faces along its own diagonal, whichever face it belongs to.
    for (let v = 0; v < full.positions.length / 3; v++) {
      const p = [full.positions[v * 3]!, full.positions[v * 3 + 1]!, full.positions[v * 3 + 2]!];
      close(normalAt(full, v), p.map((c) => c / Math.hypot(...p)));
    }
  });

  it("smooths shallow edges and keeps sharp ones", () => {
    // A cube's edges are 90 degrees: under 90 they stay sharp, so the normals are unchanged.
    const cube = box([0, 0, 0], [2, 2, 2]);
    expect(smoothNormals(box([0, 0, 0], [2, 2, 2]), 80).normals.map((n) => +n.toFixed(6))).toEqual(cube.normals.map((n) => +n.toFixed(6)));
    // Over 90 every corner of a cube takes the average of its three faces.
    const round = smoothNormals(box([0, 0, 0], [2, 2, 2]), 91);
    for (let v = 0; v < round.positions.length / 3; v++) {
      const p = [round.positions[v * 3]!, round.positions[v * 3 + 1]!, round.positions[v * 3 + 2]!];
      close(normalAt(round, v), p.map((c) => Math.sign(c) / Math.sqrt(3)));
    }
  });

  it("gives a boulder (nearly) one normal per corner position above its foot, so its bands are broad, not facets", () => {
    for (let seed = 1; seed < 20; seed++) {
      const stone = boulder(rng(seed), -1.5, 1.5, -1, 1, 1.6);
      const seen = new Map<string, number[]>();
      let shared = 0, split = 0;
      for (let v = 0; v < stone.positions.length / 3; v++) {
        if (stone.positions[v * 3 + 1]! < 0.01) continue; // the flat underside stays sharp against the flanks
        const key = [0, 1, 2].map((a) => stone.positions[v * 3 + a]!.toFixed(3)).join();
        const n = normalAt(stone, v), first = seen.get(key);
        if (first) {
          if (first[0]! * n[0]! + first[1]! * n[1]! + first[2]! * n[2]! > 0.999) shared++;
          else split++;
        } else seen.set(key, n);
      }
      expect(shared, `seed ${seed}`).toBeGreaterThan(split * 9);
    }
  });

  it("checks the stone look", () => {
    expect(() => parseStone(dressingJson.stone)).not.toThrow();
    expect(() => parseStone({ ...dressingJson.stone, smoothDegrees: 95 })).toThrow(/stone/);
    expect(() => parseStone({ ...dressingJson.stone, round: 1.5 })).toThrow(/stone/);
    expect(() => parseStone(undefined)).toThrow(/stone/);
  });
});
