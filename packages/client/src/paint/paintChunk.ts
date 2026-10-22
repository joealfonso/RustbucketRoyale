import * as THREE from "three";
import { SURFACE_LAYERS, cellSteps, layerIndex } from "./paintAtlas";
import type { PaintLook, SurfaceKind } from "./paintLook";
import { WEAR_TOP } from "./marks";

// Puts the painted atlas on a toon material's surfaces, which have no UVs: each face is box-projected from its own
// object space (the axis it faces most picks which two coordinates are the texture's), scaled to metres, so marks
// keep their size whatever the box's scale and move with the thing they are painted on. One texture read a pixel.
// The atlas only shades, rusts, dirties or chips the colour the material already has (palette and vertex colour),
// and fades to nothing between fade.startMeters and fade.endMeters; a soft large tone drift (farTone) never fades, so
// far surfaces are the toon colour, gently uneven, and nothing changes suddenly at the fade line.
//
// Against the repeat, each tile cell (one tile's worth of face) picks by a hash of its number: a variant layer, a
// mirror left to right, a start inside the layer on one of its joints (cellSteps, so cells meet at seams), a small
// tone nudge, and on faces that look up or down a quarter turn (walls never turn, so streaks still run down). An
// instanced thing (map boxes, props) also shifts its cells by a hash of where its instance stands, so two crates side
// by side differ. Not a plain mesh's position: mechs and falling drops move, and their paint would slide.
//
// `addPaint` patches the shader inside a material's onBeforeCompile, after any other patches or before them: it only
// adds lines next to includes it leaves in place.

export interface PaintSurface {
  kind: SurfaceKind;
  // The surface is the unit box (scaled by its mesh or instance), so the shader knows where the box's own edges are
  // and chips paint along them. Wrong for merged geometry, whose positions are not a unit box.
  edges: boolean;
  uniforms: Record<string, THREE.IUniform>;
}

