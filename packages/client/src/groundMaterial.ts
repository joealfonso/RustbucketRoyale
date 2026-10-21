import * as THREE from "three";
import { GROUND_DETAIL_CACHE_KEY, addGroundDetail, type GroundDetail } from "./paint/groundDetail";
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
  // The hills (M11). Low ground leans to dark moss and high ground to dry grass, by up to `bias` noise units once
  // `meters` below or above the map's edge height. Ground rising more than `dirt.rise` metres per metre is bare dirt,
  // more than `rock.rise` is rock with darker strata `strataMeters` apart (wavering by up to `wobble` of a layer),
  // so ridges and steep faces read from far off. `ragged` (rise units) breaks those edges up with the brush noise.
  // Gravel, oil and tyre tracks only lie on ground flatter than `flatBelow`.
  hills: {
    hollow: { meters: number; bias: number };
    crest: { meters: number; bias: number };
    dirt: { color: string; rise: number };
    rock: { color: string; strata: string; rise: number; strataMeters: number; strataShare: number; wobble: number };
    ragged: number;
    flatBelow: number;
  };
  // Water (M11 11b). Ground under the water level is a muddy `bed`; ground less than `dampMeters` above it is
  // darkened toward `damp` (by `dampStrength`), so every pond has a dark wet rim that reads from far off. The edges
  // waver by up to `raggedMeters` of height, with noise `scale` cells a metre. An island's shore is sand up to
  // `beach.meters` above the sea (setGroundBeach), so it reads as a coast, not a flooded field.
  wet: { bed: string; damp: string; dampMeters: number; dampStrength: number; raggedMeters: number; scale: number; beach: { color: string; meters: number } };
  // A faint lighter and darker wash over everything, `scale` noise cells a metre plus a finer octave, up to `amount`
  // either way. It never fades, so the far ground has a little of the life the close-range detail gives the near
  // ground, and the line where that detail fades out does not show as a band.
  tone: { scale: number; amount: number };
}

