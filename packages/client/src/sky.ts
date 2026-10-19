import * as THREE from "three";
import { freeze } from "./freeze";
import type { LightPreset } from "./lightPresets";

// The sky (data/look.json, `sky`): one draw call behind everything. A gradient from the haze colour at the horizon to
// the zenith, a few bands of flat toon clouds, and a flat sun disc where the key light comes from, with a hard edge
// and one flat ring. No glow, no flare (DESIGN.md, Avoiding AI tells).
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

export interface SkyConfig {
  zenithCurve: number; // below 1 the zenith colour takes over quickly, above 1 the horizon colour climbs higher
  sunDegrees: number; // radius of the disc
  ringDegrees: number; // width of the flat ring round it, 0 for none
  ringMix: number; // how far the ring goes from sky colour toward sun colour
  clouds: CloudBand[];
}

const MAX_BANDS = 3;

export function parseSky(raw: unknown): SkyConfig {
  const s = raw as SkyConfig;
  if (typeof s?.zenithCurve !== "number" || typeof s.sunDegrees !== "number" || typeof s.ringDegrees !== "number" || typeof s.ringMix !== "number") throw new Error("look.json: sky needs zenithCurve, sunDegrees, ringDegrees and ringMix");
  if (!Array.isArray(s.clouds) || s.clouds.length > MAX_BANDS) throw new Error(`look.json: sky needs at most ${MAX_BANDS} cloud bands`);
  for (const c of s.clouds) {
    if (![c.baseDegrees, c.heightDegrees, c.frequency, c.cover, c.shade, c.seed].every((v) => typeof v === "number")) throw new Error("look.json: each cloud band needs baseDegrees, heightDegrees, frequency, cover, shade and seed");
  }
  return s;
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
  uniform float zenithCurve;
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
    vec3 col = mix(horizon, zenith, pow(max(d.y, 0.0), zenithCurve));

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
      zenithCurve: { value: config.zenithCurve },
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
