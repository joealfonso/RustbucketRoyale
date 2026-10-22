import * as THREE from "three";
import { addPaint, paintCacheKey, type PaintSurface } from "./paint/paintChunk";
import { PaintKit } from "./paint/paintKit";
import type { SurfaceKind } from "./paint/paintLook";
import type { Terrain } from "@rustbucket/shared";
import { vfxConfig } from "./fx/quality";
import { groundMaterial } from "./groundMaterial";
import { installHaze, useHaze } from "./haze";
import { parseBackdropLook, type BackdropLook } from "./backdrop/backdropLook";
import { parseLight, presetColors, presetForSeed, presetNamed, type LightConfig, type LightPreset } from "./lightPresets";
import { Sky, parseSky, type SkyConfig } from "./sky";
import { parseSunShadowLook, type SunShadowLook } from "./sunShadows";
import { installToonLight, setToonShade } from "./toonLight";
import { parseCrease, type CreaseLook } from "./creasePass";
import { mossGlsl, parseMoss, type MossLook } from "./mossEdge";
import { OUTLINE_UNIT_GLSL, outlineWidthGlsl, parseOutlineWidth, pushOutGlsl, type OutlineWidth } from "./outlineWidth";

// The look of the game, from data/look.json and data/palette.json: one master toon material for everything (three
// flat bands of light plus a hard rim), a dark outline round every box, and one warm key light (the sun, casting
// toon shadows: toonLight.ts, sunShadows.ts) with a cool sky fill and warm ground bounce, a sky and warm haze, from
// one of the light presets.
// Colours are named from the palette in DESIGN.md. Art hook: real models get the same material from `material()`.

export interface Palette {
  colors: Record<string, string>;
  // youAccent marks your own mech; everyone else gets one of pilotAccents by player number, so two of the same
  // mech can be told apart. othersAccent is the fallback.
  mech: { body: string; trim: string; youAccent: string; othersAccent: string; pilotAccents?: string[] };
  world: { ground: string; remap: Record<string, string> };
}

export interface LookConfig {
  bands: number[]; // brightness of the three bands, darkest first
  bandEdges: number[]; // where one band turns into the next, 0 (facing away from the light) to 1 (facing it)
  bandEdgePixels: number; // how many pixels a band edge takes to turn on screen (toonLight.ts)
  // A hard rim of `color` where a surface turns from the camera (`width`, 1 minus the cosine), turned `skyTint` of the
  // way toward the sky's hue. Full on the sun's side, `shadeSide` of it on the shadow side, gone between the fade
  // distances so far mechs do not glow.
  rim: { strength: number; width: number; color: string; skyTint: number; shadeSide: number; fade: { startMeters: number; endMeters: number } };
  // Both darkens are a share of the brightness you see, so outlines read as ink, not a pale halo (scaling in linear
  // light made 0.35 show as about 62%). Mechs are inked a little darker than the world so they stand out from it.
  // Widths are about even on screen (outlineWidth.ts), the world's and the mechs' each their own.
  outline: { darken: number; mechDarken: number; world: OutlineWidth; mech: OutlineWidth };
  // Damage eats paint to rust: `cover` share of a part at zero hit points, in patches `scale` per metre, with a dark
  // rim `rim` wide (in noise units) round each patch.
  // `spread` below 1 makes the first hits show: the share of damage is raised to this power before it becomes cover.
  rust: { color: string; dark: string; scale: number; maxCover: number; rim: number; spread: number };
  // The junkyard's weathering on map boxes and dressing: moss patches on upward faces (`minUp` is how upward), rust
  // streaks running down walls, and grime along the foot of walls up to `height` metres.
  world: {
    moss: MossLook; // mossEdge.ts
    streaks: { color: string; scale: number; cover: number; strength: number };
    grime: { color: string; height: number; strength: number };
  };
  light: LightConfig;
  // The sun's shadow map near the camera and how its shadows are drawn (sunShadows.ts, toonLight.ts).
  shadows: SunShadowLook;
  // Contact darkening: surfaces within `heightMeters` of the ground under them lose up to `strength` of their light,
  // in `steps` flat steps (a toon band, not a gradient), the edge broken up by `ragged` of the height with noise.
  // Ambient (sky and bounce) light loses all of it, the sun's `directShare`. Faces turned up are left alone.
  ao: { heightMeters: number; strength: number; steps: number; ragged: number; directShare: number };
  // How fast the haze thins with height, per metre, and how soft the edges of its steps are, as a share of the haze
  // amount (see haze.ts). The haze colours, steps and distances are per preset.
  haze: { heightFalloff: number; stepSoftness: number };
  sky: SkyConfig;
  backdrop: BackdropLook; // the world beyond the map: backdrop/backdropLook.ts
  mech: MechSurfaceLook;
  crease: CreaseLook; // the crease line pass, creasePass.ts
}

