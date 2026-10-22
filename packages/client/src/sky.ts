import * as THREE from "three";
import { freeze } from "./freeze";
import type { LightPreset } from "./lightPresets";

// The sky (data/look.json, `sky`): one draw call behind everything. Flat bands from the haze colour at the horizon up
// to the zenith, each step a soft edge a degree or so wide (gate V16a: a toon sky, not an airbrushed gradient), a few
// bands of flat toon clouds lit and shaded in the preset's colours, and a flat sun disc where the key light comes
// from, with a hard edge and one flat ring. No glow, no flare (DESIGN.md, Avoiding AI tells).
// It is a unit sphere seen from inside, turned with the camera but never moved, and pushed to the far plane in the
// vertex shader: it can never clip, whatever the camera's far distance or height.

export interface CloudBand {
  baseDegrees: number; // flat bottom of the band, above the horizon
  heightDegrees: number; // the tallest a cloud in it gets
  frequency: number; // clouds round the horizon, roughly
  cover: number; // share of the horizon with cloud, 0 to 1
  shade: number; // lower share of each cloud in its shade colour, the toon dark band
  seed: number; // moves the pattern so bands do not line up
}

// One step of the sky's colour: from `upDegrees` above the horizon it is `share` of the way from the horizon colour
// to the zenith colour.
export interface SkyStep {
  upDegrees: number;
  share: number;
}

export interface SkyConfig {
  steps: SkyStep[]; // in order up the sky; the last share is 1, the zenith colour
  stepSoftDegrees: number; // how wide each step's soft edge is
  sunDegrees: number; // radius of the disc
  ringDegrees: number; // width of the flat ring round it, 0 for none
  ringMix: number; // how far the ring goes from sky colour toward sun colour
  clouds: CloudBand[];
}

const MAX_BANDS = 3;
const MAX_STEPS = 4;

