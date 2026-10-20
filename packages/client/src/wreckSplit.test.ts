import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LEFT, MIDDLE, RIGHT, sideOf, splitBySide } from "./wreckSplit";

const box = (x: number, width = 0.5) => new THREE.BoxGeometry(width, 1, 0.5).translate(x, 2, 0).toNonIndexed();
const triangles = (g: THREE.BufferGeometry | null | undefined) => (g ? g.attributes.position!.count / 3 : 0);

describe("splitBySide", () => {
  it("cuts merged arms into left, middle and right, keeping every triangle and attribute", () => {
    // Two arms and a turret in the middle that reaches past the middle band: it stays whole, by its middle.
    const merged = mergeGeometries([box(-1.4), box(0, 1.6), box(1.4)])!;
    const [left, middle, right] = splitBySide(merged, 0.6);
    expect([triangles(left), triangles(middle), triangles(right)]).toEqual([12, 12, 12]);
    expect(left!.attributes.normal).toBeDefined();
    left!.computeBoundingBox();
    expect(left!.boundingBox!.max.x).toBeLessThan(-0.6);
    middle!.computeBoundingBox();
    expect(middle!.boundingBox!.min.x).toBeCloseTo(-0.8);
  });

  it("gives null for a side with nothing on it, and the same geometries the second time", () => {
    const merged = mergeGeometries([box(1.4)])!;
    const sides = splitBySide(merged, 0.6);
    expect(sides[LEFT]).toBeNull();
    expect(sides[MIDDLE]).toBeNull();
    expect(splitBySide(merged, 0.6)[RIGHT]).toBe(sides[RIGHT]);
  });

  it("sorts by the middle band", () => {
    expect([sideOf(-1, 0.6), sideOf(0.5, 0.6), sideOf(0.7, 0.6)]).toEqual([LEFT, MIDDLE, RIGHT]);
  });
});