// How the roster mechs' surfaces take paint and light (gate V9). `normals` is read by the model scripts when they
// write a mech (scripts/assets/hardSurface.ts), so a change there needs the mechs rebuilt; the rest is the master
// toon material's and applies at once.
export interface MechSurfaceLook {
  normals: { smoothAngleDegrees: number; bigShare: number; wearWidthMeters: number };
  // Paint chipped to bare steel along the edges the model marks: `cover` is the share of an edge that chips, in
  // patches `scale` per metre; rust starts on edges, `rustFirst` ahead of the rest. Gone between the fade distances,
  // where a chamfer is a pixel wide and chips would only flicker.
  edgeWear: { color: string; cover: number; scale: number; rustFirst: number; fade: { startMeters: number; endMeters: number } };
  // Bare metal parts: bands of their own, and one hard highlight from the sun, `glint` strong, where the surface is
  // within `size` (1 minus the cosine) of mirroring it toward the eye.
  metal: { glint: number; size: number; color: string } & FinishBands;
  // Rubber parts: no rim, flat bands of their own, the colour times `darken`.
  rubber: { darken: number } & FinishBands;
}

// Three bands and their two edges, as the look's own `bands` and `bandEdges`.
export interface FinishBands {
  bands: number[];
  bandEdges: number[];
}

export function parsePalette(raw: unknown): Palette {
  const p = raw as Palette;
  if (!p?.colors || !p.mech || !p.world?.remap) throw new Error("palette.json: needs colors, mech and world");
  for (const [name, hex] of Object.entries(p.colors)) if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`palette.json: ${name} is not a colour`);
  return p;
}

// A colour darkened to a share of its on-screen brightness, as a working (linear) colour.
const ink = (hex: string, share: number) => new THREE.Color(hex).convertLinearToSRGB().multiplyScalar(share).convertSRGBToLinear();

export function parseLook(raw: unknown): LookConfig {
  const l = raw as LookConfig;
  checkBands(l as FinishBands, "look.json");
  if (!(typeof l.bandEdgePixels === "number" && l.bandEdgePixels > 0 && l.bandEdgePixels <= 4)) throw new Error("look.json: bandEdgePixels must be above 0, at most 4");
  if (typeof l.outline?.darken !== "number") throw new Error("look.json: needs outline");
  const r = l.rim;
  if (!(r && r.strength >= 0 && share(r.width) && typeof r.color === "string" && share(r.skyTint) && share(r.shadeSide) && r.fade?.startMeters >= 0 && r.fade.endMeters > r.fade.startMeters)) {
    throw new Error("look.json: rim needs strength 0 or more, a color, width, skyTint and shadeSide 0 to 1, and a fade that ends after it starts");
  }
  if (typeof l.outline.mechDarken !== "number") throw new Error("look.json: outline needs mechDarken");
  parseOutlineWidth(l.outline.world, "outline.world");
  parseOutlineWidth(l.outline.mech, "outline.mech");
  if (typeof l.haze?.heightFalloff !== "number" || l.haze.heightFalloff < 0) throw new Error("look.json: needs haze.heightFalloff");
  if (!(typeof l.haze.stepSoftness === "number" && l.haze.stepSoftness > 0 && l.haze.stepSoftness <= 0.1)) throw new Error("look.json: haze.stepSoftness must be above 0, at most 0.1");
  parseLight(l.light);
  parseSky(l.sky);
  parseBackdropLook(l.backdrop);
  parseSunShadowLook(l.shadows, Object.keys(vfxConfig.levels));
  const ao = l.ao;
  if (!(ao?.heightMeters > 0 && ao.strength >= 0 && ao.strength <= 1 && Number.isInteger(ao.steps) && ao.steps >= 1 && ao.ragged >= 0 && ao.directShare >= 0 && ao.directShare <= 1)) throw new Error("look.json: ao needs heightMeters above 0, strength and directShare 0 to 1, whole steps of 1 or more, ragged 0 or more");
  parseMoss(l.world?.moss);
  parseMechSurface(l.mech);
  parseCrease(l.crease, Object.keys(vfxConfig.levels));
  return l;
}

