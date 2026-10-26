import * as THREE from "three";

// Warm haze in place of Three's fog, for every material that takes fog (toon, world, ground, outlines, props, mechs)
// with no work per material: the four fog shader chunks are swapped once, before anything compiles.
// It reuses the fog uniforms Three already sends each frame: fogColor, and fogNear / fogFar from a THREE.Fog, read
// as "haze starts here" and "ground-level haze is 98% thick here". The haze is thickest at the ground (y = 0, the
// height of every map's edge; valleys dip a little into thicker haze and hilltops rise out of it) and thins with
// height, so tall things far away stay readable and the open ground melts into the sky.
// The haze comes in steps (gate V16a, DESIGN.md Lighting): the smooth amount above is cut into two or three flat
// bands, each its own tint from the light preset, with soft edges, so the distance reads as painted layers instead of
// one long fade. Past the last step everything goes fully to the haze colour, which is the sky's horizon, so far
// ground still melts into the sky with no seam. Stepping the amount rather than the distance keeps the height
// thinning: a tall thing far away sits in a nearer band than the ground at its foot.
// The thinning rate and the softness of the step edges are one number each for the whole game, baked into the shader.

// Steps a preset may have; one more slot holds the last step up to full haze.
export const MAX_HAZE_STEPS = 3;
const SLOTS = MAX_HAZE_STEPS + 1;
const OFF = 2; // a step at this amount is never reached (the smooth amount stops at 1)

export interface HazeStep {
  at: number; // where the step is, as the smooth haze amount it starts at, 0 to 1
  amount: number; // how much haze from there on, 0 to 1
  tint: string; // the haze colour in this band
}

