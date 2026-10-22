import * as THREE from "three";
import { describe, expect, it } from "vitest";
import backdropJson from "../../../../data/backdrop.json";
import lookJson from "../../../../data/look.json";
import tiersJson from "../../../../data/tiers.json";
import { parseBackdropLook } from "./backdropLook";
import { Ranges, SHRINK, parseRanges, rangesMesh } from "./ranges";

const config = parseRanges(backdropJson.ranges);
const look = parseBackdropLook(lookJson.backdrop);
const mesh = rangesMesh(config);
const CAMERA_FAR = 3000; // thirdPersonCamera.ts
const tiers = Object.values(tiersJson.tiers).filter((t) => t.meters >= 300);

// Distances on the ground plan from the ring's middle (the camera) to the nearest and furthest corner, and the
// furthest straight-line distance.
function reach(): { nearest: number; furthest: number } {
  let nearest = Infinity, furthest = 0;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    nearest = Math.min(nearest, Math.hypot(p[i]!, p[i + 2]!));
    furthest = Math.max(furthest, Math.hypot(p[i]!, p[i + 1]!, p[i + 2]!));
  }
  return { nearest, furthest };
}

describe("mountain ranges", () => {
  it("are the same every time", () => {
    expect(JSON.stringify(rangesMesh(config))).toBe(JSON.stringify(mesh));
  });

  it("stand outside the map from anywhere on small and medium, and from the middle of large", () => {
    const { nearest } = reach();
    // From any spot on a map, its furthest corner is a diagonal away. On large that is more than the far plane allows,
    // so there only the middle is promised; the far corner is lost in the haze long before.
    for (const t of tiers) {
      const half = t.meters / 2;
      const promise = t.meters <= 1000 ? Math.SQRT2 * t.meters : Math.SQRT2 * half;
      expect(nearest).toBeGreaterThan(promise);
    }
  });

  it("are painted behind everything, like the sky, so no heap or hill is ever hidden by them", () => {
    const ranges = new Ranges(config, look, new THREE.Texture(), new THREE.Color(), "#ffffff", (c) => c);
    const material = ranges.mesh.material as THREE.Material;
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(ranges.mesh.renderOrder).toBeLessThan(0);
    // Shrunk toward the eye, they are drawn inside the camera's far plane, peaks and all.
    expect(reach().furthest * SHRINK).toBeLessThan(CAMERA_FAR);
    // And the shrinking keeps the picture: a peak seen from a camera up a hill is in the same direction either way.
    const eye = new THREE.Vector3(120, 40, -300);
    ranges.follow(eye);
    ranges.mesh.updateMatrixWorld();
    const p = new THREE.Vector3(mesh.positions[0], mesh.positions[1], mesh.positions[2]);
    const drawn = p.clone().applyMatrix4(ranges.mesh.matrixWorld).sub(eye).normalize();
    const real = p.clone().add(new THREE.Vector3(eye.x, 0, eye.z)).sub(eye).normalize();
    expect(drawn.distanceTo(real)).toBeLessThan(1e-6);
  });

  it("go down below the map's floor, so no gap shows under them, and rise well above the heaps", () => {
    let low = Infinity, high = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) { low = Math.min(low, mesh.positions[i]!); high = Math.max(high, mesh.positions[i]!); }
    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(400);
  });

  it("are cheap: one mesh of a few thousand triangles, each facing the camera at the middle, with smooth normals", () => {
    const triangles = mesh.indices.length / 3;
    expect(triangles).toBeLessThan(20000);
    const p = mesh.positions, n = mesh.normals;
    const at = (i: number) => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!].map(at) as [number[], number[], number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      if (Math.hypot(...cross) < 1e-6) continue;
      // Front faces toward the camera, and the corner normals agree.
      expect(cross[0]! * a[0]! + cross[2]! * a[2]!).toBeLessThan(0);
      const k = mesh.indices[t]! * 3;
      expect(cross[0]! * n[k]! + cross[1]! * n[k + 1]! + cross[2]! * n[k + 2]!).toBeGreaterThan(0);
    }
    for (let k = 0; k < n.length; k += 3) {
      expect(Math.hypot(n[k]!, n[k + 1]!, n[k + 2]!)).toBeCloseTo(1, 5);
      expect(n[k]! * p[k]! + n[k + 2]! * p[k + 2]!).toBeLessThan(0); // facing the camera
    }
  });

  it("have rounded ridges: at every peak the points either side fall away gently, a curve, not a spike", () => {
    const rows = config.rows;
    for (let li = 0; li < config.layers.length; li++) {
      const first = li * config.ridgePoints * rows;
      const top = (i: number) => mesh.positions[(first + (((i % config.ridgePoints) + config.ridgePoints) % config.ridgePoints) * rows + rows - 1) * 3 + 1]! - config.baseMeters;
      let peaks = 0;
      for (let i = 0; i < config.ridgePoints; i++) {
        if (top(i) < top(i - 1) || top(i) < top(i + 1)) continue;
        peaks++;
        expect(top(i) - Math.min(top(i - 1), top(i + 1))).toBeLessThan(top(i) * 0.05);
      }
      expect(peaks).toBeGreaterThan(5);
    }
  });

  it("mark the ridge for the ink, and haze the foot more than the top, never past full", () => {
    for (let k = 0; k < mesh.belowRidge.length; k++) {
      expect(mesh.belowRidge[k]!).toBeGreaterThanOrEqual(-1e-6);
      if (k % config.rows === config.rows - 1) expect(mesh.belowRidge[k]!).toBeCloseTo(0, 6);
    }
    for (const m of mesh.mist) { expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThanOrEqual(1); }
    expect(mesh.mist[0]!).toBeGreaterThan(mesh.mist[config.rows - 1]!);
  });

  it("are paler the further back a layer stands", () => {
    const mists = config.layers.map((l) => l.mist);
    const radii = config.layers.map((l) => l.radiusMeters);
    for (let i = 1; i < mists.length; i++) {
      expect(radii[i]!).toBeLessThan(radii[i - 1]!); // furthest first
      expect(mists[i]!).toBeLessThan(mists[i - 1]!);
    }
  });
});