const share = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;

// Exactly three bands, each brighter than the last, with two edges in order between 0 and 1.
function checkBands(b: FinishBands, where: string): void {
  const [dark, mid, top] = b?.bands ?? [];
  const [low, high] = b?.bandEdges ?? [];
  const ok = b?.bands?.length === 3 && b.bandEdges?.length === 2 && [dark, mid, top, low, high].every((n) => typeof n === "number")
    && dark! >= 0 && dark! < mid! && mid! < top! && top! <= 2 && low! > 0 && low! < high! && high! < 1;
  if (!ok) throw new Error(`${where}: needs three bands, each brighter than the last (at most 2), and two bandEdges in order between 0 and 1`);
}

function parseMechSurface(m: MechSurfaceLook): void {
  if (!m?.normals || !m.edgeWear || !m.metal || !m.rubber) throw new Error("look.json: mech needs normals, edgeWear, metal and rubber");
  const { smoothAngleDegrees, bigShare, wearWidthMeters } = m.normals;
  if (!(smoothAngleDegrees > 0 && smoothAngleDegrees < 90 && bigShare > 0 && bigShare <= 1 && wearWidthMeters >= 0)) {
    throw new Error("look.json: mech.normals needs smoothAngleDegrees between 0 and 90, bigShare above 0 to 1 and wearWidthMeters 0 or more");
  }
  const w = m.edgeWear;
  if (!(typeof w.color === "string" && share(w.cover) && w.scale > 0 && share(w.rustFirst) && w.fade?.startMeters >= 0 && w.fade.endMeters > w.fade.startMeters)) {
    throw new Error("look.json: mech.edgeWear needs a color, cover and rustFirst 0 to 1, scale above 0, and a fade that ends after it starts");
  }
  if (!(share(m.metal.glint) && m.metal.size > 0 && m.metal.size < 1 && typeof m.metal.color === "string")) throw new Error("look.json: mech.metal needs glint 0 to 1, size between 0 and 1 and a color");
  checkBands(m.metal, "look.json mech.metal");
  if (!share(m.rubber.darken)) throw new Error("look.json: mech.rubber needs darken 0 to 1");
  checkBands(m.rubber, "look.json mech.rubber");
}

