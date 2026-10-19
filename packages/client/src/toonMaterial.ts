import * as THREE from "three";
import { groundMaterial } from "./groundMaterial";
import { installHaze } from "./haze";
import { parseLight, presetColors, presetForSeed, presetNamed, type LightConfig, type LightPreset } from "./lightPresets";
import { Sky, parseSky, type SkyConfig } from "./sky";

// The look of the game, from data/look.json and data/palette.json: one master toon material for everything (three
// flat bands of light plus a hard rim), a dark outline round every box, and one warm key light with cool fill, a sky
// and warm haze, from one of the light presets.
// Colours are named from the palette in DESIGN.md. Art hook: real models get the same material from `material()`.

export interface Palette {
  colors: Record<string, string>;
  // youAccent marks your own mech; everyone else gets one of pilotAccents by player number, so two of the same
  // mech can be told apart. othersAccent is the fallback.
  mech: { body: string; trim: string; youAccent: string; othersAccent: string; pilotAccents?: string[] };
  world: { ground: string; remap: Record<string, string> };
}

export interface LookConfig {
  bands: number[]; // brightness of each band, darkest first
  bandEdges: number[]; // where one band turns into the next, 0 (facing away from the light) to 1 (facing it)
  rim: { strength: number; width: number; color: string };
  outline: { widthMeters: number; darken: number };
  // Damage eats paint to rust: `cover` share of a part at zero hit points, in patches `scale` per metre, with a dark
  // rim `rim` wide (in noise units) round each patch.
  // `spread` below 1 makes the first hits show: the share of damage is raised to this power before it becomes cover.
  rust: { color: string; dark: string; scale: number; maxCover: number; rim: number; spread: number };
  // The junkyard's weathering on map boxes and dressing: moss patches on upward faces (`minUp` is how upward), rust
  // streaks running down walls, and grime along the foot of walls up to `height` metres.
  world: {
    moss: { color: string; dark: string; scale: number; cover: number; rim: number; minUp: number };
    streaks: { color: string; scale: number; cover: number; strength: number };
    grime: { color: string; height: number; strength: number };
  };
  light: LightConfig;
  // How fast the haze thins with height, per metre (see haze.ts). The haze colour and distances are per preset.
  haze: { heightFalloff: number };
  sky: SkyConfig;
}

export function parsePalette(raw: unknown): Palette {
  const p = raw as Palette;
  if (!p?.colors || !p.mech || !p.world?.remap) throw new Error("palette.json: needs colors, mech and world");
  for (const [name, hex] of Object.entries(p.colors)) if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`palette.json: ${name} is not a colour`);
  return p;
}

