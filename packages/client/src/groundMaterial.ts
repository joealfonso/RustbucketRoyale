import * as THREE from "three";
import groundJson from "../../../data/ground.json";

// The floor's look, from data/ground.json: the toon bands over painted patches worked out in the shader from world
// position, so there is no texture to download and every client sees the same ground in the same place.
// Patches are hard edged like the rust on the mechs; colours are hex or palette names.

export interface GroundLook {
  // Big soft-shaped regions over the moss base: darker moss in the hollows, dry grass, then bare dirt where it is driest.
  // `scale` is noise cells per metre; `below` / `above` pick each region's share of the noise.
  regions: {
    scale: number;
    darkMoss: { color: string; below: number };
    dryGrass: { color: string; above: number };
    dirt: { color: string; above: number };
  };
  // Fine noise added to the region edges so they look painted with a brush, not traced. `amount` in noise units.
  breakup: { scale: number; amount: number };
  // Gravel patches of their own, speckled with darker stones `speckMeters` across.
  gravel: { color: string; speck: string; scale: number; above: number; speckMeters: number; speckCover: number };
  // Long faint lighter strokes all leaning one way, the visible brush marks DESIGN.md asks for.
  brush: { scale: number; stretch: number; angleDegrees: number; above: number; strength: number };
  // A few dark oil stains: at most one per cell, `chance` of one, with a darker core.
  oil: { cellMeters: number; chance: number; minRadius: number; maxRadius: number; ragged: number; color: string; strength: number; core: number; coreStrength: number };
  // Straight pairs of tyre ruts, `gauge` apart, broken by gaps. Each fits inside its own cell, so none is cut off.
  tracks: { cellMeters: number; chance: number; minLength: number; maxLength: number; gauge: number; width: number; gaps: number; color: string; strength: number };
}

export function parseGroundLook(raw: unknown): GroundLook {
  const g = raw as GroundLook;
  if (!g?.regions || !g.breakup || !g.gravel || !g.brush || !g.oil || !g.tracks) throw new Error("ground.json: needs regions, breakup, gravel, brush, oil and tracks");
  const { regions, oil, tracks } = g;
  if (!(regions.darkMoss.below < regions.dryGrass.above && regions.dryGrass.above < regions.dirt.above)) throw new Error("ground.json: regions must go darkMoss below < dryGrass above < dirt above");
  // A stain sits in the middle half of its cell, so it never crosses into the next one, where it would be cut off.
  if (oil.maxRadius * (1 + oil.ragged) > oil.cellMeters / 4) throw new Error("ground.json: oil stains must fit inside a quarter of their cell");
  if (tracks.maxLength > tracks.cellMeters || tracks.minLength > tracks.maxLength) throw new Error("ground.json: tracks must be shorter than their cell, minLength up to maxLength");
  for (const [name, value] of Object.entries({ chance: oil.chance, trackChance: tracks.chance, gaps: tracks.gaps, speckCover: g.gravel.speckCover })) {
    if (!(value >= 0 && value <= 1)) throw new Error(`ground.json: ${name} must be between 0 and 1`);
  }
  return g;
}

export const groundLook = parseGroundLook(groundJson);

const f = (n: number) => n.toFixed(4);

// A sin-free hash on whole cell numbers: sin() of large world coordinates differs between graphics cards.
const GROUND_GLSL = `
  float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float gNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
  }
  // 1 while a feature of this size in metres is several pixels wide, 0 once a pixel covers most of it: fine detail
  // fades out with distance instead of shimmering.
  float gKeep(float size, float pixel) { return 1.0 - smoothstep(size * 0.25, size * 0.6, pixel); }`;