// A GLSL vector of two or three numbers.
const vec = (n: number[]) => `vec${n.length}(${n.map((v) => v.toFixed(4)).join(", ")})`;

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
  private instancedCopies = new Map<THREE.Material, THREE.Material>();
  private rimColor: THREE.Color;
  // Made by `light`, changed in place by `useLight`, so a new match only changes numbers and compiles nothing.
  private fill = new THREE.HemisphereLight();
  private key = new THREE.DirectionalLight();
  private towardSun = new THREE.Vector3(0, 1, 0);
  // The height of the ground under any point, for the contact darkening and the grime: the map's hills as a small
  // texture (one texel per terrain corner), or flat at 0. Shared by every material, swapped per map by `setGround`.
  private groundHeights: { value: THREE.DataTexture } = { value: flatGround() };
  private groundUv = { value: new THREE.Vector3(0, 0.5, 0.5) }; // uv = xz * x + (y, z)
  private haze = new THREE.Fog(0xffffff);
  private sky: Sky;
  private paintKit: PaintKit | null = null;

  constructor(private look: LookConfig, private palette: Palette) {
    // The bands as a tiny texture read with no blending, for lights other than the sun (toonLight.ts works the
    // sun's bands out in the shader).
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
    installToonLight({ ...look.shadows, bands: look.bands, bandEdges: look.bandEdges, edgePixels: look.bandEdgePixels }, look.light.presets[0]!.shade);
  }

  // The key light, which casts the shadows (sunShadows.ts), and the unit direction toward it for this preset.
  get sun(): THREE.DirectionalLight {
    return this.key;
  }

  get toSun(): THREE.Vector3 {
    return this.towardSun;
  }

  // The map's hills under every material's contact darkening and grime; null for flat ground at 0 (the range).
  setGround(terrain: Terrain | null): void {
    const old = this.groundHeights.value;
    if (!terrain) {
      this.groundHeights.value = flatGround();
      this.groundUv.value.set(0, 0.5, 0.5);
    } else {
      const n = terrain.corners;
      const heights = new Uint16Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = THREE.DataUtils.toHalfFloat(terrain.corner(i, j));
      this.groundHeights.value = heightTexture(heights, n);
      const [scale, offset] = groundMapping(terrain);
      this.groundUv.value.set(scale, offset, offset);
    }
    old.dispose();
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
      m = groundMaterial(hex, this.ramp, (c) => this.color(c), undefined, this.paint.ground());
      this.groundMaterials.set(hex, m);
    }
    return m;
  }

  // The bands texture, for materials of their own that light in the same flat steps (the water, waterMesh.ts).
  get bands(): THREE.Texture {
    return this.ramp;
  }

  // The haze colour, changed in place by `useLight`, for things that haze themselves (the far mountain ranges).
  get hazeColor(): THREE.Color {
    return this.haze.color;
  }

  // A material of its own, for something whose colour changes on its own (a mech zone darkening with damage).
  // With `rusts`, `setRust` eats its paint away to rust (see DESIGN.md, "Rust").
  // With `finishes`, it reads each corner's `finish` attribute (kit mechs only, mechKit.ts): paint chips along the
  // edges the model marks, bare metal glints, rubber takes the light flat (look.json mech). Every geometry drawn with
  // it must have that attribute.
  ownMaterial(name: string, rusts = false, kind: SurfaceKind | null = null, finishes = false): THREE.MeshToonMaterial {
    return this.make(this.color(name), rusts, false, kind ? this.paint.surface(kind) : null, finishes);
  }

  // How much of a rusting material's paint is gone: 0 for clean paint, 1 for a part at zero hit points.
  setRust(material: THREE.Material, damage: number): void {
    const uniform = material.userData.rustCover as { value: number } | undefined;
    if (uniform) uniform.value = Math.max(0, Math.min(1, damage)) ** this.look.rust.spread * this.look.rust.maxCover;
  }

  // The map's version of the master material: moss on what faces up, rust streaks down walls, grime at the foot
  // (see DESIGN.md, World kit). Shared per colour, like `material`.
  // `kind`: which painted marks it carries (metal plates, concrete, wood, or none); `edges` chips paint along the
  // edges of a unit box, for map boxes only.
  world(name: string, kind: SurfaceKind | null = "metal", edges = false): THREE.MeshToonMaterial {
    const hex = this.color(name);
    const key = `${hex}-${kind}-${edges}`;
    let m = this.worldMaterials.get(key);
    if (!m) {
      m = this.make(hex, false, true, kind ? this.paint.surface(kind, edges) : null);
      this.worldMaterials.set(key, m);
    }
    return m;
  }

  // The painted atlas (paint/), built on first use so a Toon that never paints anything (tests, tools) never pays for it.
  get paint(): PaintKit {
    this.paintKit ??= new PaintKit((c) => this.color(c));
    return this.paintKit;
  }

  // `paint`: the painted marks for this kind of surface (paint/paintChunk.ts), laid on after rust and weathering.
  private make(hex: string, rusts = false, weathered = false, paint: PaintSurface | null = null, finishes = false): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: this.ramp });
    const { strength, width, skyTint, shadeSide, fade } = this.look.rim;
    const pixels = (this.look.bandEdgePixels / 2).toFixed(4);
    const rim = this.rimColor;
    const rust = this.look.rust;
    const mech = this.look.mech;
    const rustCover = { value: 0 };
    if (rusts) m.userData.rustCover = rustCover;
    // Everything in the master material casts sun shadows (sunShadows.ts); the ground and outlines do not.
    m.userData.castsShadow = true;
    const ao = this.look.ao;
    // A hard rim of light where a surface turns away from the camera, so shapes separate from what is behind: from
    // the sun's side (toonSunSide, toonLight.ts) more than the shadow side, part sky-coloured, gone far away. Its edge
    // turns over the same pixel or so as the band edges.
    // Rust: a value-noise pattern fixed to the part (in its own frame, scaled to metres, so it moves with the mech)
    // decides which bits of paint go first; everything under `rustCover` is rust, with a dark band at the edge.
    // Weathering: the same noise in world space, so it lines up across neighbouring boxes and never moves.
    // Contact darkening (look.json ao): by height above the ground under each point, in flat steps, so things sit
    // in the ground instead of on it. It darkens the light, not the paint, so rust and moss darken with it.
    m.onBeforeCompile = (shader) => {
      shader.uniforms.rimColor = { value: rim };
      shader.uniforms.toonGround = this.groundHeights;
      shader.uniforms.toonGroundMap = this.groundUv;
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "varying vec3 vWorldPos;\nvoid main() {")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vec4 toonWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            toonWorld = instanceMatrix * toonWorld;
          #endif
          vWorldPos = (modelMatrix * toonWorld).xyz;`);
      let fragment = shader.fragmentShader
        .replace("void main() {", `uniform vec3 rimColor;\nvarying vec3 vWorldPos;\nuniform sampler2D toonGround;\nuniform vec3 toonGroundMap;\n${NOISE_GLSL}\nvoid main() {`)
        .replace("#include <logdepthbuf_fragment>", `#include <logdepthbuf_fragment>
          float toonAbove = vWorldPos.y - texture2D(toonGround, vWorldPos.xz * toonGroundMap.x + toonGroundMap.yz).r;`)
        .replace("#include <aomap_fragment>", `
          {
            float upness = (vec4(normal, 0.0) * viewMatrix).y;
            float t = toonAbove / ${ao.heightMeters.toFixed(3)} + (rustNoise(vWorldPos * 1.7 + 23.0) - 0.5) * ${ao.ragged.toFixed(3)};
            float occluded = ceil(clamp(1.0 - t, 0.0, 1.0) * ${ao.steps.toFixed(1)}) / ${ao.steps.toFixed(1)} * step(upness, 0.5);
            float toonAo = 1.0 - ${ao.strength.toFixed(3)} * occluded;
            reflectedLight.indirectDiffuse *= toonAo;
            reflectedLight.directDiffuse *= mix(1.0, toonAo, ${ao.directShare.toFixed(3)});
          }
          #include <aomap_fragment>`)
        .replace("#include <opaque_fragment>", `
          float rimTurn = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
          float rimAa = max(fwidth(rimTurn), 1e-5) * ${pixels};
          vec3 rimLight = rimColor;
          #if NUM_HEMI_LIGHTS > 0
            vec3 rimSky = hemisphereLights[0].skyColor;
            rimLight = mix(rimColor, rimSky / max(max(rimSky.r, max(rimSky.g, rimSky.b)), 1e-4) * max(rimColor.r, max(rimColor.g, rimColor.b)), ${skyTint.toFixed(3)});
          #endif
          float rimAmount = smoothstep(${(1 - width).toFixed(3)} - rimAa, ${(1 - width).toFixed(3)} + rimAa, rimTurn) * mix(${shadeSide.toFixed(3)}, 1.0, toonSunSide)
            * (1.0 - smoothstep(${fade.startMeters.toFixed(2)}, ${fade.endMeters.toFixed(2)}, length(vViewPosition)));
          outgoingLight += rimLight * ${strength.toFixed(3)} * rimAmount * diffuseColor.rgb${finishes ? " * (1.0 - toonRubber)" : ""};
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
              float cover = rustCover${finishes ? ` + vFinish.x * ${mech.edgeWear.rustFirst.toFixed(3)}` : ""};
              if (n < cover${finishes ? " && toonRubber < 0.5" : ""}) diffuseColor.rgb = n > cover - ${rust.rim.toFixed(3)} ? rustDark : rustColor;
            }`);
      }
      if (weathered) {
        const { moss, streaks, grime } = this.look.world;
        shader.uniforms.mossColor = { value: new THREE.Color(this.color(moss.color)) };
        shader.uniforms.mossDark = { value: new THREE.Color(this.color(moss.dark)) };
        shader.uniforms.streakColor = { value: new THREE.Color(this.color(streaks.color)) };
        shader.uniforms.grimeColor = { value: new THREE.Color(this.color(grime.color)) };
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "varying vec3 vWorldN;\nvoid main() {")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            vec3 wN = objectNormal;
            #ifdef USE_INSTANCING
              wN = mat3(instanceMatrix) * wN;
            #endif
            vWorldN = normalize(mat3(modelMatrix) * wN);`);
        fragment = fragment
          .replace("void main() {", "varying vec3 vWorldN;\nuniform vec3 mossColor;\nuniform vec3 mossDark;\nuniform vec3 streakColor;\nuniform vec3 grimeColor;\nvoid main() {")
          .replace("#include <color_fragment>", `#include <color_fragment>
            if (vWorldN.y > ${moss.minUp.toFixed(3)}) {
              float n = rustNoise(vec3(vWorldPos.xz * ${moss.scale.toFixed(3)}, 3.0)) * 0.7 + rustNoise(vec3(vWorldPos.xz * ${(moss.scale * 3).toFixed(3)}, 9.0)) * 0.3;
              ${mossGlsl(moss)}
            } else if (abs(vWorldN.y) < 0.4) {
              float along = vWorldPos.x + vWorldPos.z;
              float n = rustNoise(vec3(along * ${streaks.scale.toFixed(3)}, vWorldPos.y * ${(streaks.scale * 0.12).toFixed(3)}, 5.0));
              if (n < ${streaks.cover.toFixed(3)}) diffuseColor.rgb = mix(diffuseColor.rgb, streakColor, ${streaks.strength.toFixed(3)});
              if (toonAbove < ${grime.height.toFixed(3)}) diffuseColor.rgb = mix(diffuseColor.rgb, grimeColor, ${grime.strength.toFixed(3)});
            }`);
      }
      if (finishes) {
        const { edgeWear, metal, rubber } = mech;
        shader.uniforms.wearColor = { value: new THREE.Color(this.color(edgeWear.color)) };
        shader.uniforms.glintColor = { value: new THREE.Color(this.color(metal.color)) };
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "attribute vec2 finish;\nvarying vec2 vFinish;\nvarying vec3 vFinishPos;\nvoid main() {")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            vFinish = finish;
            vFinishPos = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));`);
        // Inserted after the rust's lines at the same place, so it runs first: rust covers chipped edges, not the
        // other way round. The finish is the same on every corner of a triangle, so the tests below never blend.
        fragment = fragment
          .replace("void main() {", "varying vec2 vFinish;\nvarying vec3 vFinishPos;\nuniform vec3 wearColor;\nuniform vec3 glintColor;\nvoid main() {")
          .replace("#include <color_fragment>", `#include <color_fragment>
            float toonMetal = step(0.5, vFinish.y) * step(vFinish.y, 1.5);
            float toonRubber = step(1.5, vFinish.y);
            float toonChip = vFinish.x * step(vFinish.y, 0.5) * (1.0 - smoothstep(${edgeWear.fade.startMeters.toFixed(2)}, ${edgeWear.fade.endMeters.toFixed(2)}, length(vViewPosition)));
            if (toonChip > 0.0 && rustNoise(vFinishPos * ${edgeWear.scale.toFixed(3)} + 41.0) < ${edgeWear.cover.toFixed(3)} * toonChip) diffuseColor.rgb = wearColor;
            diffuseColor.rgb *= mix(1.0, ${rubber.darken.toFixed(3)}, toonRubber);`)
          .replace("#include <lights_fragment_begin>", `toonEdges = mix(mix(toonEdges, ${vec(metal.bandEdges)}, toonMetal), ${vec(rubber.bandEdges)}, toonRubber);
            toonLevels = mix(mix(toonLevels, ${vec(metal.bands)}, toonMetal), ${vec(rubber.bands)}, toonRubber);
            toonGlintSize = toonMetal * ${metal.size.toFixed(4)};
            #include <lights_fragment_begin>`)
          .replace("#include <opaque_fragment>", `outgoingLight += toonGlint * glintColor * ${metal.glint.toFixed(3)};
            #include <opaque_fragment>`);
      }
      shader.fragmentShader = fragment;
      if (paint) addPaint(shader, paint);
    };
    m.customProgramCacheKey = () => `toon-rim-${strength}-${width}${rusts ? "-rust" : ""}${weathered ? "-world" : ""}${paint ? `-${paintCacheKey(paint)}` : ""}${finishes ? "-finish" : ""}`;
    return m;
  }

  // The outline round a box: the box drawn again from the inside, each face pushed out by the outline width there
  // (outlineWidth.ts), so only its rim shows round the edges. Its colour is the base colour darkened, never black,
  // so it reads as part of the thing it surrounds. Only for unit boxes (scaled to size), as box() and ToonInstances
  // make: each corner moves along the box's own axes, so the faces stay flat and the corners closed. `mech` uses
  // the mech outline settings.
  outlineMaterial(name: string, mech = false): THREE.MeshBasicMaterial {
    const hex = this.color(name);
    const key = mech ? `mech-${hex}` : hex;
    let m = this.outlines.get(key);
    if (!m) {
      const { outline } = this.look;
      m = new THREE.MeshBasicMaterial({ color: ink(hex, mech ? outline.mechDarken : outline.darken), side: THREE.BackSide });
      const width = mech ? outline.mech : outline.world;
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>${outlineWidthGlsl(width)}${OUTLINE_UNIT_GLSL}`)
          .replace("#include <project_vertex>", `#include <project_vertex>
  mat3 outlineAxes = mat3(modelViewMatrix);
  #ifdef USE_INSTANCING
    outlineAxes = outlineAxes * mat3(instanceMatrix);
  #endif
  vec3 outlineCorner = sign(position);
  ${pushOutGlsl("outlineUnit(outlineAxes[0]) * outlineCorner.x + outlineUnit(outlineAxes[1]) * outlineCorner.y + outlineUnit(outlineAxes[2]) * outlineCorner.z")}`);
      };
      m.customProgramCacheKey = () => `box-outline-${mech ? "mech" : "world"}`;
      this.outlines.set(key, m);
    }
    return m;
  }

  // The outline for a real model: the same mesh drawn from the inside with every vertex pushed out along its
  // outlineNormal (outlineNormals.ts: one direction per corner position, so flat-shaded shells stay closed at the
  // edges; every geometry drawn with this material gets it where it is built), by the outline width there
  // (outlineWidth.ts). The push is in view space, so a scaled model keeps the same width. `mech` uses the mech
  // outline settings.
  shellOutline(name: string, mech = false): THREE.MeshBasicMaterial {
    const hex = this.color(name);
    const key = mech ? `mech-${hex}` : hex;
    let m = this.shellOutlines.get(key);
    if (!m) {
      const { outline } = this.look;
      m = new THREE.MeshBasicMaterial({ color: ink(hex, mech ? outline.mechDarken : outline.darken), side: THREE.BackSide });
      const width = mech ? outline.mech : outline.world;
      m.onBeforeCompile = (shader) => {
        // A geometry without outline normals falls back to its normals rather than collapsing to NaN.
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\nattribute vec3 outlineNormal;${outlineWidthGlsl(width)}${OUTLINE_UNIT_GLSL}`)
          .replace("#include <project_vertex>", `#include <project_vertex>
  vec3 outlineAlong = dot(outlineNormal, outlineNormal) > 1e-12 ? outlineNormal : normal;
  #ifdef USE_INSTANCING
    outlineAlong = mat3(instanceMatrix) * outlineAlong;
  #endif
  ${pushOutGlsl("outlineUnit(mat3(modelViewMatrix) * outlineAlong)")}`);
      };
      m.customProgramCacheKey = () => `shell-${mech ? "mech" : "world"}`;
      this.shellOutlines.set(key, m);
    }
    return m;
  }

  // The copy of a shared material that instanced meshes use. Three compiles a different program for instanced and
  // plain meshes, and one material drawn both ways makes it look the program up again at every switch: dozens of
  // times a frame, about 90 kB of garbage a frame (docs/PERF.md). The copy shares the shader changes and uniforms.
  instanced<M extends THREE.Material>(material: M): M {
    let copy = this.instancedCopies.get(material) as M | undefined;
    if (!copy) {
      copy = material.clone() as M;
      copy.onBeforeCompile = material.onBeforeCompile;
      copy.customProgramCacheKey = material.customProgramCacheKey;
      copy.userData = material.userData; // clone() deep-copies it, and setRust's uniform must stay shared
      this.instancedCopies.set(material, copy);
    }
    return copy;
  }

  // A box with its outline: the same box drawn from the inside and pushed out (outlineMaterial).
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
    box.mesh.scale.set(size[0]!, size[1]!, size[2]!);
    box.hull.scale.copy(box.mesh.scale);
  }

  // An outline for a box mesh that is already scaled: a hull child, which follows the box's scale by itself.
  // `mech` uses the mech outline settings.
  outlineChild(mesh: THREE.Mesh, name: string, mech = false): void {
    mesh.add(new THREE.Mesh(unitBox, this.outlineMaterial(name, mech)));
  }

  instances(name: string, count: number, ground = false): ToonInstances {
    return new ToonInstances(this, name, count, ground);
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
    installHaze(this.look.haze.heightFalloff, this.look.haze.stepSoftness);
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
    this.towardSun.set(...preset.key.direction).normalize();
    this.key.position.copy(this.key.target.position).addScaledVector(this.towardSun, 100);
    this.key.shadow.intensity = preset.key.shadow;
    setToonShade(preset.shade);
    this.haze.color.set(this.color(preset.haze.color));
    this.haze.near = preset.haze.near;
    this.haze.far = preset.haze.far;
    useHaze(preset.haze, (c) => this.color(c));
    this.sky.use(preset);
  }
}

