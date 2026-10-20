import * as THREE from "three";
import { layerIndex } from "./paintAtlas";
import type { PaintLook } from "./paintLook";
import type { ShaderParts } from "./paintChunk";

// Close-range detail on the ground (gate V7b): grit, pebbles, grass blades and cracks from the atlas's ground layer,
// read twice, at two sizes and turned against each other, and added, so its tile never shows as a grid. Projected from
// world space along the axis the ground faces most (from above on flat ground, from the side on cliffs). Grass shows
// only where the ground colour is green, cracks only where it is not, so the detail follows the ground's own patches.
// Gone by fade.endMeters, so the far ground is the plain painted patches of groundMaterial.ts.
//
// `addGroundDetail` patches a shader inside the ground material's onBeforeCompile, before or after its own patch.

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
      detailStrength: { value: new THREE.Vector3(g.grit, g.grass, g.cracks) },
      detailGrassTest: { value: new THREE.Vector2(g.grassTest.greenOverRed, g.grassTest.greenOverBlue) },
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

const FRAGMENT_DECLARE = `${DECLARE}uniform sampler2DArray detailAtlas;
uniform float detailLayer;
uniform float detailTile;
uniform vec3 detailSecond;
uniform vec2 detailFade;
uniform vec3 detailStrength;
uniform vec2 detailGrassTest;
`;

// Channels as groundTile.ts paints them: R grit and stones, G grass blades, B cracks.
const FRAGMENT_CODE = `
    {
      vec3 detailAxis = abs(vDetailNormal);
      vec2 detailUv = detailAxis.y >= max(detailAxis.x, detailAxis.z) ? vDetailPos.xz : (detailAxis.x > detailAxis.z ? vDetailPos.zy : vDetailPos.xy);
      mat2 detailTurn = mat2(detailSecond.x, detailSecond.y, -detailSecond.y, detailSecond.x);
      vec2 detailGx = dFdx(detailUv), detailGy = dFdy(detailUv);
      float detailNear = 1.0 - smoothstep(detailFade.x, detailFade.y, length(vViewPosition));
      if (detailNear > 0.0) {
        vec4 detailA = textureGrad(detailAtlas, vec3(detailUv / detailTile, detailLayer), detailGx / detailTile, detailGy / detailTile);
        vec4 detailB = textureGrad(detailAtlas, vec3(detailTurn * detailUv / detailSecond.z + 0.37, detailLayer), detailTurn * detailGx / detailSecond.z, detailTurn * detailGy / detailSecond.z);
        vec3 c = diffuseColor.rgb;
        c *= 1.0 + (detailA.r + detailB.r - 1.0) * 2.0 * detailStrength.x * detailNear;
        if (c.g >= c.r * detailGrassTest.x && c.g >= c.b * detailGrassTest.y) c *= 1.0 + (detailA.g + detailB.g - 1.0) * 2.0 * detailStrength.y * detailNear;
        else c *= 1.0 - smoothstep(0.4, 0.6, max(detailA.b, detailB.b)) * detailStrength.z * detailNear;
        diffuseColor.rgb = c;
      }
    }`;

const VERTEX_HOOK = "#include <begin_vertex>";
const FRAGMENT_HOOK = "#include <emissivemap_fragment>";

export function addGroundDetail(shader: ShaderParts, detail: GroundDetail): void {
  if (!shader.vertexShader.includes(VERTEX_HOOK) || !shader.fragmentShader.includes(FRAGMENT_HOOK)) {
    throw new Error("addGroundDetail: the shader has no begin_vertex or emissivemap_fragment include (is it a MeshToonMaterial?)");
  }
  Object.assign(shader.uniforms, detail.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", `${DECLARE}void main() {`)
    .replace(VERTEX_HOOK, `${VERTEX_HOOK}${VERTEX_CODE}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", `${FRAGMENT_DECLARE}void main() {`)
    .replace(FRAGMENT_HOOK, `${FRAGMENT_CODE}\n    ${FRAGMENT_HOOK}`);
}
