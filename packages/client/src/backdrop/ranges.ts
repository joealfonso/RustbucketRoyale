import * as THREE from "three";
import { rng, seedOf } from "../dressing/kinds";
import { distantLook } from "../haze";
import { backdropRimGlsl, inkFactor, type BackdropLook } from "./backdropLook";

// Mountain ranges on the horizon, far beyond everything round the map: a few rings of rounded ridges round the
// camera, painted like stage flats (gate V16a): each ring one flat colour, lighter and cooler the further back it
// stands (toward the light preset's `distant` colour, haze.ts), lit in the toon bands with a hard rim, and a line of
// ink along its skyline in its own colour darkened. The lower slopes are lost in soft steps of valley haze.
// They are painted like the sky: they travel with the camera on the ground plan, so they stay on the horizon of
// every map size and can never be reached, and they are drawn first with no depth test, so everything in the world
// draws over them, whatever is nearer or further. Shrunk toward the camera (which leaves the picture unchanged), so
// the camera's far plane never clips them. The scene's haze is thick at this range and would wipe them out, so they
// carry their own.
// One mesh, one material, one draw call.

type Range = [number, number];

export interface RangeLayer {
  radiusMeters: number; // from the camera to the ridge, on the ground plan
  spacingMeters: number; // between peaks round the ring
  heightMeters: Range;
  widthMeters: Range; // of a peak along the ring
  floorShare: number; // the ridge never dips below this share of the lowest peak, so the layer reads as one band
  paint: string;
  mist: number; // 0 to 1: how far toward the preset's distant colour the whole layer is
}

export interface RangesConfig {
  seed: number;
  baseMeters: number; // world height the ridges stand on, below the map's floor so no gap shows under them
  ridgePoints: number; // round each ring: enough that a peak is a curve, not a tent
  rows: number; // from foot to ridge, enough for the slope to round over at the top
  slope: number; // how far the foot reaches toward the camera, as a share of the height above it
  valleyMist: number; // extra haze at the foot of a layer, thinning to none at its tallest peaks
  mistSteps: number; // the valley haze comes in this many soft steps between none and full
  layers: RangeLayer[]; // furthest first, so nearer ridges are built (and drawn) over them
}

export const MAX_LAYERS = 4;

export function parseRanges(raw: unknown): RangesConfig {
  const c = raw as RangesConfig;
  if (typeof c?.seed !== "number" || typeof c.baseMeters !== "number" || !(c.mistSteps >= 1) || !(c.valleyMist >= 0)) throw new Error("backdrop.json: ranges needs seed, baseMeters, valleyMist and mistSteps");
  if (!(Number.isInteger(c.ridgePoints) && c.ridgePoints >= 32 && Number.isInteger(c.rows) && c.rows >= 2 && c.slope >= 0)) throw new Error("backdrop.json: ranges needs whole ridgePoints (32 or more) and rows (2 or more), and slope 0 or more");
  if (!Array.isArray(c.layers) || c.layers.length === 0 || c.layers.length > MAX_LAYERS) throw new Error(`backdrop.json: ranges needs 1 to ${MAX_LAYERS} layers`);
  for (const l of c.layers) {
    const ok = l.radiusMeters > 0 && l.spacingMeters > 0 && l.mist >= 0 && l.mist <= 1 && l.floorShare >= 0 && l.floorShare < 1 && typeof l.paint === "string"
      && Array.isArray(l.heightMeters) && l.heightMeters[0] > 0 && l.heightMeters[1] >= l.heightMeters[0] && Array.isArray(l.widthMeters) && l.widthMeters[0] > 0 && l.widthMeters[1] >= l.widthMeters[0];
    if (!ok) throw new Error("backdrop.json: each ranges layer needs radiusMeters, spacingMeters, heightMeters, widthMeters, floorShare (0 to below 1), paint and mist (0 to 1)");
  }
  return c;
}

// All the ranges round (0, 0), as one indexed mesh with smooth normals. Per corner: which layer it belongs to, how
// far below the ridge it is (for the skyline ink) and its share of valley haze. Pure numbers, so it can be tested
// without a renderer.
export interface RangesMesh {
  positions: number[];
  normals: number[];
  indices: number[];
  layer: number[];
  belowRidge: number[]; // metres
  mist: number[];
}