export interface ShaderParts {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

const f = (n: number) => n.toFixed(4);

// One surface kind's settings as uniforms. Materials of that kind share these objects, so one change retunes them all.
export function paintSurface(look: PaintLook, kind: SurfaceKind, atlas: THREE.Texture, color: (name: string) => string, edges = false): PaintSurface {
  const s = look.surfaces[kind];
  return {
    kind,
    edges: edges && s.edgeMeters > 0,
    uniforms: {
      paintAtlas: { value: atlas },
      paintLayer: { value: layerIndex(s.layer) },
      paintTile: { value: s.metersPerTile },
      paintSteps: { value: new THREE.Vector2(...cellSteps(look, s.layer)) },
      paintVariants: { value: look.variants },
      paintCellTone: { value: look.cellTone },
      paintFarTone: { value: new THREE.Vector2(look.farTone.meters, look.farTone.strength) },
      paintStrength: { value: new THREE.Vector4(s.shade, s.rust, s.grime, s.bare) },
      paintTopRust: { value: s.topRust },
      paintEdge: { value: s.edgeMeters },
      paintFade: { value: new THREE.Vector2(look.fade.startMeters, look.fade.endMeters) },
      paintRust: { value: new THREE.Color(color(look.colors.rust)) },
      paintRustDark: { value: new THREE.Color(color(look.colors.rustDark)) },
      paintGrime: { value: new THREE.Color(color(look.colors.grime)) },
      paintBare: { value: new THREE.Color(color(s.bareColor)) },
      paintTape: { value: new THREE.Color(color(look.colors.tape)) },
      paintTapeShare: { value: look.tapeShare },
    },
  };
}

export function paintCacheKey(surface: PaintSurface): string {
  return `paint-${surface.kind}${surface.edges ? "-edges" : ""}`;
}

// A sin-free hash of whole cell numbers (sin of large numbers differs between graphics cards).
const HASH = "float paintHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }\n";

const VERTEX_DECLARE = "varying vec3 vPaintPos;\nvarying vec3 vPaintSize;\nvarying vec3 vPaintNormal;\nflat varying vec2 vPaintObject;\n";

// Position in metres from the unit box's lowest corner (for other geometry, from half a metre below its origin; only
// the edges care), with the mesh's and the instance's scale, so a 6 m container shows 6 m of plates. vPaintObject is
// two hashes of where the instance stands (to the quarter metre), the same at every vertex.
const VERTEX_CODE = `
    vec3 paintScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
    vPaintObject = vec2(0.0);
    #ifdef USE_INSTANCING
      paintScale *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vec3 paintAt = floor(instanceMatrix[3].xyz * 4.0);
      vPaintObject = vec2(paintHash(paintAt.xz + paintAt.y * 0.37), paintHash(paintAt.zx - paintAt.y * 0.71 + 19.0));
    #endif
    vPaintPos = (position + 0.5) * paintScale;
    vPaintSize = paintScale;
    vPaintNormal = objectNormal;`;

const FRAGMENT_DECLARE = `${VERTEX_DECLARE}uniform sampler2DArray paintAtlas;
uniform float paintLayer;
uniform float paintTile;
uniform vec2 paintSteps;
uniform float paintVariants;
uniform float paintCellTone;
uniform vec2 paintFarTone;
uniform vec4 paintStrength;
uniform float paintTopRust;
uniform float paintEdge;
uniform vec2 paintFade;
uniform vec3 paintRust;
uniform vec3 paintRustDark;
uniform vec3 paintGrime;
uniform vec3 paintBare;
uniform vec3 paintTape;
uniform float paintTapeShare;
${HASH}float paintNoise(vec2 p) {
  vec2 i = floor(p), t = p - i;
  t = t * t * (3.0 - 2.0 * t);
  return mix(mix(paintHash(i), paintHash(i + vec2(1.0, 0.0)), t.x), mix(paintHash(i + vec2(0.0, 1.0)), paintHash(i + 1.0), t.x), t.y);
}
`;

// The channels are described in marks.ts. Derivatives are taken before the branch (they are undefined inside one
// that neighbouring pixels may not take) and of the continuous position, so the mip level never jumps where the
// projection axis changes or at a cell's edge; each cell's mirror and turn are applied to them as well.
function fragmentCode(edges: boolean): string {
  const wearTop = f(WEAR_TOP);
  return `
    {
      vec3 paintAxis = abs(vPaintNormal);
      float paintTop = step(paintAxis.x, paintAxis.y) * step(paintAxis.z, paintAxis.y);
      vec3 paintDx = dFdx(vPaintPos), paintDy = dFdy(vPaintPos);
      vec2 paintUv = vPaintPos.xy, paintGx = paintDx.xy, paintGy = paintDy.xy, paintFace = vPaintSize.xy;
      if (paintTop > 0.5) { paintUv = vPaintPos.xz; paintGx = paintDx.xz; paintGy = paintDy.xz; paintFace = vPaintSize.xz; }
      else if (paintAxis.x > paintAxis.z) { paintUv = vPaintPos.zy; paintGx = paintDx.zy; paintGy = paintDy.zy; paintFace = vPaintSize.zy; }
      float paintPixel = length(paintGx) + length(paintGy);
      vec2 paintT = paintUv / paintTile + vPaintObject;
      diffuseColor.rgb *= 1.0 + (paintNoise(paintT * paintTile / paintFarTone.x) - 0.5) * 2.0 * paintFarTone.y;
      float paintNear = 1.0 - smoothstep(paintFade.x, paintFade.y, length(vViewPosition));
      if (paintNear > 0.0) {
        vec2 paintCell = floor(paintT), paintId = paintCell + vPaintObject * 113.0 + paintLayer * 17.0;
        vec4 paintPick = vec4(paintHash(paintId), paintHash(paintId + 31.7), paintHash(paintId + 63.1), paintHash(paintId + 91.3));
        float paintQuarter = floor(paintPick.y * 4.0) * paintTop;
        vec2 paintCs = paintQuarter < 0.5 ? vec2(1.0, 0.0) : paintQuarter < 1.5 ? vec2(0.0, 1.0) : paintQuarter < 2.5 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
        mat2 paintTurn = mat2(paintCs.x, paintCs.y, -paintCs.y, paintCs.x) * mat2(paintPick.x < 0.5 ? -1.0 : 1.0, 0.0, 0.0, 1.0);
        vec2 paintStart = floor(fract(paintPick.zw * 7.0) * paintSteps) / paintSteps;
        float paintVariant = floor(paintPick.w * paintVariants);
        float paintAt = paintLayer + paintVariant * ${SURFACE_LAYERS.length}.0 + min(paintVariant, 1.0);
        vec2 paintSample = paintTurn * (paintT - paintCell - 0.5) + 0.5 + paintStart;
        vec4 paint = textureGrad(paintAtlas, vec3(paintSample, paintAt), paintTurn * paintGx / paintTile, paintTurn * paintGy / paintTile);
        // The brush marks again, for the shadow band only (toonLight.ts): fixed to the surface, so they never swim.
        toonBrush = paint.r - 0.5;
        toonBrushNear = paintNear;
        float paintCellShade = (paintHash(paintId + 47.9) - 0.5) * 2.0 * paintCellTone;
        vec3 c = diffuseColor.rgb * (1.0 + paintCellShade * paintNear) * (1.0 + (paint.r - 0.5) * 2.0 * paintStrength.x * paintNear);
        float rust = smoothstep(0.45, 0.55, paint.g) * mix(1.0, paintTopRust, paintTop) * paintStrength.y * paintNear;
        c = mix(c, mix(paintRust, paintRustDark, smoothstep(0.74, 0.8, paint.g)), rust);
        c = mix(c, paintGrime, smoothstep(0.45, 0.55, paint.b) * paintStrength.z * paintNear);
        float chipped = smoothstep(0.52, 0.58, paint.a) * (1.0 - smoothstep(0.8, 0.86, paint.a));
        ${edges ? `vec2 paintIn = min(paintUv, paintFace - paintUv);
        float paintReach = paintEdge * 2.0 * smoothstep(0.5, 0.95, min(paint.a / ${wearTop}, 1.0));
        chipped = max(chipped, 1.0 - smoothstep(-paintPixel, paintPixel, min(paintIn.x, paintIn.y) - paintReach));` : ""}
        c = mix(c, paintBare, chipped * paintStrength.w * paintNear);
        c = mix(c, paintTape, smoothstep(0.88, 0.94, paint.a) * step(fract(paintPick.x * 7.0), paintTapeShare) * paintNear);
        diffuseColor.rgb = c;
      }
    }`;
}

const VERTEX_HOOK = "#include <begin_vertex>";
const FRAGMENT_HOOK = "#include <emissivemap_fragment>";

export function addPaint(shader: ShaderParts, surface: PaintSurface): void {
  if (!shader.vertexShader.includes(VERTEX_HOOK) || !shader.fragmentShader.includes(FRAGMENT_HOOK)) {
    throw new Error("addPaint: the shader has no begin_vertex or emissivemap_fragment include (is it a MeshToonMaterial?)");
  }
  Object.assign(shader.uniforms, surface.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", `${VERTEX_DECLARE}${HASH}void main() {`)
    .replace(VERTEX_HOOK, `${VERTEX_HOOK}${VERTEX_CODE}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", `${FRAGMENT_DECLARE}void main() {`)
    .replace(FRAGMENT_HOOK, `${fragmentCode(surface.edges)}\n    ${FRAGMENT_HOOK}`);
}