export function parseLook(raw: unknown): LookConfig {
  const l = raw as LookConfig;
  if (!Array.isArray(l?.bands) || l.bands.length < 2 || l.bandEdges?.length !== l.bands.length - 1) throw new Error("look.json: needs bands and one fewer bandEdges");
  if (typeof l.outline?.widthMeters !== "number" || typeof l.rim?.strength !== "number") throw new Error("look.json: needs outline and rim");
  if (typeof l.haze?.heightFalloff !== "number" || l.haze.heightFalloff < 0) throw new Error("look.json: needs haze.heightFalloff");
  parseLight(l.light);
  parseSky(l.sky);
  return l;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const RAMP_SIZE = 64;

// Smooth 3D value noise in [0, 1], shared by the rust and weathering patterns.
const NOISE_GLSL = `
  float rustHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float rustNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(rustHash(i), rustHash(i + vec3(1, 0, 0)), f.x), mix(rustHash(i + vec3(0, 1, 0)), rustHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(rustHash(i + vec3(0, 0, 1)), rustHash(i + vec3(1, 0, 1)), f.x), mix(rustHash(i + vec3(0, 1, 1)), rustHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

export class Toon {
  private ramp: THREE.DataTexture;
  private materials = new Map<string, THREE.MeshToonMaterial>();
  private groundMaterials = new Map<string, THREE.MeshToonMaterial>();
  private worldMaterials = new Map<string, THREE.MeshToonMaterial>();
  private outlines = new Map<string, THREE.MeshBasicMaterial>();
  private shellOutlines = new Map<string, THREE.MeshBasicMaterial>();
  private rimColor: THREE.Color;
  // Made by `light`, changed in place by `useLight`, so a new match only changes numbers and compiles nothing.
  private fill = new THREE.HemisphereLight();
  private key = new THREE.DirectionalLight();
  private haze = new THREE.Fog(0xffffff);
  private sky: Sky;

  constructor(private look: LookConfig, private palette: Palette) {
    // The bands as a tiny texture read with no blending, so light falls in flat steps.
    const data = new Uint8Array(RAMP_SIZE * 4);
    for (let i = 0; i < RAMP_SIZE; i++) {
      const t = i / (RAMP_SIZE - 1);
      let band = 0;
      while (band < look.bandEdges.length && t >= look.bandEdges[band]!) band++;
      const v = Math.round(look.bands[band]! * 255);
      data.set([v, v, v, 255], i * 4);
    }
    this.ramp = new THREE.DataTexture(data, RAMP_SIZE, 1, THREE.RGBAFormat);
    this.ramp.minFilter = THREE.NearestFilter;
    this.ramp.magFilter = THREE.NearestFilter;
    this.ramp.needsUpdate = true;
    this.rimColor = new THREE.Color(this.color(look.rim.color));
    for (const preset of look.light.presets) {
      for (const c of presetColors(preset)) if (!/^#[0-9a-fA-F]{6}$/.test(this.color(c))) throw new Error(`look.json: light preset ${preset.name} names ${c}, which is not in palette.json`);
    }
    this.sky = new Sky(look.sky, (c) => this.color(c));
  }

  // A palette name, an old map colour remapped onto the palette, or a plain hex colour.
  color(name: string): string {
    const { colors, world } = this.palette;
    const mapped = world.remap[name.toLowerCase()];
    return colors[mapped ?? name] ?? colors[name] ?? name;
  }

  // The master material in one colour. Shared between everything that colour, so it costs one material, not one each.
  material(name: string): THREE.MeshToonMaterial {
    const hex = this.color(name);
    let m = this.materials.get(hex);
    if (!m) {
      m = this.make(hex);
      this.materials.set(hex, m);
    }
    return m;
  }

  // The same bands with no rim, for the ground: a rim on a big flat floor draws a hard line where it turns away.
  ground(name: string): THREE.MeshToonMaterial {
    const hex = this.color(name);
    let m = this.groundMaterials.get(hex);
    if (!m) {
      m = groundMaterial(hex, this.ramp, (c) => this.color(c));
      this.groundMaterials.set(hex, m);
    }
    return m;
  }

  // A material of its own, for something whose colour changes on its own (a mech zone darkening with damage).
  // With `rusts`, `setRust` eats its paint away to rust (see DESIGN.md, "Rust").
  ownMaterial(name: string, rusts = false): THREE.MeshToonMaterial {
    return this.make(this.color(name), rusts);
  }

  // How much of a rusting material's paint is gone: 0 for clean paint, 1 for a part at zero hit points.
  setRust(material: THREE.Material, damage: number): void {
    const uniform = material.userData.rustCover as { value: number } | undefined;
    if (uniform) uniform.value = Math.max(0, Math.min(1, damage)) ** this.look.rust.spread * this.look.rust.maxCover;
  }

  // The map's version of the master material: moss on what faces up, rust streaks down walls, grime at the foot
  // (see DESIGN.md, World kit). Shared per colour, like `material`.
  world(name: string): THREE.MeshToonMaterial {
    const hex = this.color(name);
    let m = this.worldMaterials.get(hex);
    if (!m) {
      m = this.make(hex, false, true);
      this.worldMaterials.set(hex, m);
    }
    return m;
  }

  private make(hex: string, rusts = false, weathered = false): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: this.ramp });
    const { strength, width } = this.look.rim;
    const rim = this.rimColor;
    const rust = this.look.rust;
    const rustCover = { value: 0 };
    if (rusts) m.userData.rustCover = rustCover;
    // A hard rim of warm light where a surface turns away from the camera, so shapes separate from what is behind.
    // Rust: a value-noise pattern fixed to the part (in its own frame, scaled to metres, so it moves with the mech)
    // decides which bits of paint go first; everything under `rustCover` is rust, with a dark band at the edge.
    // Weathering: the same noise in world space, so it lines up across neighbouring boxes and never moves.
    m.onBeforeCompile = (shader) => {
      shader.uniforms.rimColor = { value: rim };
      let fragment = shader.fragmentShader
        .replace("void main() {", `uniform vec3 rimColor;\n${NOISE_GLSL}\nvoid main() {`)
        .replace("#include <opaque_fragment>", `
          float facing = max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
          outgoingLight += rimColor * ${strength.toFixed(3)} * step(1.0 - ${width.toFixed(3)}, 1.0 - facing) * diffuseColor.rgb;
          #include <opaque_fragment>`);
      if (rusts) {
        shader.uniforms.rustCover = rustCover;
        shader.uniforms.rustColor = { value: new THREE.Color(this.color(rust.color)) };
        shader.uniforms.rustDark = { value: new THREE.Color(this.color(rust.dark)) };
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "varying vec3 vRustPos;\nvoid main() {")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            vRustPos = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));`);
        fragment = fragment
          .replace("void main() {", "varying vec3 vRustPos;\nuniform float rustCover;\nuniform vec3 rustColor;\nuniform vec3 rustDark;\nvoid main() {")
          .replace("#include <color_fragment>", `#include <color_fragment>
            if (rustCover > 0.0) {
              vec3 rp = vRustPos * ${rust.scale.toFixed(3)};
              float n = rustNoise(rp) * 0.65 + rustNoise(rp * 2.7 + 17.0) * 0.35;
              if (n < rustCover) diffuseColor.rgb = n > rustCover - ${rust.rim.toFixed(3)} ? rustDark : rustColor;
            }`);
      }
      if (weathered) {
        const { moss, streaks, grime } = this.look.world;
        shader.uniforms.mossColor = { value: new THREE.Color(this.color(moss.color)) };
        shader.uniforms.mossDark = { value: new THREE.Color(this.color(moss.dark)) };
        shader.uniforms.streakColor = { value: new THREE.Color(this.color(streaks.color)) };
        shader.uniforms.grimeColor = { value: new THREE.Color(this.color(grime.color)) };
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "varying vec3 vWorldPos;\nvarying vec3 vWorldN;\nvoid main() {")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            vec4 wPos = vec4(transformed, 1.0);
            vec3 wN = objectNormal;
            #ifdef USE_INSTANCING
              wPos = instanceMatrix * wPos;
              wN = mat3(instanceMatrix) * wN;
            #endif
            vWorldPos = (modelMatrix * wPos).xyz;
            vWorldN = normalize(mat3(modelMatrix) * wN);`);
        fragment = fragment
          .replace("void main() {", "varying vec3 vWorldPos;\nvarying vec3 vWorldN;\nuniform vec3 mossColor;\nuniform vec3 mossDark;\nuniform vec3 streakColor;\nuniform vec3 grimeColor;\nvoid main() {")
          .replace("#include <color_fragment>", `#include <color_fragment>
            if (vWorldN.y > ${moss.minUp.toFixed(3)}) {
              float n = rustNoise(vec3(vWorldPos.xz * ${moss.scale.toFixed(3)}, 3.0)) * 0.7 + rustNoise(vec3(vWorldPos.xz * ${(moss.scale * 3).toFixed(3)}, 9.0)) * 0.3;
              if (n < ${moss.cover.toFixed(3)}) diffuseColor.rgb = n > ${(moss.cover - moss.rim).toFixed(3)} ? mossDark : mossColor;
            } else if (abs(vWorldN.y) < 0.4) {
              float along = vWorldPos.x + vWorldPos.z;
              float n = rustNoise(vec3(along * ${streaks.scale.toFixed(3)}, vWorldPos.y * ${(streaks.scale * 0.12).toFixed(3)}, 5.0));
              if (n < ${streaks.cover.toFixed(3)}) diffuseColor.rgb = mix(diffuseColor.rgb, streakColor, ${streaks.strength.toFixed(3)});
              if (vWorldPos.y < ${grime.height.toFixed(3)}) diffuseColor.rgb = mix(diffuseColor.rgb, grimeColor, ${grime.strength.toFixed(3)});
            }`);
      }
      shader.fragmentShader = fragment;
    };
    m.customProgramCacheKey = () => `toon-rim-${strength}-${width}${rusts ? "-rust" : ""}${weathered ? "-world" : ""}`;
    return m;
  }

  // The outline colour: the base colour darkened, never black, so it reads as part of the thing it surrounds.
  outlineMaterial(name: string): THREE.MeshBasicMaterial {
    const hex = this.color(name);
    let m = this.outlines.get(hex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(this.look.outline.darken), side: THREE.BackSide });
      this.outlines.set(hex, m);
    }
    return m;
  }

  // The outline for a real model: the same mesh drawn from the inside with every vertex pushed out along its normal.
  // Works for any shape; on hard-edged boxes the faces part slightly at the corners, which smooth-shaded art does not.
  shellOutline(name: string): THREE.MeshBasicMaterial {
    const hex = this.color(name);
    let m = this.shellOutlines.get(hex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(this.look.outline.darken), side: THREE.BackSide });
      const width = this.look.outline.widthMeters;
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n  transformed += normalize(normal) * ${width.toFixed(4)};`);
      };
      m.customProgramCacheKey = () => `shell-${width}`;
      this.shellOutlines.set(hex, m);
    }
    return m;
  }

  // A box with its outline: a slightly bigger copy drawn from the inside, so only its rim shows round the edges.
  // The outline is a fixed width in metres, so it thins on screen with distance, as far LODs should.
  box(parent: THREE.Object3D, center: readonly number[], size: readonly number[], name: string, material?: THREE.Material): ToonBox {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(unitBox, material ?? this.material(name));
    const hull = new THREE.Mesh(unitBox, this.outlineMaterial(name));
    group.add(mesh, hull);
    group.position.set(center[0]!, center[1]!, center[2]!);
    parent.add(group);
    const box = { group, mesh, hull };
    this.resize(box, size);
    return box;
  }

  resize(box: ToonBox, size: readonly number[]): void {
    const w = this.look.outline.widthMeters * 2;
    box.mesh.scale.set(size[0]!, size[1]!, size[2]!);
    box.hull.scale.set(size[0]! + w, size[1]! + w, size[2]! + w);
  }

  // An outline for a box mesh that is already scaled: a hull child, sized so the edge is the same width in metres
  // whatever the box's size. Call `refit` again after changing the box's scale.
  outlineChild(mesh: THREE.Mesh, name: string, outlineColor?: string): void {
    const hull = new THREE.Mesh(unitBox, this.outlineMaterial(outlineColor ?? name));
    mesh.add(hull);
    mesh.userData.hull = hull;
    this.refit(mesh);
  }

  refit(mesh: THREE.Mesh): void {
    const hull = mesh.userData.hull as THREE.Mesh | undefined;
    if (!hull) return;
    const w = this.look.outline.widthMeters * 2;
    hull.scale.set(1 + w / mesh.scale.x, 1 + w / mesh.scale.y, 1 + w / mesh.scale.z);
  }

  instances(name: string, count: number, ground = false): ToonInstances {
    return new ToonInstances(this, name, count, this.look.outline.widthMeters, ground);
  }

  // The light preset for a map seed, or the one named by `forced` (?look=<name>) when there is one by that name.
  presetFor(seed: number, forced: string | null = null): LightPreset {
    return (forced !== null ? presetNamed(this.look.light, forced) : null) ?? presetForSeed(this.look.light, seed);
  }

  get presets(): readonly LightPreset[] {
    return this.look.light.presets;
  }

  // Lights, sky and haze for a scene, in one preset's colours. Call before anything renders: the haze replaces
  // Three's fog shader code, which every material compiles in.
  light(scene: THREE.Scene, preset: LightPreset): void {
    installHaze(this.look.haze.heightFalloff);
    scene.fog = this.haze;
    // The haze colour is the sky's horizon too; as the background it only shows if the sky is ever taken out.
    scene.background = this.haze.color;
    scene.add(this.fill, this.key, this.sky.mesh);
    this.useLight(preset);
  }

  useLight(preset: LightPreset): void {
    this.fill.color.set(this.color(preset.fillSky));
    this.fill.groundColor.set(this.color(preset.fillGround));
    this.fill.intensity = preset.fillIntensity;
    this.key.color.set(this.color(preset.key.color));
    this.key.intensity = preset.key.intensity;
    this.key.position.set(...preset.key.direction).multiplyScalar(100);
    this.haze.color.set(this.color(preset.haze.color));
    this.haze.near = preset.haze.near;
    this.haze.far = preset.haze.far;
    this.sky.use(preset);
  }
}

export interface ToonBox {
  group: THREE.Group;
  mesh: THREE.Mesh;
  hull: THREE.Mesh;
}

const placed = new THREE.Matrix4();
const at = new THREE.Vector3();
const sized = new THREE.Vector3();
const noTurn = new THREE.Quaternion();
const gone = new THREE.Matrix4().makeScale(0, 0, 0);

// Many boxes of one colour in two draw calls: the boxes, and their outlines. For the map and the props.
export class ToonInstances {
  readonly mesh: THREE.InstancedMesh;
  readonly hull: THREE.InstancedMesh | null;

  // `ground` draws the bands with no rim and no outline, for the floor.
  constructor(toon: Toon, name: string, count: number, private outlineWidth: number, ground = false) {
    this.mesh = new THREE.InstancedMesh(unitBox, ground ? toon.ground(name) : toon.world(name), count);
    this.hull = ground ? null : new THREE.InstancedMesh(unitBox, toon.outlineMaterial(name), count);
  }

  set(i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    this.mesh.setMatrixAt(i, placed.compose(at.set(x, y, z), noTurn, sized.set(sx, sy, sz)));
    const w = this.outlineWidth * 2;
    this.hull?.setMatrixAt(i, placed.compose(at, noTurn, sized.set(sx + w, sy + w, sz + w)));
  }

  hide(i: number): void {
    this.hideOnly(i);
    this.commit();
  }

  // Hides one without sending the change yet, for hiding many at once followed by one `commit`.
  hideOnly(i: number): void {
    this.mesh.setMatrixAt(i, gone);
    this.hull?.setMatrixAt(i, gone);
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.hull) this.hull.instanceMatrix.needsUpdate = true;
  }

  addTo(parent: THREE.Object3D): void {
    parent.add(this.mesh);
    if (this.hull) parent.add(this.hull);
  }

  dispose(): void {
    this.mesh.dispose();
    this.hull?.dispose();
  }
}