// One preset's haze (look.json, light.presets[].haze).
export interface PresetHaze {
  color: string; // the last band's colour and the sky's horizon
  near: number; // haze starts here, in metres
  far: number; // ground-level haze is 98% thick here (before stepping)
  steps: HazeStep[];
  fullAt: number; // the smooth amount from which everything is the haze colour
  distant: string; // the colour the far mountain ranges fade toward, lighter and cooler with distance (ranges.ts)
  rangeMist: number; // how far toward `distant` the ranges go, times each layer's own mist
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function parsePresetHaze(raw: unknown, where: string): PresetHaze {
  const h = raw as PresetHaze;
  if (!isText(h?.color) || !isNumber(h.near) || !isNumber(h.far) || h.near < 0 || h.far <= h.near) throw new Error(`${where} needs haze colour and near < far`);
  if (!Array.isArray(h.steps) || h.steps.length < 1 || h.steps.length > MAX_HAZE_STEPS) throw new Error(`${where} needs 1 to ${MAX_HAZE_STEPS} haze steps`);
  let at = 0, amount = 0;
  for (const s of h.steps) {
    if (!(isNumber(s?.at) && isNumber(s.amount) && isText(s.tint) && s.at > at && s.amount > amount && s.amount < 1)) {
      throw new Error(`${where}: each haze step needs a tint, and at and amount above the step before (amount below 1)`);
    }
    at = s.at;
    amount = s.amount;
  }
  if (!(isNumber(h.fullAt) && h.fullAt > at && h.fullAt < 1)) throw new Error(`${where}: haze fullAt must be after the last step, below 1`);
  if (!isText(h.distant) || !(isNumber(h.rangeMist) && h.rangeMist >= 0 && h.rangeMist <= 1)) throw new Error(`${where} needs haze distant colour and rangeMist 0 to 1`);
  return h;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// The stepped haze for a smooth amount `f`: how much haze, and which band's tint (an index, fractional across a soft
// edge, the last being the haze colour). The same sum as the shader, for tests and tuning.
export function steppedHaze(f: number, h: Pick<PresetHaze, "steps" | "fullAt">, softness: number): { amount: number; band: number } {
  let amount = 0, band = 0;
  const all = [...h.steps.map((s) => [s.at, s.amount] as const), [h.fullAt, 1] as const];
  all.forEach(([at, to], i) => {
    const s = smoothstep(at - softness, at + softness, f);
    amount += (to - amount) * s;
    band += (i - band) * s;
  });
  return { amount, band };
}

// Shared by every material's haze: (at, amount) and a linear colour per slot. Three gives each material its own copy
// of its uniforms, cloning colours, vectors and plain arrays, but it hands a typed array over as it is, so every copy
// holds these same two arrays: changing them here changes every material at once, with no work per material
// (docs/DECISIONS.md, V16a).
const steps = new Float32Array(SLOTS * 2).fill(OFF);
const tints = new Float32Array(SLOTS * 3);
const hazeUniforms = { hazeSteps: { value: steps }, hazeTints: { value: tints } };
const tint = new THREE.Color();

// Added at import, before any material is made: to the uniforms every built-in material copies from, and to the fog
// uniforms a ShaderMaterial merges in (fx/sprites.ts).
for (const lib of [THREE.UniformsLib.fog as Record<string, THREE.IUniform>, ...Object.values(THREE.ShaderLib).map((s) => s.uniforms)]) {
  if (lib.fogColor) Object.assign(lib, hazeUniforms);
}

// The colour the far ranges fade toward and how far, for this preset (ranges.ts reads them each frame).
export const distantLook = { color: new THREE.Color(), mist: { value: 1 } };

// Points every material's haze at a preset. `color` turns palette names into hex.
export function useHaze(h: PresetHaze, color: (name: string) => string): void {
  h.steps.forEach((s, i) => {
    steps.set([s.at, s.amount], i * 2);
    tint.set(color(s.tint)).toArray(tints, i * 3);
  });
  steps.set([h.fullAt, 1], h.steps.length * 2);
  tint.set(color(h.color)).toArray(tints, h.steps.length * 3);
  for (let i = h.steps.length + 1; i < SLOTS; i++) steps.set([OFF, 1], i * 2);
  distantLook.color.set(color(h.distant));
  distantLook.mist.value = h.rangeMist;
}

let installed: string | null = null;

export function installHaze(heightFalloff: number, softness: number): void {
  const key = `${heightFalloff}/${softness}`;
  if (installed === key) return;
  if (installed !== null) throw new Error("haze: the height falloff and step softness are baked into shaders, set them once");
  installed = key;
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying vec3 vHazeRay;
#endif`;
  // From the camera to this point, in world space. mvPosition is that offset in view space; the view matrix only
  // turns and moves, so turning it back needs only the transpose.
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vHazeRay = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec2 hazeSteps[${SLOTS}];
  uniform vec3 hazeTints[${SLOTS}];
  varying vec3 vHazeRay;
#endif`;
  // Density falls off as exp(-falloff * height); `lift` is its average along the ray (1 at the ground, less above,
  // more for a ray heading down). The distance past `near` is squared, so the near field stays clear and the far
  // field closes in quickly. 1.978 = sqrt(ln 50): exactly 98% at `far` for a ray along the ground.
  // Then the steps, as steppedHaze above.
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  float hazeFalloff = ${heightFalloff.toFixed(5)};
  float hazeRise = vHazeRay.y * hazeFalloff;
  float hazeLift = exp(-max(cameraPosition.y, 0.0) * hazeFalloff) * (abs(hazeRise) > 1e-4 ? (1.0 - exp(-hazeRise)) / hazeRise : 1.0);
  float hazeDepth = max(length(vHazeRay) - fogNear, 0.0) * 1.978 / max(fogFar - fogNear, 1.0);
  float fogFactor = 1.0 - exp(-hazeDepth * hazeDepth * hazeLift);
  float hazeAmount = 0.0;
  vec3 hazeTint = hazeTints[0];
  for (int i = 0; i < ${SLOTS}; i++) {
    float hazeEdge = smoothstep(hazeSteps[i].x - ${softness.toFixed(4)}, hazeSteps[i].x + ${softness.toFixed(4)}, fogFactor);
    hazeAmount = mix(hazeAmount, hazeSteps[i].y, hazeEdge);
    hazeTint = mix(hazeTint, hazeTints[i], hazeEdge);
  }
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeTint, hazeAmount);
#endif`;
}