export function parseSky(raw: unknown): SkyConfig {
  const s = raw as SkyConfig;
  if (typeof s?.sunDegrees !== "number" || typeof s.ringDegrees !== "number" || typeof s.ringMix !== "number") throw new Error("look.json: sky needs sunDegrees, ringDegrees and ringMix");
  if (!Array.isArray(s.steps) || s.steps.length < 2 || s.steps.length > MAX_STEPS) throw new Error(`look.json: sky needs 2 to ${MAX_STEPS} steps`);
  let up = 0, share = 0;
  for (const step of s.steps) {
    if (!(typeof step?.upDegrees === "number" && typeof step.share === "number" && step.upDegrees > up && step.share > share && step.share <= 1)) {
      throw new Error("look.json: each sky step needs upDegrees and share above the step before (share at most 1)");
    }
    up = step.upDegrees;
    share = step.share;
  }
  if (share !== 1) throw new Error("look.json: the last sky step must reach the zenith colour (share 1)");
  if (!(typeof s.stepSoftDegrees === "number" && s.stepSoftDegrees > 0 && s.stepSoftDegrees < s.steps[0]!.upDegrees)) throw new Error("look.json: sky stepSoftDegrees must be above 0 and below the first step");
  if (!Array.isArray(s.clouds) || s.clouds.length > MAX_BANDS) throw new Error(`look.json: sky needs at most ${MAX_BANDS} cloud bands`);
  for (const c of s.clouds) {
    if (![c.baseDegrees, c.heightDegrees, c.frequency, c.cover, c.shade, c.seed].every((v) => typeof v === "number")) throw new Error("look.json: each cloud band needs baseDegrees, heightDegrees, frequency, cover, shade and seed");
  }
  return s;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// How far from the horizon colour toward the zenith colour the sky is, `upDegrees` above the horizon. The same sum
// as the shader, for tests and tuning.
export function skyShare(c: Pick<SkyConfig, "steps" | "stepSoftDegrees">, upDegrees: number): number {
  let share = 0;
  for (const step of c.steps) share += (step.share - share) * smoothstep(step.upDegrees - c.stepSoftDegrees, step.upDegrees + c.stepSoftDegrees, upDegrees);
  return share;
}

const VERTEX = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = p.xyww;
  }`;

// Edges are hard but one pixel wide (fwidth), so they do not crawl as the camera turns.
const FRAGMENT = `
  uniform vec3 horizon;
  uniform vec3 zenith;
  uniform vec3 sunColor;
  uniform vec3 cloudLit;
  uniform vec3 cloudShade;
  uniform vec3 sunDir;
  uniform vec2 skySteps[${MAX_STEPS}]; // up (radians), share; unused steps are past the zenith
  uniform float skySoft;
  uniform float sunCos;
  uniform float ringCos;
  uniform float ringMix;
  uniform vec4 bandShape[${MAX_BANDS}]; // base, height (radians), frequency, cover
  uniform vec2 bandLook[${MAX_BANDS}]; // shade, seed
  uniform int bands;
  varying vec3 vDir;

  float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float skyNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), f.x), mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), f.x), f.y);
  }
  float edge(float x, float at, float aa) { return smoothstep(at - aa, at + aa, x); }

  void main() {
    vec3 d = normalize(vDir);
    float up = asin(clamp(d.y, -1.0, 1.0));
    float aa = fwidth(up);
    float share = 0.0;
    for (int i = 0; i < ${MAX_STEPS}; i++) share = mix(share, skySteps[i].y, smoothstep(skySteps[i].x - skySoft, skySteps[i].x + skySoft, up));
    vec3 col = mix(horizon, zenith, share);

    float toSun = dot(d, sunDir);
    float sunAa = fwidth(toSun);
    col = mix(col, mix(col, sunColor, ringMix), edge(toSun, ringCos, sunAa));
    col = mix(col, sunColor, edge(toSun, sunCos, sunAa));

    // Round the horizon on a circle, so the noise wraps with no seam behind you.
    vec2 around = normalize(d.xz + vec2(1e-5, 0.0));
    for (int i = 0; i < ${MAX_BANDS}; i++) {
      if (i >= bands) break;
      vec4 shape = bandShape[i];
      vec2 look = bandLook[i];
      vec2 q = around * shape.z + look.y;
      float n = skyNoise(q) * 0.65 + skyNoise(q * 2.3 + 7.0) * 0.35;
      float puff = clamp((n - (1.0 - shape.w)) / max(shape.w, 0.01), 0.0, 1.0);
      float top = shape.x + shape.y * puff;
      float inCloud = edge(up, shape.x, aa) * (1.0 - edge(up, top, aa)) * step(0.001, puff);
      float lit = edge(up, shape.x + (top - shape.x) * look.x, aa);
      col = mix(col, mix(cloudShade, cloudLit, lit), inCloud);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const toRadians = Math.PI / 180;

export class Sky {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(config: SkyConfig, private color: (name: string) => string) {
    this.uniforms = {
      horizon: { value: new THREE.Color() },
      zenith: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() },
      cloudLit: { value: new THREE.Color() },
      cloudShade: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      skySteps: { value: Array.from({ length: MAX_STEPS }, (_, i) => {
        const step = config.steps[i];
        return step ? new THREE.Vector2(step.upDegrees * toRadians, step.share) : new THREE.Vector2(Math.PI, 1);
      }) },
      skySoft: { value: config.stepSoftDegrees * toRadians },
      sunCos: { value: Math.cos(config.sunDegrees * toRadians) },
      ringCos: { value: Math.cos((config.sunDegrees + config.ringDegrees) * toRadians) },
      ringMix: { value: config.ringDegrees > 0 ? config.ringMix : 0 },
      bandShape: { value: Array.from({ length: MAX_BANDS }, (_, i) => {
        const c = config.clouds[i];
        return c ? new THREE.Vector4(c.baseDegrees * toRadians, c.heightDegrees * toRadians, c.frequency, c.cover) : new THREE.Vector4();
      }) },
      bandLook: { value: Array.from({ length: MAX_BANDS }, (_, i) => new THREE.Vector2(config.clouds[i]?.shade ?? 0, config.clouds[i]?.seed ?? 0)) },
      bands: { value: config.clouds.length },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000; // first, so everything else draws over it
    freeze(this.mesh);
  }

  use(preset: LightPreset): void {
    const u = this.uniforms;
    (u.horizon!.value as THREE.Color).set(this.color(preset.haze.color));
    (u.zenith!.value as THREE.Color).set(this.color(preset.sky.zenith));
    (u.sunColor!.value as THREE.Color).set(this.color(preset.sky.sun));
    (u.cloudLit!.value as THREE.Color).set(this.color(preset.clouds.lit));
    (u.cloudShade!.value as THREE.Color).set(this.color(preset.clouds.shade));
    (u.sunDir!.value as THREE.Vector3).set(...preset.key.direction).normalize();
  }
}
