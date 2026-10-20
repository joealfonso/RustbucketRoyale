import * as THREE from "three";
import { rng, seedOf } from "../dressing/kinds";

// Rocky mountain ranges on the horizon, far beyond the scrap heaps outside the edge wall: a few rings of big faceted
// peaks round the camera, each ring paler and mistier than the one in front, the lower slopes of each lost in bands of
// haze. They are painted like the sky: they travel with the camera on the ground plan, so they stay on the horizon of
// every map size and can never be reached, and they are drawn first with no depth test, so everything in the world
// draws over them, whatever is nearer or further. Shrunk toward the camera (which leaves the picture unchanged), so the
// camera's far plane never clips them. Toon-shaded in flat bands; the haze is their own (the scene's haze is thick at
// this range, so it would wipe them out), in flat steps, toward the scene's haze colour.
// One mesh, one material, one draw call.

type Range = [number, number];

export interface RangeLayer {
  radiusMeters: number; // from the camera to the middle of each peak, on the ground plan
  spacingMeters: number; // between peaks round the ring
  heightMeters: Range;
  widthMeters: Range; // along the ring; peaks are ~0.6 as deep as they are wide
  sides: number;
  paint: string; // the slopes
  peak: string; // the facets near the top, a lighter rock where the scree gives way to crags
  mist: number; // 0 to 1: how far toward the haze colour the whole layer is pushed
}

export interface RangesConfig {
  seed: number;
  baseMeters: number; // world height the peaks stand on, below the map's floor so no gap shows under them
  valleyMist: number; // extra haze at the foot of a layer, thinning to none at its tallest peaks
  mistSteps: number; // the haze comes in this many flat steps between none and full
  layers: RangeLayer[]; // furthest first, so nearer peaks are built (and drawn) over them
}

export function parseRanges(raw: unknown): RangesConfig {
  const c = raw as RangesConfig;
  if (typeof c?.seed !== "number" || typeof c.baseMeters !== "number" || !(c.mistSteps >= 1) || !(c.valleyMist >= 0)) throw new Error("backdrop.json: ranges needs seed, baseMeters, valleyMist and mistSteps");
  if (!Array.isArray(c.layers) || c.layers.length === 0) throw new Error("backdrop.json: ranges needs layers");
  for (const l of c.layers) {
    const ok = l.radiusMeters > 0 && l.spacingMeters > 0 && l.sides >= 3 && l.mist >= 0 && l.mist <= 1 && typeof l.paint === "string" && typeof l.peak === "string"
      && Array.isArray(l.heightMeters) && l.heightMeters[1] >= l.heightMeters[0] && Array.isArray(l.widthMeters) && l.widthMeters[1] >= l.widthMeters[0];
    if (!ok) throw new Error("backdrop.json: each ranges layer needs radiusMeters, spacingMeters, heightMeters, widthMeters, sides, paint, peak and mist (0 to 1)");
  }
  return c;
}

// The triangles of all the ranges, round (0, 0): positions, a flat normal per triangle, a paint name per triangle
// and a haze share per corner. Pure numbers, so it can be tested without a renderer.
export interface RangesMesh {
  positions: number[];
  normals: number[];
  paints: string[]; // one per triangle
  mist: number[]; // one per corner
}

type V3 = [number, number, number];

// How much nearer than they look the ranges are drawn: well inside any far plane, well outside the near one.
export const SHRINK = 0.05;

export function rangesMesh(c: RangesConfig): RangesMesh {
  const out: RangesMesh = { positions: [], normals: [], paints: [], mist: [] };
  c.layers.forEach((layer, li) => {
    const r = rng(seedOf(c.seed, li));
    const between = ([lo, hi]: Range) => lo + (hi - lo) * r();
    const n = Math.max(6, Math.round((Math.PI * 2 * layer.radiusMeters) / layer.spacingMeters));
    const tallest = layer.heightMeters[1];
    const mistAt = (y: number) => Math.min(1, layer.mist + c.valleyMist * Math.max(0, 1 - (y - c.baseMeters) / tallest));
    for (let i = 0; i < n; i++) {
      const angle = ((i + r() * 0.6) / n) * Math.PI * 2;
      const radius = layer.radiusMeters * (1 + (r() - 0.5) * 0.06);
      const width = between(layer.widthMeters), height = between(layer.heightMeters);
      // A shoulder to one side, lower, so the skyline steps rather than repeating one spike.
      const side = r() < 0.5 ? -1 : 1;
      const shoulder = { along: side * width * (0.35 + r() * 0.15), width: width * (0.55 + r() * 0.2), height: height * (0.5 + r() * 0.25) };
      for (const p of [shoulder, { along: 0, width, height }]) {
        const a = angle + p.along / radius;
        peak(out, r, Math.cos(a) * radius, Math.sin(a) * radius, a, p.width, p.height, layer, c.baseMeters, mistAt);
      }
    }
  });
  return out;
}

