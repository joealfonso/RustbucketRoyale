import * as THREE from "three";

// The colour grade (gate V16b): three small curves over the finished frame, per light preset (data/look.json
// `grade`), so each sky gets its own push without touching a single material. In screen colours, darkest first:
//  - mids: more saturation around a middle brightness, fading out over `width` either side, so the toon bands of
//    the ground and the paint gain colour while black ink and white glints stay where they are;
//  - shadows: under `upTo` brightness, most at black, the colour turned toward a cool `tint` by `amount` without
//    changing its brightness, and lifted by `lift` of that tint, so the soot side of things leans toward the sky
//    instead of sinking to grey. The lift flattens contrast, so it stays small (none on overcast, which is flat
//    enough already);
//  - highlights: the bright end turned toward a warm colour above `from`, keeping its brightness, so lit faces read
//    as sunlit.
// It is one full-screen pass: the scene (and the crease lines, when on) is drawn into a target of its own and this
// copies it to the screen. The HUD is HTML on top, so it is never graded. The CRT look is CSS on the HUD, so the
// grade is the same with it on or off. No blur and no glow: every pixel only reads itself.

export interface GradeCurves {
  mids: { saturation: number; center: number; width: number };
  shadows: { tint: string; amount: number; lift: number; upTo: number };
  highlights: { tint: string; amount: number; from: number };
}

export interface GradeConfig {
  presets: Record<string, GradeCurves>;
}

const isShare = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1;
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

// Every light preset needs its grade, and a grade for a preset that does not exist is a typo.
export function parseGrade(raw: unknown, presetNames: readonly string[]): GradeConfig {
  const presets = (raw as GradeConfig | undefined)?.presets;
  if (typeof presets !== "object" || presets === null) throw new Error("look.json: grade needs presets, one per light preset");
  for (const name of presetNames) if (!presets[name]) throw new Error(`look.json: grade needs a preset for light preset ${name}`);
  for (const [name, g] of Object.entries(presets)) {
    const where = `look.json: grade preset ${name}`;
    if (!presetNames.includes(name)) throw new Error(`${where} names no light preset`);
    const m = g?.mids, s = g?.shadows, h = g?.highlights;
    if (!(m && typeof m.saturation === "number" && m.saturation >= -1 && m.saturation <= 1 && isShare(m.center) && typeof m.width === "number" && m.width > 0 && m.width <= 1)) {
      throw new Error(`${where} needs mids saturation -1 to 1, center 0 to 1 and width above 0, at most 1`);
    }
    if (!(s && isText(s.tint) && isShare(s.amount) && isShare(s.lift) && typeof s.upTo === "number" && s.upTo > 0 && s.upTo <= 1)) throw new Error(`${where} needs shadows tint, amount and lift 0 to 1 and upTo above 0, at most 1`);
    if (!(h && isText(h.tint) && isShare(h.amount) && typeof h.from === "number" && h.from >= 0 && h.from < 1)) throw new Error(`${where} needs highlights tint, amount 0 to 1 and from 0 up to (not including) 1`);
  }
  return { presets };
}

// The curves as plain numbers, colours in screen values 0 to 1: what the shader's uniforms hold.
export interface GradeNumbers {
  saturation: number; center: number; width: number;
  lift: [number, number, number]; upTo: number; // added at black: the tint's colour less its brightness times amount, plus the tint times lift
  warm: [number, number, number]; warmAmount: number; from: number; // the highlights' tint over its own brightness
}

const LUMA: [number, number, number] = [0.2126, 0.7152, 0.0722];
const luma = (r: number, g: number, b: number) => r * LUMA[0] + g * LUMA[1] + b * LUMA[2];

