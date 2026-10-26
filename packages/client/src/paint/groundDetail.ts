import * as THREE from "three";
import { layerIndex } from "./paintAtlas";
import type { PaintLook } from "./paintLook";
import type { ShaderParts } from "./paintChunk";

// Close-range detail on the ground (gates V7b, V15): grass blades, grit and pebbles, rock fissures from the atlas's
// ground layer (one kind per channel, groundTile.ts). Projected from world space along the axis the ground faces most
// (from above on flat ground, from the side on cliffs).
//
// Which kind shows comes from the ground's own patches: groundMaterial.ts leaves `groundDetailMeters`, how far into dirt
// and into rock this spot is. The patch colours switch hard at the edge; the detail crosses it over blend.meters,
// clumped by the tile's blend noise, so a patch edge reads as painted rather than as a switch.
//
// No grid: the tile is read at two sizes turned against each other and added. Each read gives every tile cell its own
// turn and shift; near a cell edge it blends into a second grid half a cell over, whose own edges sit where the
// first grid is whole, so neither seam shows. That second read is only taken near an edge (about 4 pixels in 10), so
// a ground pixel costs 2 reads, 4 at most.
// Fades out between fade.startMeters and fade.endMeters; the far ground is the plain painted patches and their tone wash.
//
// `addGroundDetail` patches the ground material's shader inside its onBeforeCompile, after the ground's own patch.

export interface GroundDetail {
  uniforms: Record<string, THREE.IUniform>;
}

export const GROUND_DETAIL_CACHE_KEY = "ground-detail";

export function groundDetail(look: PaintLook, atlas: THREE.Texture): GroundDetail {
  const g = look.ground, turn = (g.secondTurnDegrees * Math.PI) / 180;
  return {
    uniforms: {
      detailAtlas: { value: atlas },
      detailLayer: { value: layerIndex("ground") },
      detailTile: { value: g.metersPerTile },
      detailSecond: { value: new THREE.Vector3(Math.cos(turn), Math.sin(turn), g.metersPerTile * g.secondScale) },
      detailFade: { value: new THREE.Vector2(g.fade.startMeters, g.fade.endMeters) },
      detailStrength: { value: new THREE.Vector3(g.strength.grass, g.strength.dirt, g.strength.rock) },
      detailBlend: { value: new THREE.Vector3(1 / g.blend.meters, g.blend.softness, g.tiling.band) },
    },
  };
}

const DECLARE = "varying vec3 vDetailPos;\nvarying vec3 vDetailNormal;\n";

const VERTEX_CODE = `
    vec4 detailPos = vec4(transformed, 1.0);
    vec3 detailNormal = objectNormal;
    #ifdef USE_INSTANCING
      detailPos = instanceMatrix * detailPos;
      detailNormal = mat3(instanceMatrix) * detailNormal;
    #endif
    vDetailPos = (modelMatrix * detailPos).xyz;
    vDetailNormal = mat3(modelMatrix) * detailNormal;`;

// The hash is sin-free, like the ground's: sin() of large cell numbers differs between graphics cards. The turn's
// cos and sin are of an angle under a full turn, which every card agrees on.
const FRAGMENT_DECLARE = `${DECLARE}uniform sampler2DArray detailAtlas;
uniform float detailLayer;
uniform float detailTile;
uniform vec3 detailSecond;
uniform vec2 detailFade;
uniform vec3 detailStrength;
uniform vec3 detailBlend;
float detailHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// One read of the tile as this cell lays it: turned and shifted by the cell's own hash, about the cell's corner so the
// numbers stay small far from the origin.
vec4 detailCell(vec2 uv, vec2 cell, vec2 key, vec2 gx, vec2 gy) {
  float a = detailHash(key) * 6.2832;
  mat2 turn = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 shift = vec2(detailHash(key + 19.0), detailHash(key + 47.0));
  return textureGrad(detailAtlas, vec3(turn * (uv - cell) + shift, detailLayer), turn * gx, turn * gy);
}
// The tile with no grid, uv in tiles. Explicit gradients, so the read inside the branch is safe.
vec4 detailRead(vec2 uv, vec2 gx, vec2 gy, float salt) {
  vec2 f = fract(uv), e = min(f, 1.0 - f);
  float a = smoothstep(0.0, detailBlend.z, min(e.x, e.y));
  vec4 s = detailCell(uv, floor(uv), floor(uv) + salt, gx, gy);
  if (a < 1.0) {
    vec2 cell = floor(uv + 0.5) - 0.5, f2 = fract(uv + 0.5), e2 = min(f2, 1.0 - f2);
    float b = (1.0 - a) * smoothstep(0.0, detailBlend.z, min(e2.x, e2.y));
    // The small extra weight on the first read only matters at the few points where both grids have an edge.
    s = (s * (a + 0.001) + detailCell(uv, cell, cell + salt + 101.0, gx, gy) * b) / (a + b + 0.001);
  }
  return s;
}
`;

