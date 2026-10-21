import * as THREE from "three";

// Crease lines (gate V9, on at the "high" effects quality since V14): thin lines where a surface folds (panel edges,
// chamfers, the corners of boxes) with no geometry for them, found from the depth buffer after the scene is drawn.
// The scene goes into a target of its own instead of the screen, then one full-screen pass copies it out and darkens
// pixels at a crease. Depth as stored is flat across any plane on screen, so its second difference across a pixel is
// zero on a plane and large where the surface bends or steps; shell outlines already draw silhouettes, this adds the
// folds inside them. A line is the surface's own colour at `darken` of its on-screen brightness, as outlines are
// inked, so it is never black. Fades out with distance, where depth precision runs out and lines would only crawl.
// Switchable from F1 > Performance > Look features, so its cost can be measured with the GPU timer.

export interface CreaseLook {
  onAtQuality: string[]; // the effects quality levels (data/vfx.json) that draw it
  darken: number; // 0 to 1: a line's share of the on-screen brightness of the surface under it
  threshold: number; // 0 to 1: how sharp a fold must be, as its bend over its slope
  stepShare: number; // 0 to 1: a jump in depth bigger than this share of the distance is not a fold
  fade: { startMeters: number; endMeters: number };
}

export function parseCrease(raw: unknown, qualityLevels: readonly string[]): CreaseLook {
  const c = raw as CreaseLook;
  const share = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;
  const levels = Array.isArray(c?.onAtQuality) && c.onAtQuality.every((q) => qualityLevels.includes(q));
  if (!(levels && c.darken > 0 && share(c.darken) && share(c.threshold) && share(c.stepShare) && c.fade?.startMeters >= 0 && c.fade.endMeters > c.fade.startMeters)) {
    throw new Error(`look.json: crease needs onAtQuality from ${qualityLevels.join(", ")}, darken above 0 to 1 (a line is never black), threshold and stepShare 0 to 1, and a fade that ends after it starts`);
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
uniform float near, far, darken, threshold, stepShare;
uniform vec2 fade;
varying vec2 vUv;
float metres(float d) { return near * far / (far - d * (far - near)); }
// The bend of the depth along one axis, over how steep it is there: 0 on a plane, near 1 at a fold or a step.
float bend(float a, float c, float b) { return abs(a + b - 2.0 * c) / (abs(a - c) + abs(b - c) + 1e-7); }
// A fold, not a step: a jump of more than stepShare of the distance to a neighbour is a silhouette (which the outline
// already draws) or one thing in front of another, such as grass blades over the ground, which would fill with lines.
float fold(float a, float c, float b) {
  float mc = metres(c);
  float joined = step(max(abs(metres(a) - mc), abs(metres(b) - mc)), stepShare * mc);
  return step(threshold, bend(a, c, b)) * joined;
}
void main() {
  vec4 color = texture2D(sceneColor, vUv);
  float c = texture2D(sceneDepth, vUv).r;
  float l = texture2D(sceneDepth, vUv - vec2(texel.x, 0.0)).r, r = texture2D(sceneDepth, vUv + vec2(texel.x, 0.0)).r;
  float d = texture2D(sceneDepth, vUv - vec2(0.0, texel.y)).r, u = texture2D(sceneDepth, vUv + vec2(0.0, texel.y)).r;
  // Alpha is the mask: withoutCreases materials write 0 (smoke drawn over them keeps its own share).
  float line = max(fold(l, c, r), fold(d, c, u)) * step(c, 0.99999) * clamp(color.a, 0.0, 1.0);
  line *= 1.0 - smoothstep(fade.x, fade.y, metres(c));
  // Darkened as the screen shows it, then back to linear for the output conversion below.
  vec3 inked = sRGBTransferEOTF(vec4(sRGBTransferOETF(vec4(color.rgb, 1.0)).rgb * darken, 1.0)).rgb;
  gl_FragColor = vec4(mix(color.rgb, inked, line), 1.0);
  #include <colorspace_fragment>
}`;

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
        darken: { value: look.darken }, threshold: { value: look.threshold }, stepShare: { value: look.stepShare },
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

  // Draws the scene with crease lines, or straight to the screen when off.
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.enabled) { renderer.render(scene, camera); return; }
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    const u = this.material.uniforms;
    (u.texel!.value as THREE.Vector2).set(1 / this.size.x, 1 / this.size.y);
    u.near!.value = camera.near;
    u.far!.value = camera.far;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quad, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