export function gradeNumbers(g: GradeCurves, color: (name: string) => string): GradeNumbers {
  const screen = (name: string) => new THREE.Color(color(name)).convertLinearToSRGB();
  const cool = screen(g.shadows.tint);
  const c = luma(cool.r, cool.g, cool.b);
  const lift = [cool.r, cool.g, cool.b].map((v) => (v - c) * g.shadows.amount + v * g.shadows.lift) as [number, number, number];
  const warm = screen(g.highlights.tint);
  const w = Math.max(luma(warm.r, warm.g, warm.b), 1e-4);
  return {
    saturation: g.mids.saturation, center: g.mids.center, width: g.mids.width,
    lift, upTo: g.shadows.upTo,
    warm: [warm.r / w, warm.g / w, warm.b / w], warmAmount: g.highlights.amount, from: g.highlights.from,
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// One screen colour through the curves, into `out`. The same sums as the shader below, for tests and tuning; keep
// the two in step.
export function gradeColor(n: GradeNumbers, r: number, g: number, b: number, out: [number, number, number]): [number, number, number] {
  const l = luma(r, g, b);
  const mid = 1 - smoothstep(0, n.width, Math.abs(l - n.center));
  const sat = 1 + n.saturation * mid;
  const shadow = 1 - smoothstep(0, n.upTo, l);
  const warm = n.warmAmount * smoothstep(n.from, 1, l);
  const c = [r, g, b];
  for (let i = 0; i < 3; i++) {
    let v = l + (c[i]! - l) * sat;
    v += n.lift[i]! * shadow;
    v *= 1 + (n.warm[i]! - 1) * warm;
    out[i] = Math.min(Math.max(v, 0), 1);
  }
  return out;
}

const VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// The scene arrives in working (linear) colours; the curves work on screen colours, so it is converted first and
// written out as screen colours, which is what the canvas shows.
const FRAGMENT = `
uniform sampler2D sceneColor;
uniform vec3 lift, warm;
uniform float saturation, center, width, upTo, warmAmount, from;
varying vec2 vUv;
void main() {
  vec3 c = sRGBTransferOETF(vec4(texture2D(sceneColor, vUv).rgb, 1.0)).rgb;
  float l = dot(c, vec3(${LUMA.join(", ")}));
  float mid = 1.0 - smoothstep(0.0, width, abs(l - center));
  c = l + (c - l) * (1.0 + saturation * mid);
  c += lift * (1.0 - smoothstep(0.0, upTo, l));
  c *= mix(vec3(1.0), warm, warmAmount * smoothstep(from, 1.0, l));
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class GradePass {
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();
  enabled = true; // F1 > Performance > Look features can switch it off, to measure what it costs

  constructor(private config: GradeConfig, private color: (name: string) => string) {
    // Eight bits a channel, which halves the memory of half floats; the toon bands are flat, so the small shadow lift
    // has little to band. Four samples, as the canvas's own antialiasing would give.
    // Stored as sRGB (decoded back to linear when sampled), so 8 bits keep the darks smooth.
    this.target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        sceneColor: { value: this.target.texture },
        lift: { value: new THREE.Vector3() }, warm: { value: new THREE.Vector3(1, 1, 1) },
        saturation: { value: 0 }, center: { value: 0.5 }, width: { value: 0.5 }, upTo: { value: 0.3 }, warmAmount: { value: 0 }, from: { value: 0.7 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
  }

  // The curves of a light preset, by name. Called when the light changes, never per frame.
  usePreset(name: string): void {
    const curves = this.config.presets[name];
    if (!curves) throw new Error(`grade: no curves for light preset ${name}`);
    const n = gradeNumbers(curves, this.color);
    const u = this.material.uniforms;
    (u.lift!.value as THREE.Vector3).set(...n.lift);
    (u.warm!.value as THREE.Vector3).set(...n.warm);
    u.saturation!.value = n.saturation; u.center!.value = n.center; u.width!.value = n.width;
    u.upTo!.value = n.upTo; u.warmAmount!.value = n.warmAmount; u.from!.value = n.from;
  }

  // Runs `draw` (which renders to whatever target is current) into the grade's target, then grades it onto the
  // screen. Switched off, `draw` goes straight to the screen.
  render(renderer: THREE.WebGLRenderer, draw: () => void): void {
    if (!this.enabled) { draw(); return; }
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    const out = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    draw();
    renderer.setRenderTarget(out);
    renderer.render(this.quad, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
