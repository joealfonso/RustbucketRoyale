import * as THREE from "three";

// Crease lines (gate V9, on at the "high" effects quality since V14): thin lines where a surface folds (panel edges,
// chamfers, the corners of boxes) with no geometry for them, found from the depth buffer after the scene is drawn.
// The scene goes into a target of its own instead of the screen, then one full-screen pass copies it out and darkens
// pixels at a crease. Depth as stored is flat across any plane on screen, so its second difference across a pixel is
// zero on a plane and large where the surface bends or steps; shell outlines already draw silhouettes, this adds the
// folds inside them. A line is the surface's own colour at `darken` of its on-screen brightness, as outlines are
// inked, so it is never black. Fades out with distance, where depth precision runs out and lines would only crawl.
// Width (V16b): a fold shows on the two pixels either side of it, which drew creases as heavy as the silhouettes. Now
// the pixel where the fold bends most along each axis is the line's core, and its partner beside it is drawn at a
// share that makes the line `pixels` wide on a 1080 tall screen (1 to 2 pixels of the real screen), so interior lines
// stay thinner than the outline shells round them. A line tapers where its fold softens out instead of stopping
// hard: its strength rises from `threshold` over `taper` more bend. At the fade it loses its partner pixel first.
// Switchable from F1 > Performance > Look features, so its cost can be measured with the GPU timer.

export interface CreaseLook {
  onAtQuality: string[]; // the effects quality levels (data/vfx.json) that draw it
  darken: number; // 0 to 1: a line's share of the on-screen brightness of the surface under it
  pixels: number; // a line's width on a 1080 tall screen, kept between 1 and 2 real pixels
  threshold: number; // 0 to 1: how sharp a fold must be, as its bend over its slope
  taper: number; // bend past the threshold over which a line comes in, so it tapers out where its fold softens
  stepShare: number; // 0 to 1: a jump in depth bigger than this share of the distance is not a fold
  fade: { startMeters: number; endMeters: number };
}

export function parseCrease(raw: unknown, qualityLevels: readonly string[]): CreaseLook {
  const c = raw as CreaseLook;
  const share = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;
  const levels = Array.isArray(c?.onAtQuality) && c.onAtQuality.every((q) => qualityLevels.includes(q));
  const shape = typeof c?.pixels === "number" && c.pixels > 0 && c.pixels <= 4 && typeof c.taper === "number" && c.taper > 0 && c.threshold + c.taper <= 1;
  if (!(levels && shape && c.darken > 0 && share(c.darken) && share(c.threshold) && share(c.stepShare) && c.fade?.startMeters >= 0 && c.fade.endMeters > c.fade.startMeters)) {
    throw new Error(`look.json: crease needs onAtQuality from ${qualityLevels.join(", ")}, darken above 0 to 1 (a line is never black), pixels above 0 to 4, threshold and stepShare 0 to 1, taper above 0 with threshold + taper at most 1, and a fade that ends after it starts`);
  }
  return c;
}

const VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAGMENT = `
uniform sampler2D sceneColor;
uniform sampler2D sceneDepth;
uniform vec2 texel;
uniform float near, far, darken, threshold, taper, stepShare, partner;
uniform vec2 fade;
varying vec2 vUv;
float metres(float d) { return near * far / (far - d * (far - near)); }
// The bend of the depth along one axis, over how steep it is there: 0 on a plane, near 1 at a fold or a step.
float bend(float a, float c, float b) { return abs(a + b - 2.0 * c) / (abs(a - c) + abs(b - c) + 1e-7); }
// A fold, not a step: a jump of more than stepShare of the distance to a neighbour is a silhouette (which the outline
// already draws) or one thing in front of another, such as grass blades over the ground, which would fill with lines.
float joined(float a, float c, float b) {
  float mc = metres(c);
  return step(max(abs(metres(a) - mc), abs(metres(b) - mc)), stepShare * mc);
}
// The line along one axis through five depths, the middle one this pixel's: full where this pixel bends most of the
// three (ties go to the right-hand one, so a fold between two pixels is drawn once), the partner share beside it.
float fold(float aa, float a, float c, float b, float bb, float side) {
  float here = bend(a, c, b);
  float core = step(bend(aa, a, c), here) * (1.0 - step(here, bend(c, b, bb)));
  return smoothstep(threshold, threshold + taper, here) * joined(a, c, b) * mix(side, 1.0, core);
}
float depthAt(vec2 offset) { return texture2D(sceneDepth, vUv + offset * texel).r; }
void main() {
  vec4 color = texture2D(sceneColor, vUv);
  float c = depthAt(vec2(0.0));
  float keep = 1.0 - smoothstep(fade.x, fade.y, metres(c));
  float side = partner * keep; // the partner pixel fades twice as fast, so a line thins before it goes
  float across = fold(depthAt(vec2(-2.0, 0.0)), depthAt(vec2(-1.0, 0.0)), c, depthAt(vec2(1.0, 0.0)), depthAt(vec2(2.0, 0.0)), side);
  float up = fold(depthAt(vec2(0.0, -2.0)), depthAt(vec2(0.0, -1.0)), c, depthAt(vec2(0.0, 1.0)), depthAt(vec2(0.0, 2.0)), side);
  // Alpha is the mask: withoutCreases materials write 0 (smoke drawn over them keeps its own share).
  float line = max(across, up) * step(c, 0.99999) * clamp(color.a, 0.0, 1.0) * keep;
  // Darkened as the screen shows it, then back to linear for the output conversion below.
  vec3 inked = sRGBTransferEOTF(vec4(sRGBTransferOETF(vec4(color.rgb, 1.0)).rgb * darken, 1.0)).rgb;
  gl_FragColor = vec4(mix(color.rgb, inked, line), 1.0);
  #include <colorspace_fragment>
}`;

// How strongly the pixel beside a line's core is drawn, so the line is `pixels` wide on a 1080 tall screen when the
// real screen is `height` tall: 0 for a one-pixel line, 1 for two, never wider.
export function creasePartner(pixels: number, height: number): number {
  return Math.min(Math.max((pixels * height) / 1080 - 1, 0), 1);
}

// Keeps crease lines off a material: it writes 0 to alpha, which the pass reads as a mask. For dense small things,
// such as grass cards, whose every blade and overlap would turn into a line. The canvas has no alpha channel, so
// nothing else sees it.
export function withoutCreases<M extends THREE.Material>(material: M): M {
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    const end = shader.fragmentShader.lastIndexOf("}");
    shader.fragmentShader = `${shader.fragmentShader.slice(0, end)}  gl_FragColor.a = 0.0;\n}`;
  };
  material.customProgramCacheKey = () => `${key()}-no-crease`;
  return material;
}

export class CreasePass {
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();
  enabled = false;

  constructor(private look: CreaseLook, quality: string) {
    this.setQuality(quality);
    // Half floats keep the dark bands smooth: the scene is linear until this pass turns it to screen colours.
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        sceneColor: { value: this.target.texture },
        sceneDepth: { value: this.target.depthTexture },
        texel: { value: new THREE.Vector2() },
        near: { value: 0.1 }, far: { value: 1000 },
        darken: { value: look.darken }, threshold: { value: look.threshold }, taper: { value: look.taper }, stepShare: { value: look.stepShare },
        partner: { value: 0 },
        fade: { value: new THREE.Vector2(look.fade.startMeters, look.fade.endMeters) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
  }

  // On at the levels that draw it, off at the rest (the F1 feature switch can still flip it after).
  setQuality(quality: string): void {
    this.enabled = this.look.onAtQuality.includes(quality);
  }

  // Draws the scene with crease lines, or straight to the current target when off.
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.enabled) { renderer.render(scene, camera); return; }
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    const u = this.material.uniforms;
    (u.texel!.value as THREE.Vector2).set(1 / this.size.x, 1 / this.size.y);
    u.partner!.value = creasePartner(this.look.pixels, this.size.y);
    u.near!.value = camera.near;
    u.far!.value = camera.far;
    // Out to whatever was being drawn to: the screen, or the colour grade's target (grade.ts) when that is on.
    const out = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(out);
    renderer.render(this.quad, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