// How much nearer than they look the ranges are drawn: well inside any far plane, well outside the near one.
export const SHRINK = 0.05;

// The height of a layer's ridge round the ring, at `points` even angles: a peak per spacing, a lower shoulder beside
// each and a small knuckle on its far flank, the highest winning where they overlap, never below the floor. Each is
// a mountain's profile: hollow flanks rising to a rounded crown (`ROUND` of the half width), so tops are curves, not
// spikes, and the skyline still reads as mountains rather than a row of domes.
export function ridgeHeights(layer: RangeLayer, points: number, r: () => number): number[] {
  const between = ([lo, hi]: Range) => lo + (hi - lo) * r();
  const heights = new Array<number>(points).fill(layer.heightMeters[0] * layer.floorShare);
  const n = Math.max(6, Math.round((Math.PI * 2 * layer.radiusMeters) / layer.spacingMeters));
  const crown = Math.hypot(1, ROUND) - ROUND;
  const bump = (centre: number, width: number, height: number) => {
    const half = width / 2 / layer.radiusMeters; // radians
    const from = Math.floor(((centre - half) / (Math.PI * 2)) * points), to = Math.ceil(((centre + half) / (Math.PI * 2)) * points);
    for (let k = from; k <= to; k++) {
      const d = Math.abs((k / points) * Math.PI * 2 - centre) / half;
      if (d >= 1) continue;
      const i = ((k % points) + points) % points;
      const s = (Math.hypot(d, ROUND) - ROUND) / crown; // 0 at the middle, 1 at the foot, rounded over the top
      heights[i] = Math.max(heights[i]!, height * (1 - s) ** 1.6);
    }
  };
  for (let i = 0; i < n; i++) {
    const angle = ((i + r() * 0.6) / n) * Math.PI * 2;
    const width = between(layer.widthMeters), height = between(layer.heightMeters);
    const side = r() < 0.5 ? -1 : 1;
    bump(angle + (side * width * (0.3 + r() * 0.15)) / layer.radiusMeters, width * (0.6 + r() * 0.2), height * (0.5 + r() * 0.25));
    bump(angle, width, height);
    bump(angle - (side * width * (0.22 + r() * 0.1)) / layer.radiusMeters, width * 0.5, height * (0.6 + r() * 0.15));
  }
  return heights;
}

const ROUND = 0.35;

export function rangesMesh(c: RangesConfig): RangesMesh {
  const out: RangesMesh = { positions: [], normals: [], indices: [], layer: [], belowRidge: [], mist: [] };
  const n = c.ridgePoints, rows = c.rows;
  c.layers.forEach((layer, li) => {
    const ridge = ridgeHeights(layer, n, rng(seedOf(c.seed, li)));
    const tallest = layer.heightMeters[1];
    const first = out.positions.length / 3;
    // Row j of the slope, a share t up it: the height rounds over toward the ridge (a quarter sine, flat on top) and
    // the foot comes toward the camera, so the slopes face you and tilt up to the sun.
    const point = (k: number, j: number): [number, number, number] => {
      const i = ((k % n) + n) % n, t = j / (rows - 1), a = (i / n) * Math.PI * 2, top = ridge[i]!;
      const radius = layer.radiusMeters - c.slope * (1 - t) * (top - c.baseMeters);
      return [Math.cos(a) * radius, c.baseMeters + (top - c.baseMeters) * Math.sin((t * Math.PI) / 2), Math.sin(a) * radius];
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < rows; j++) {
        const p = point(i, j);
        // Smooth normals from the neighbours round the ring and up the slope, turned to face the camera.
        const along = sub(point(i + 1, j), point(i - 1, j)), up = sub(point(i, Math.min(j + 1, rows - 1)), point(i, Math.max(j - 1, 0)));
        let nx = along[1] * up[2] - along[2] * up[1], ny = along[2] * up[0] - along[0] * up[2], nz = along[0] * up[1] - along[1] * up[0];
        if (nx * p[0] + nz * p[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        out.positions.push(...p);
        out.normals.push(nx / l, ny / l, nz / l);
        out.layer.push(li);
        out.belowRidge.push(ridge[i]! - p[1]);
        out.mist.push(Math.min(1, c.valleyMist * Math.max(0, 1 - (p[1] - c.baseMeters) / tallest)));
      }
    }
    // Wound to face the camera, at the ring's middle.
    for (let i = 0; i < n; i++) {
      const a = first + i * rows, b = first + ((i + 1) % n) * rows;
      for (let j = 0; j < rows - 1; j++) out.indices.push(a + j, b + j, a + j + 1, b + j, b + j + 1, a + j + 1);
    }
  });
  return out;
}

const sub = (a: number[], b: number[]): [number, number, number] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];