export function parseGroundLook(raw: unknown): GroundLook {
  const g = raw as GroundLook;
  if (!g?.regions || !g.breakup || !g.gravel || !g.brush || !g.oil || !g.tracks || !g.hills || !g.wet || !g.tone) throw new Error("ground.json: needs regions, breakup, gravel, brush, oil, tracks, hills, wet and tone");
  if (!(g.tone.scale > 0 && g.tone.amount >= 0 && g.tone.amount <= 0.2)) throw new Error("ground.json: tone scale above 0, amount between 0 and 0.2");
  if (!(g.wet.dampMeters > 0 && g.wet.raggedMeters >= 0 && g.wet.dampStrength >= 0 && g.wet.dampStrength <= 1)) throw new Error("ground.json: wet dampMeters above 0, raggedMeters 0 or more, dampStrength between 0 and 1");
  if (!(typeof g.wet.beach?.color === "string" && g.wet.beach.meters > 0)) throw new Error("ground.json: wet needs beach color and meters above 0");
  const { hills } = g;
  if (!(hills.hollow.meters > 0 && hills.crest.meters > 0)) throw new Error("ground.json: hills hollow and crest meters must be above 0");
  if (!(hills.flatBelow > 0 && hills.flatBelow <= hills.dirt.rise && hills.dirt.rise < hills.rock.rise)) throw new Error("ground.json: hills must go flatBelow <= dirt rise < rock rise");
  if (!(hills.rock.strataMeters > 0 && hills.rock.strataShare >= 0 && hills.rock.strataShare <= 1)) throw new Error("ground.json: rock strataMeters above 0, strataShare between 0 and 1");
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
  float gKeep(float size, float pixel) { return 1.0 - smoothstep(size * 0.25, size * 0.6, pixel); }
  // Roughly how many metres past edge a value is (negative before it), from how much it changes across a pixel
  // (change, its fwidth) and how wide a pixel is. The floor stops a nearly level value reading as far from its edge.
  float gPast(float value, float edge, float change, float pixel) { return (value - edge) * pixel / max(change, pixel * 0.001); }`;

// The ground's fragment code: picks a colour for this spot from the patches, then the bands light it as usual.
// It also leaves `groundDetailMeters` for the close-range detail (paint/groundDetail.ts): how far into dirt (x) and into
// rock (y) this spot is, in metres, negative before the edge. The same thresholds as the colours, so the detail's
// ragged crossing is centred on each hard colour edge.
export function groundShaderCode(g: GroundLook): string {
  const { regions, breakup, gravel, brush, oil, tracks, hills, wet, tone } = g;
  const angle = (brush.angleDegrees * Math.PI) / 180;
  return `
    vec2 groundDetailMeters;
    {
      vec2 gp = vGroundPos;
      float pixel = length(fwidth(gp));
      float fine = gKeep(1.0 / ${f(breakup.scale)}, pixel);
      vec3 c = diffuseColor.rgb;
      float ragged = (gNoise(gp * ${f(breakup.scale)}) - 0.5) * ${f(breakup.amount)} * fine;
      // Hollows lean to dark moss, crests to dry grass: the same patches, pushed by height.
      float lean = clamp(vGroundY / ${f(hills.crest.meters)}, 0.0, 1.0) * ${f(hills.crest.bias)} - clamp(-vGroundY / ${f(hills.hollow.meters)}, 0.0, 1.0) * ${f(hills.hollow.bias)};
      float n = gNoise(gp * ${f(regions.scale)}) * 0.7 + gNoise(gp * ${f(regions.scale * 2.3)} + 31.0) * 0.3 + ragged + lean;
      if (n < ${f(regions.darkMoss.below)}) c = groundDarkMoss;
      else if (n > ${f(regions.dirt.above)}) c = groundDirt;
      else if (n > ${f(regions.dryGrass.above)}) c = groundDryGrass;
      // How steep the ground is here, metres up per metre across, its edges broken up like the patches.
      float up = clamp(vGroundUp, 0.05, 1.0);
      float rise = sqrt(1.0 - up * up) / up + ragged / ${f(Math.max(breakup.amount, 1e-4))} * ${f(hills.ragged)};
      bool gentle = rise < ${f(hills.flatBelow)};
      float gr = gNoise(gp * ${f(gravel.scale)} + 71.0) + ragged;
      if (gentle && gr > ${f(gravel.above)}) {
        float speck = step(gHash(floor(gp / ${f(gravel.speckMeters)})), ${f(gravel.speckCover)}) * gKeep(${f(gravel.speckMeters)}, pixel);
        c = mix(groundGravel, groundSpeck, speck);
      }
      vec2 bp = vec2(gp.x * ${f(Math.cos(angle))} + gp.y * ${f(Math.sin(angle))}, -gp.x * ${f(Math.sin(angle))} + gp.y * ${f(Math.cos(angle))});
      float stroke = gNoise(vec2(bp.x * ${f(brush.scale / brush.stretch)}, bp.y * ${f(brush.scale)}) + 5.0);
      if (rise > ${f(hills.rock.rise)}) {
        // Rock, in level layers: a hard light and dark stripe that follows the contour round the hill.
        float layer = fract(vGroundY / ${f(hills.rock.strataMeters)} + gNoise(gp * ${f(breakup.scale)} + 13.0) * ${f(hills.rock.wobble)});
        c = layer < ${f(hills.rock.strataShare)} ? groundStrata : groundRock;
      } else if (rise > ${f(hills.dirt.rise)}) c = groundSlope;
      if (stroke > ${f(brush.above)}) c *= 1.0 + ${f(brush.strength)} * gKeep(1.0 / ${f(brush.scale)}, pixel);

      vec2 oilCell = floor(gp / ${f(oil.cellMeters)});
      if (gentle && gHash(oilCell + 17.0) < ${f(oil.chance)}) {
        vec2 centre = (oilCell + 0.25 + vec2(gHash(oilCell + 3.0), gHash(oilCell + 11.0)) * 0.5) * ${f(oil.cellMeters)};
        float radius = mix(${f(oil.minRadius)}, ${f(oil.maxRadius)}, gHash(oilCell + 5.0));
        float d = length(gp - centre) / radius + (gNoise(gp * 0.9 + 3.0) - 0.5) * ${f(oil.ragged)};
        if (d < 1.0) c = mix(c, groundOil, d < ${f(oil.core)} ? ${f(oil.coreStrength)} : ${f(oil.strength)});
      }

      vec2 trackCell = floor(gp / ${f(tracks.cellMeters)});
      if (gentle && gHash(trackCell + 41.0) < ${f(tracks.chance)}) {
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

      // Under the water a muddy bed, and a dark wet rim just above it. Last, so tracks and oil get soaked too.
      float aboveWater = vGroundY - groundWaterLevel + (gNoise(gp * ${f(wet.scale)} + 57.0) - 0.5) * ${f(wet.raggedMeters * 2)};
      if (aboveWater < 0.0) c = groundBed;
      else {
        if (aboveWater < groundBeach) c = groundSand;
        if (aboveWater < ${f(wet.dampMeters)}) c = mix(c, groundDamp, ${f(wet.dampStrength)});
      }
      float wash = gNoise(gp * ${f(tone.scale)} + 91.0) * 0.6 + gNoise(gp * ${f(tone.scale * 2.7)} + 23.0) * 0.4;
      c *= 1.0 + (wash - 0.5) * ${f(tone.amount * 2)};
      diffuseColor.rgb = c;

      // Dirt is bare dirt, slope dirt, gravel, sand and the bed; rock is the steep faces, unless sand covers them.
      float dRise = fwidth(rise), dWater = fwidth(aboveWater);
      float pastSand = gPast(-aboveWater, -max(groundBeach, 0.0), dWater, pixel);
      float pastGravel = min(gPast(gr, ${f(gravel.above)}, fwidth(gr), pixel), -gPast(rise, ${f(hills.flatBelow)}, dRise, pixel));
      float pastDirt = max(max(gPast(n, ${f(regions.dirt.above)}, fwidth(n), pixel), gPast(rise, ${f(hills.dirt.rise)}, dRise, pixel)), max(pastGravel, pastSand));
      groundDetailMeters = vec2(pastDirt, min(gPast(rise, ${f(hills.rock.rise)}, dRise, pixel), -pastSand));
    }`;
}

// The ground material: the toon bands with no rim (a rim on a big flat floor draws a hard line where it turns away),
// over the patches. It keeps the standard fog, so the scene's haze lies over it like everything else. Used for the
// hills (terrainMesh.ts) and for the flat floor box of the range and the style test.
// `detail`: the close-range painted grit, pebbles, grass and cracks (paint/groundDetail.ts), or none.
export function groundMaterial(hex: string, ramp: THREE.Texture, color: (name: string) => string, g: GroundLook = groundLook, detail: GroundDetail | null = null): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp });
  const colors: Record<string, string> = {
    groundDarkMoss: g.regions.darkMoss.color, groundDryGrass: g.regions.dryGrass.color, groundDirt: g.regions.dirt.color,
    groundGravel: g.gravel.color, groundSpeck: g.gravel.speck, groundOil: g.oil.color, groundTrack: g.tracks.color,
    groundSlope: g.hills.dirt.color, groundRock: g.hills.rock.color, groundStrata: g.hills.rock.strata,
    groundBed: g.wet.bed, groundDamp: g.wet.damp, groundSand: g.wet.beach.color,
  };
  const code = groundShaderCode(g);
  // The map's water level, changed per map by setGroundWater without rebuilding the shader. Far below anything on a dry map.
  const waterLevel = { value: DRY };
  m.userData.groundWaterLevel = waterLevel;
  const beach = { value: 0 };
  m.userData.groundBeach = beach;
  m.onBeforeCompile = (shader) => {
    for (const [name, value] of Object.entries(colors)) shader.uniforms[name] = { value: new THREE.Color(color(value)) };
    shader.uniforms.groundWaterLevel = waterLevel;
    shader.uniforms.groundBeach = beach;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vGroundPos;\nvarying float vGroundY;\nvarying float vGroundUp;\nvoid main() {")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec4 groundPos = vec4(transformed, 1.0);
        vec3 groundNormal = objectNormal;
        #ifdef USE_INSTANCING
          groundPos = instanceMatrix * groundPos;
          groundNormal = mat3(instanceMatrix) * groundNormal;
        #endif
        groundPos = modelMatrix * groundPos;
        vGroundPos = groundPos.xz;
        vGroundY = groundPos.y;
        vGroundUp = normalize(mat3(modelMatrix) * groundNormal).y;`);
    const declarations = Object.keys(colors).map((name) => `uniform vec3 ${name};`).join("\n") + "\nuniform float groundWaterLevel;\nuniform float groundBeach;";
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `varying vec2 vGroundPos;\nvarying float vGroundY;\nvarying float vGroundUp;\n${declarations}\n${GROUND_GLSL}\nvoid main() {`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${code}`);
    if (detail) addGroundDetail(shader, detail);
  };
  m.customProgramCacheKey = () => `toon-ground${detail ? `-${GROUND_DETAIL_CACHE_KEY}` : ""}`;
  return m;
}

const DRY = -1e6;

// Tells a ground material where this map's water is: a height in metres, or -Infinity (or null) for a dry map.
export function setGroundWater(material: THREE.Material, level: number | null): void {
  const uniform = material.userData.groundWaterLevel as { value: number } | undefined;
  if (uniform) uniform.value = level === null || !Number.isFinite(level) ? DRY : level;
}

// How far above the water an island's shore is sand, per map, without rebuilding the shader; 0 for no beach.
export function setGroundBeach(material: THREE.Material, meters: number): void {
  const uniform = material.userData.groundBeach as { value: number } | undefined;
  if (uniform) uniform.value = meters;
}