// One peak: a jittered ring at the foot, two narrowing rings leaning off-centre, and a tip, as triangles facing out.
// Built in a frame where `along` runs round the ring and `out` points away from the camera. The far side is shallow:
// nobody sees it.
function peak(out: RangesMesh, r: () => number, cx: number, cz: number, angle: number, width: number, height: number, layer: RangeLayer, base: number, mistAt: (y: number) => number): void {
  const alongX = -Math.sin(angle), alongZ = Math.cos(angle), outX = Math.cos(angle), outZ = Math.sin(angle);
  const depth = width * 0.6;
  const back = 0.5; // the far half of the foot reaches out this share of the near half
  const sides = layer.sides, turnBy = r() * Math.PI * 2;
  const leanA = (r() - 0.5) * width * 0.25, leanO = (r() - 0.5) * depth * 0.2;
  const levels: { y: number; reach: number; lean: number }[] = [
    { y: 0, reach: 1, lean: 0 },
    { y: 0.42 + r() * 0.1, reach: 0.58 + r() * 0.1, lean: 0.4 },
    { y: 0.74 + r() * 0.08, reach: 0.26 + r() * 0.08, lean: 0.8 },
  ];
  const at = (u: number, v: number, y: number): V3 => [cx + alongX * u + outX * v, base + y, cz + alongZ * u + outZ * v];
  const rings = levels.map((l) => Array.from({ length: sides }, (_, k) => {
    const a = turnBy + ((k + (r() - 0.5) * 0.5) / sides) * Math.PI * 2;
    const reach = l.reach * (0.8 + r() * 0.3);
    const v = Math.sin(a) * (depth / 2) * reach;
    return at(Math.cos(a) * (width / 2) * reach + leanA * l.lean, (v > 0 ? v * back : v) + leanO * l.lean, height * l.y * (l.y === 0 ? 1 : 0.94 + r() * 0.12));
  }));
  const tip = at(leanA, leanO, height);
  // The peak's leaning middle line, at world height y.
  const axis = (y: number): V3 => at(leanA * ((y - base) / height), leanO * ((y - base) / height), y - base);
  const tri = (a: V3, b: V3, c: V3) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1]! * v[2]! - u[2]! * v[1]!, ny = u[2]! * v[0]! - u[0]! * v[2]!, nz = u[0]! * v[1]! - u[1]! * v[0]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // Face away from the peak's own axis at that height.
    const my = (a[1] + b[1] + c[1]) / 3, centre = axis(my);
    const mx = (a[0] + b[0] + c[0]) / 3 - centre[0], mz = (a[2] + b[2] + c[2]) / 3 - centre[2];
    const flip = nx * mx + nz * mz + ny * 0.01 < 0;
    const corners = flip ? [a, c, b] : [a, b, c];
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    for (const p of corners) { out.positions.push(...p); out.normals.push(nx, ny, nz); out.mist.push(mistAt(p[1])); }
    out.paints.push(my - base > height * 0.62 ? layer.peak : layer.paint);
  };
  for (let l = 0; l < rings.length - 1; l++) {
    const a = rings[l]!, b = rings[l + 1]!;
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      tri(a[k]!, a[j]!, b[j]!);
      tri(a[k]!, b[j]!, b[k]!);
    }
  }
  const top = rings[rings.length - 1]!;
  for (let k = 0; k < sides; k++) tri(top[k]!, top[(k + 1) % sides]!, tip);
}

export class Ranges {
  readonly mesh: THREE.Mesh;

  // `haze` is the scene's haze colour, shared so the ranges follow a change of light preset.
  constructor(config: RangesConfig, bands: THREE.Texture, haze: THREE.Color, color: (name: string) => string) {
    const m = rangesMesh(config);
    const colors = new Float32Array(m.positions.length);
    const c = new THREE.Color();
    m.paints.forEach((paint, t) => {
      c.set(color(paint));
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (t * 3 + k) * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("mist", new THREE.Float32BufferAttribute(m.mist, 1));
    const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: bands, fog: false, depthTest: false, depthWrite: false });
    const steps = config.mistSteps.toFixed(1);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.rangeHaze = { value: haze };
      shader.vertexShader = shader.vertexShader.replace("void main() {", "attribute float mist;\nvarying float vMist;\nvoid main() {\n  vMist = mist;");
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec3 rangeHaze;\nvarying float vMist;\nvoid main() {")
        .replace("#include <opaque_fragment>", `outgoingLight = mix(outgoingLight, rangeHaze, floor(vMist * ${steps} + 0.5) / ${steps});\n#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => `ranges-${steps}`;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "mountain ranges";
    this.mesh.frustumCulled = false; // it rings the camera, so some of it is always in view
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = -999; // straight after the sky (-1000), before anything else
    this.mesh.scale.setScalar(SHRINK);
  }

  // Keeps the ranges round the camera. Call each frame once the camera has moved.
  follow(camera: THREE.Vector3): void {
    // Shrunk about the eye: a point p of the ranges is drawn at eye + SHRINK * (p - eye), which looks the same from the
    // eye, nearer. The ranges stand round the eye on the ground plan and on the world's ground in height.
    this.mesh.position.set(camera.x, camera.y * (1 - SHRINK), camera.z);
    this.mesh.updateMatrix();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
