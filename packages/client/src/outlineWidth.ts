// How wide an outline is (gate V14): about the same number of pixels near and far, instead of a fixed width in
// metres that was 5 px wide on a crate at your feet and gone by 50 m. Past `thinFromMeters` it thins toward
// `thinShare` of that by `thinToMeters`, so far things are not wrapped in fat ink, and the width in metres is held
// between `minMeters` and `maxMeters` (a thin far prop must not drown in its own shell).
// Pixels are counted on a screen 1080 pixels tall and scale with the screen, so outlines keep their look on any
// monitor and do not jump when the dynamic resolution changes.

export interface OutlineWidth {
  pixels: number;
  minMeters: number;
  maxMeters: number;
  thinFromMeters: number;
  thinToMeters: number;
  thinShare: number;
}

const REFERENCE_HEIGHT = 1080;

export function parseOutlineWidth(raw: unknown, where: string): OutlineWidth {
  const w = raw as OutlineWidth;
  const ok = w && w.pixels > 0 && w.minMeters > 0 && w.maxMeters >= w.minMeters && w.thinFromMeters >= 0 && w.thinToMeters > w.thinFromMeters && w.thinShare > 0 && w.thinShare <= 1;
  if (!ok) throw new Error(`look.json: ${where} needs pixels and minMeters above 0, maxMeters at least minMeters, thinToMeters after thinFromMeters, thinShare above 0 to 1`);
  return w;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// The width in metres at `depth` metres in front of a camera whose projection matrix has `focal` in its y scale
// (1 / tan(half the vertical field of view)). The same sum as the shader below, for tests and tuning.
export function outlineMeters(w: OutlineWidth, depth: number, focal: number): number {
  const thin = 1 + (w.thinShare - 1) * smoothstep(w.thinFromMeters, w.thinToMeters, depth);
  const metresPerScreen = (2 * depth) / focal;
  return Math.min(Math.max((w.pixels / REFERENCE_HEIGHT) * thin * metresPerScreen, w.minMeters), w.maxMeters);
}

const f = (n: number) => n.toFixed(5);

// GLSL for `float outlineMeters(vec4 mvPosition)`, the sum above for a point in view space. An orthographic camera
// (projectionMatrix[2][3] is 0, -1 for perspective) sees the same metres per screen at every depth.
export function outlineWidthGlsl(w: OutlineWidth): string {
  return `
float outlineMeters(vec4 mvPosition) {
  float depth = max(-mvPosition.z, 0.0);
  float scale = mix(1.0, depth, -projectionMatrix[2][3]);
  float thin = mix(1.0, ${f(w.thinShare)}, smoothstep(${f(w.thinFromMeters)}, ${f(w.thinToMeters)}, depth));
  return clamp(${f(w.pixels / REFERENCE_HEIGHT)} * thin * 2.0 * scale / projectionMatrix[1][1], ${f(w.minMeters)}, ${f(w.maxMeters)});
}`;
}

// GLSL for `vec3 outlineUnit(vec3 v)`: v at length 1, or nothing for a zero vector (a hidden instance is scaled to
// nothing, and normalising that would give NaN corners).
export const OUTLINE_UNIT_GLSL = `
vec3 outlineUnit(vec3 v) { float l = length(v); return l > 1e-6 ? v / l : vec3(0.0); }`;

// Vertex shader lines, after Three's project_vertex chunk (which leaves mvPosition in view space), that move the
// vertex by `offset` (a view space vec3 in GLSL, metres per metre of outline) times the outline width there.
export function pushOutGlsl(offset: string): string {
  return `
  mvPosition.xyz += (${offset}) * outlineMeters(mvPosition);
  gl_Position = projectionMatrix * mvPosition;`;
}