// Channels as groundTile.ts paints them: R dirt, G grass, B rock, A the blend noise.
const FRAGMENT_CODE = `
    {
      vec3 detailAxis = abs(vDetailNormal);
      vec2 detailUv = detailAxis.y >= max(detailAxis.x, detailAxis.z) ? vDetailPos.xz : (detailAxis.x > detailAxis.z ? vDetailPos.zy : vDetailPos.xy);
      mat2 detailTurn = mat2(detailSecond.x, detailSecond.y, -detailSecond.y, detailSecond.x);
      vec2 detailGx = dFdx(detailUv), detailGy = dFdy(detailUv);
      float detailNear = 1.0 - smoothstep(detailFade.x, detailFade.y, length(vViewPosition));
      if (detailNear > 0.0) {
        vec4 detailA = detailRead(detailUv / detailTile, detailGx / detailTile, detailGy / detailTile, 0.0);
        vec4 detailB = detailRead(detailTurn * detailUv / detailSecond.z, detailTurn * detailGx / detailSecond.z, detailTurn * detailGy / detailSecond.z, 57.0);
        vec3 marks = detailA.rgb + detailB.rgb - 1.0;
        // 0 a half blend width before the edge, 1 a half width past it; the blend noise decides where in between.
        vec2 across = clamp(groundDetailMeters * detailBlend.x + 0.5, 0.0, 1.0);
        float toDirt = smoothstep(detailA.a - detailBlend.y, detailA.a + detailBlend.y, across.x);
        float toRock = smoothstep(detailB.a - detailBlend.y, detailB.a + detailBlend.y, across.y);
        float mark = mix(mix(marks.g * detailStrength.x, marks.r * detailStrength.y, toDirt), marks.b * detailStrength.z, toRock);
        diffuseColor.rgb *= 1.0 + mark * 2.0 * detailNear;
      }
    }`;

const VERTEX_HOOK = "#include <begin_vertex>";
const FRAGMENT_HOOK = "#include <emissivemap_fragment>";

export function addGroundDetail(shader: ShaderParts, detail: GroundDetail): void {
  if (!shader.vertexShader.includes(VERTEX_HOOK) || !shader.fragmentShader.includes(FRAGMENT_HOOK)) {
    throw new Error("addGroundDetail: the shader has no begin_vertex or emissivemap_fragment include (is it a MeshToonMaterial?)");
  }
  if (!shader.fragmentShader.includes("groundDetailMeters")) {
    throw new Error("addGroundDetail: the shader has no groundDetailMeters (add it after groundMaterial.ts's own patch)");
  }
  Object.assign(shader.uniforms, detail.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", `${DECLARE}void main() {`)
    .replace(VERTEX_HOOK, `${VERTEX_HOOK}${VERTEX_CODE}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", `${FRAGMENT_DECLARE}void main() {`)
    .replace(FRAGMENT_HOOK, `${FRAGMENT_CODE}\n    ${FRAGMENT_HOOK}`);
}