// How a world position maps onto the ground texture: u = x * scale + offset, the same for z. Corner (i, j) stands at
// (i * cell - meters / 2, j * cell - meters / 2) and lands in the middle of texel (i, j).
export function groundMapping(terrain: Pick<Terrain, "cell" | "corners" | "meters">): [number, number] {
  const n = terrain.corners;
  return [1 / (terrain.cell * n), (terrain.meters / 2 / terrain.cell + 0.5) / n];
}

// Flat ground at height 0, for pages and maps with no hills.
function flatGround(): THREE.DataTexture {
  return heightTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(0)]), 1);
}

// Heights in metres as half floats, which graphics cards blend between texels for free.
function heightTexture(heights: Uint16Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(heights, size, size, THREE.RedFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
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
  constructor(toon: Toon, name: string, count: number, ground = false) {
    this.mesh = new THREE.InstancedMesh(unitBox, toon.instanced(ground ? toon.ground(name) : toon.world(name, "metal", true)), count);
    this.hull = ground ? null : new THREE.InstancedMesh(unitBox, toon.instanced(toon.outlineMaterial(name)), count);
  }

  set(i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    this.mesh.setMatrixAt(i, placed.compose(at.set(x, y, z), noTurn, sized.set(sx, sy, sz)));
    this.hull?.setMatrixAt(i, placed); // the outline pushes itself out (outlineMaterial)
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