// The ground's fragment code: picks a colour for this spot from the patches, then the bands light it as usual.
export function groundShaderCode(g: GroundLook): string {
  const { regions, breakup, gravel, brush, oil, tracks } = g;
  const angle = (brush.angleDegrees * Math.PI) / 180;
  return `
    {
      vec2 gp = vGroundPos;
      float pixel = length(fwidth(gp));
      float fine = gKeep(1.0 / ${f(breakup.scale)}, pixel);
      vec3 c = diffuseColor.rgb;
      float ragged = (gNoise(gp * ${f(breakup.scale)}) - 0.5) * ${f(breakup.amount)} * fine;
      float n = gNoise(gp * ${f(regions.scale)}) * 0.7 + gNoise(gp * ${f(regions.scale * 2.3)} + 31.0) * 0.3 + ragged;
      if (n < ${f(regions.darkMoss.below)}) c = groundDarkMoss;
      else if (n > ${f(regions.dirt.above)}) c = groundDirt;
      else if (n > ${f(regions.dryGrass.above)}) c = groundDryGrass;
      float gr = gNoise(gp * ${f(gravel.scale)} + 71.0) + ragged;
      if (gr > ${f(gravel.above)}) {
        float speck = step(gHash(floor(gp / ${f(gravel.speckMeters)})), ${f(gravel.speckCover)}) * gKeep(${f(gravel.speckMeters)}, pixel);
        c = mix(groundGravel, groundSpeck, speck);
      }
      vec2 bp = vec2(gp.x * ${f(Math.cos(angle))} + gp.y * ${f(Math.sin(angle))}, -gp.x * ${f(Math.sin(angle))} + gp.y * ${f(Math.cos(angle))});
      float stroke = gNoise(vec2(bp.x * ${f(brush.scale / brush.stretch)}, bp.y * ${f(brush.scale)}) + 5.0);
      if (stroke > ${f(brush.above)}) c *= 1.0 + ${f(brush.strength)} * gKeep(1.0 / ${f(brush.scale)}, pixel);

      vec2 oilCell = floor(gp / ${f(oil.cellMeters)});
      if (gHash(oilCell + 17.0) < ${f(oil.chance)}) {
        vec2 centre = (oilCell + 0.25 + vec2(gHash(oilCell + 3.0), gHash(oilCell + 11.0)) * 0.5) * ${f(oil.cellMeters)};
        float radius = mix(${f(oil.minRadius)}, ${f(oil.maxRadius)}, gHash(oilCell + 5.0));
        float d = length(gp - centre) / radius + (gNoise(gp * 0.9 + 3.0) - 0.5) * ${f(oil.ragged)};
        if (d < 1.0) c = mix(c, groundOil, d < ${f(oil.core)} ? ${f(oil.coreStrength)} : ${f(oil.strength)});
      }

      vec2 trackCell = floor(gp / ${f(tracks.cellMeters)});
      if (gHash(trackCell + 41.0) < ${f(tracks.chance)}) {
        float turn = gHash(trackCell + 7.0) * 3.14159;
        vec2 dir = vec2(cos(turn), sin(turn));
        vec2 rel = gp - (trackCell + 0.5) * ${f(tracks.cellMeters)};
        float along = dot(rel, dir);
        float across = dot(rel, vec2(-dir.y, dir.x));
        float halfLength = mix(${f(tracks.minLength / 2)}, ${f(tracks.maxLength / 2)}, gHash(trackCell + 9.0));
        float rut = abs(abs(across) - ${f(tracks.gauge / 2)});
        // Gaps open up toward the ends, so a track fades in and out instead of stopping square.
        float gap = gNoise(vec2(along * 0.3, gHash(trackCell) * 50.0)) - smoothstep(0.6, 1.0, abs(along) / halfLength) * 0.6;
        if (abs(along) < halfLength && rut < ${f(tracks.width / 2)} && gap > ${f(tracks.gaps)}) {
          c = mix(c, groundTrack, ${f(tracks.strength)} * gKeep(${f(tracks.width)}, pixel));
        }
      }
      diffuseColor.rgb = c;
    }`;
}

// The ground material: the toon bands with no rim (a rim on a big flat floor draws a hard line where it turns away),
// over the patches. It keeps the standard fog, so the scene's haze lies over it like everything else.
export function groundMaterial(hex: string, ramp: THREE.Texture, color: (name: string) => string, g: GroundLook = groundLook): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp });
  const colors: Record<string, string> = {
    groundDarkMoss: g.regions.darkMoss.color, groundDryGrass: g.regions.dryGrass.color, groundDirt: g.regions.dirt.color,
    groundGravel: g.gravel.color, groundSpeck: g.gravel.speck, groundOil: g.oil.color, groundTrack: g.tracks.color,
  };
  const code = groundShaderCode(g);
  m.onBeforeCompile = (shader) => {
    for (const [name, value] of Object.entries(colors)) shader.uniforms[name] = { value: new THREE.Color(color(value)) };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vGroundPos;\nvoid main() {")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec4 groundPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          groundPos = instanceMatrix * groundPos;
        #endif
        vGroundPos = (modelMatrix * groundPos).xz;`);
    const declarations = Object.keys(colors).map((name) => `uniform vec3 ${name};`).join("\n");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `varying vec2 vGroundPos;\n${declarations}\n${GROUND_GLSL}\nvoid main() {`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${code}`);
  };
  m.customProgramCacheKey = () => "toon-ground";
  return m;
}