export class Ranges {
  readonly mesh: THREE.Mesh;

  // `haze` is the scene's haze colour, shared so the ranges follow a change of light preset; the distant colour comes
  // the same way, from haze.ts. `rimColor` is the look's rim colour.
  constructor(config: RangesConfig, look: BackdropLook, bands: THREE.Texture, haze: THREE.Color, rimColor: string, color: (name: string) => string) {
    const m = rangesMesh(config);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3));
    geometry.setAttribute("layer", new THREE.Float32BufferAttribute(m.layer, 1));
    geometry.setAttribute("belowRidge", new THREE.Float32BufferAttribute(m.belowRidge, 1));
    geometry.setAttribute("mist", new THREE.Float32BufferAttribute(m.mist, 1));
    geometry.setIndex(m.indices);
    const material = new THREE.MeshToonMaterial({ gradientMap: bands, fog: false, depthTest: false, depthWrite: false });
    const steps = config.mistSteps.toFixed(1);
    const paints = Array.from({ length: MAX_LAYERS }, (_, i) => new THREE.Color(color(config.layers[i]?.paint ?? "#000000")));
    const mists = Array.from({ length: MAX_LAYERS }, (_, i) => config.layers[i]?.mist ?? 0);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.rangeHaze = { value: haze };
      shader.uniforms.rangeDistant = { value: distantLook.color };
      shader.uniforms.rangeDistantMist = distantLook.mist;
      shader.uniforms.rangePaint = { value: paints };
      shader.uniforms.rangeMist = { value: mists };
      shader.uniforms.rangeRim = { value: new THREE.Color(color(rimColor)) };
      // The layer's colour is worked out per corner (indexing a uniform array is safe there on every GPU).
      shader.vertexShader = shader.vertexShader.replace("void main() {", `attribute float layer;
attribute float belowRidge;
attribute float mist;
uniform vec3 rangeDistant;
uniform float rangeDistantMist;
uniform vec3 rangePaint[${MAX_LAYERS}];
uniform float rangeMist[${MAX_LAYERS}];
varying vec3 vLayerColor;
varying float vLayerMist;
varying float vBelowRidge;
varying float vMist;
void main() {
  int rangeLayer = int(layer + 0.5);
  vLayerColor = rangePaint[rangeLayer];
  vLayerMist = clamp(rangeMist[rangeLayer] * rangeDistantMist, 0.0, 1.0);
  vBelowRidge = belowRidge;
  vMist = mist;`);
      // The ink: within `pixels` of the ridge on screen, measured with the screen-space rate of `belowRidge`.
      // Then the whole layer, light, shade and ink, is laid toward the distant colour, which flattens it as distance
      // does. The valley haze: soft steps, each edge a few percent wide, as the scene's haze (haze.ts).
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec3 rangeHaze;\nuniform vec3 rangeRim;\nuniform vec3 rangeDistant;\nvarying vec3 vLayerColor;\nvarying float vLayerMist;\nvarying float vBelowRidge;\nvarying float vMist;\nvoid main() {")
        .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb = vLayerColor;")
        .replace("#include <opaque_fragment>", `${backdropRimGlsl(look.rim, "rangeRim")}
  float inkPixels = vBelowRidge / max(fwidth(vBelowRidge), 1e-6);
  outgoingLight = mix(outgoingLight, vLayerColor * ${inkFactor(look.ink.darken).toFixed(4)}, 1.0 - smoothstep(${(look.ink.pixels - 0.5).toFixed(2)}, ${(look.ink.pixels + 0.5).toFixed(2)}, inkPixels));
  outgoingLight = mix(outgoingLight, rangeDistant, vLayerMist);
  float mistLevel = vMist * ${steps};
  float mistStep = floor(mistLevel) + smoothstep(0.45, 0.55, fract(mistLevel));
  outgoingLight = mix(outgoingLight, rangeHaze, mistStep / ${steps});
  #include <opaque_fragment>`);
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
