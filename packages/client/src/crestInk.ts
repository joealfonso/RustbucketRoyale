import * as THREE from "three";
import { GROUND_GLSL, groundLook, groundRegionGlsl, type GroundLook } from "./groundMaterial";
import { OUTLINE_UNIT_GLSL, outlineWidthGlsl, parseOutlineWidth, pushOutGlsl, type OutlineWidth } from "./outlineWidth";

// Ink on the hills (gate V16b): a line along every crest and along the land's skyline, where the ground meets the sky,
// the sea or lower ground behind it. The hills had no outline, so a ridge melted into the slope behind it.
// It is a shell like the props' outlines: each terrain tile drawn again from the inside, pushed out along its normals
// by a width in screen pixels (outlineWidth.ts). A heightfield is only seen from its front, so the shell's inside
// shows nowhere but just over a crest, where the slope behind turns away from the eye. It works at every effects
// quality and needs no screen pass; it costs one more draw call per terrain tile on screen and the tile's vertices again,
// with a fragment shader that only writes a colour.
// The colour is the ground's own, darkened like outlines are (a share of its on-screen brightness), picked per vertex
// the way the ground shader picks it (groundMaterial.ts): the big patches (moss, dark moss, dry grass, dirt), then
// slope dirt and rock by steepness, then sand and the bed by height over the water. Without the fine breakup, which a
// line a few pixels wide would not show. Never black. The haze lies over it as over the ground.

export interface CrestInk extends OutlineWidth {
  darken: number; // 0 to 1: the line's share of the on-screen brightness of the ground it is drawn from
}

export function parseCrestInk(raw: unknown): CrestInk {
  const c = parseOutlineWidth(raw, "outline.crest") as CrestInk;
  if (!(typeof c.darken === "number" && c.darken > 0 && c.darken < 1)) throw new Error("look.json: outline.crest needs darken above 0 and below 1 (a line is never black)");
  return c;
}

// A colour darkened to a share of its on-screen brightness, as a working (linear) colour.
export function inkOf(hex: string, share: number): THREE.Color {
  return new THREE.Color(hex).convertLinearToSRGB().multiplyScalar(share).convertSRGBToLinear();
}

const f = (n: number) => n.toFixed(4);

// `ground` is the ground material it rings (groundMaterial.ts): its colour, water level and beach are shared, so a new
// map's water reaches the ink with no call of its own.
export function crestInkMaterial(ground: THREE.MeshToonMaterial, look: CrestInk, color: (name: string) => string, g: GroundLook = groundLook): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  const ink = (name: string) => ({ value: inkOf(color(name), look.darken) });
  const base = { value: inkOf(`#${ground.color.getHexString()}`, look.darken) };
  const { hills, regions } = g;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      crestBase: base, crestDarkMoss: ink(regions.darkMoss.color), crestDryGrass: ink(regions.dryGrass.color), crestDirt: ink(regions.dirt.color),
      crestSlope: ink(hills.dirt.color), crestRock: ink(hills.rock.color), crestSand: ink(g.wet.beach.color), crestBed: ink(g.wet.bed),
      groundWaterLevel: ground.userData.groundWaterLevel ?? { value: -1e6 }, groundBeach: ground.userData.groundBeach ?? { value: 0 },
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
uniform vec3 crestBase, crestDarkMoss, crestDryGrass, crestDirt, crestSlope, crestRock, crestSand, crestBed;
uniform float groundWaterLevel, groundBeach;
varying vec3 vCrestInk;${GROUND_GLSL}${groundRegionGlsl(g)}${outlineWidthGlsl(look)}${OUTLINE_UNIT_GLSL}`)
      .replace("#include <project_vertex>", `#include <project_vertex>
  {
    float up = clamp(normalize(mat3(modelMatrix) * normal).y, 0.05, 1.0);
    float rise = sqrt(1.0 - up * up) / up;
    vec3 crestAt = (modelMatrix * vec4(position, 1.0)).xyz;
    float n = groundRegionNoise(crestAt.xz, crestAt.y);
    vCrestInk = n < ${f(regions.darkMoss.below)} ? crestDarkMoss : n > ${f(regions.dirt.above)} ? crestDirt : n > ${f(regions.dryGrass.above)} ? crestDryGrass : crestBase;
    if (rise > ${f(hills.rock.rise)}) vCrestInk = crestRock;
    else if (rise > ${f(hills.dirt.rise)}) vCrestInk = crestSlope;
    float above = crestAt.y - groundWaterLevel;
    if (above < 0.0) vCrestInk = crestBed;
    else if (above < groundBeach) vCrestInk = crestSand;
  }
  ${pushOutGlsl("outlineUnit(mat3(modelViewMatrix) * normal)")}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying vec3 vCrestInk;\nvoid main() {")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb = vCrestInk;");
  };
  m.customProgramCacheKey = () => "crest-ink";
  return m;
}
