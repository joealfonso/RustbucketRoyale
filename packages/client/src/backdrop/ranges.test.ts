import * as THREE from "three";
import { describe, expect, it } from "vitest";
import backdropJson from "../../../../data/backdrop.json";
import tiersJson from "../../../../data/tiers.json";
import { Ranges, SHRINK, parseRanges, rangesMesh } from "./ranges";

const config = parseRanges(backdropJson.ranges);
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
    const ranges = new Ranges(config, new THREE.Texture(), new THREE.Color(), (c) => c);
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

  it("are cheap: one mesh of a few thousand triangles, each facing the way its normal says", () => {
    const triangles = mesh.positions.length / 9;
    expect(triangles).toBeLessThan(20000);
    expect(mesh.paints.length).toBe(triangles);
    const p = mesh.positions, n = mesh.normals;
    for (let t = 0; t < p.length; t += 9) {
      const u = [p[t + 3]! - p[t]!, p[t + 4]! - p[t + 1]!, p[t + 5]! - p[t + 2]!], v = [p[t + 6]! - p[t]!, p[t + 7]! - p[t + 1]!, p[t + 8]! - p[t + 2]!];
      const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      if (Math.hypot(...cross) < 1e-6) continue;
      expect(cross[0]! * n[t]! + cross[1]! * n[t + 1]! + cross[2]! * n[t + 2]!).toBeGreaterThan(0);
    }
  });

  it("haze more the further back a layer stands, never past full", () => {
    for (const m of mesh.mist) { expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThanOrEqual(1); }
    const mists = config.layers.map((l) => l.mist);
    const radii = config.layers.map((l) => l.radiusMeters);
    for (let i = 1; i < mists.length; i++) {
      expect(radii[i]!).toBeLessThan(radii[i - 1]!); // furthest first
      expect(mists[i]!).toBeLessThan(mists[i - 1]!);
    }
  });
});
