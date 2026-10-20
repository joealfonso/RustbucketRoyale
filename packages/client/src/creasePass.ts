import * as THREE from "three";

// Crease lines (gate V9, a costed proposal, off by default): thin dark lines where a surface folds (panel edges,
// chamfers, the corners of boxes) with no geometry for them, found from the depth buffer after the scene is drawn.
// The scene goes into a target of its own instead of the screen, then one full-screen pass copies it out and darkens
// pixels at a crease. Depth as stored is flat across any plane on screen, so its second difference across a pixel is
// zero on a plane and large where the surface bends or steps; shell outlines already draw silhouettes, this adds the
// folds inside them. Fades out with distance, where depth precision runs out and lines would only crawl.
// Switchable from F1 > Performance > Look features, so its cost can be measured with the GPU timer.

export interface CreaseLook {
  enabled: boolean;
  darken: number; // 0 to 1: how much of the colour a line takes away
  threshold: number; // 0 to 1: how sharp a fold must be, as its bend over its slope
  fade: { startMeters: number; endMeters: number };
}

export function parseCrease(raw: unknown): CreaseLook {
  const c = raw as CreaseLook;
  const share = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;
  if (!(typeof c?.enabled === "boolean" && share(c.darken) && share(c.threshold) && c.fade?.startMeters >= 0 && c.fade.endMeters > c.fade.startMeters)) {
    throw new Error("look.json: crease needs enabled, darken and threshold 0 to 1, and a fade that ends after it starts");
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
uniform float near, far, darken, threshold;
uniform vec2 fade;
varying vec2 vUv;
float metres(float d) { return near * far / (far - d * (far - near)); }
// The bend of the depth along one axis, over how steep it is there: 0 on a plane, near 1 at a fold or a step.
float bend(float a, float c, float b) { return abs(a + b - 2.0 * c) / (abs(a - c) + abs(b - c) + 1e-7); }
void main() {
  vec4 color = texture2D(sceneColor, vUv);
  float c = texture2D(sceneDepth, vUv).r;
  float l = texture2D(sceneDepth, vUv - vec2(texel.x, 0.0)).r, r = texture2D(sceneDepth, vUv + vec2(texel.x, 0.0)).r;
  float d = texture2D(sceneDepth, vUv - vec2(0.0, texel.y)).r, u = texture2D(sceneDepth, vUv + vec2(0.0, texel.y)).r;
  float line = step(threshold, max(bend(l, c, r), bend(d, c, u))) * step(c, 0.99999);
  line *= 1.0 - smoothstep(fade.x, fade.y, metres(c));
  gl_FragColor = vec4(color.rgb * (1.0 - darken * line), 1.0);
  #include <colorspace_fragment>
}`;

export class CreasePass {
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();
  enabled: boolean;

  constructor(look: CreaseLook) {
    this.enabled = look.enabled;
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
        darken: { value: look.darken }, threshold: { value: look.threshold },
        fade: { value: new THREE.Vector2(look.fade.startMeters, look.fade.endMeters) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
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
