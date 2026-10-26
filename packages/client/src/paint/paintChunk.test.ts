import * as THREE from "three";
import { describe, expect, it } from "vitest";
import paintJson from "../../../../data/paint.json";
import paletteJson from "../../../../data/palette.json";
import lookJson from "../../../../data/look.json";
import { Toon, parseLook, parsePalette } from "../toonMaterial";
import { SURFACE_LAYERS, cellSteps } from "./paintAtlas";
import { addPaint, paintCacheKey, paintSurface, type ShaderParts } from "./paintChunk";
import { parsePaintLook, propSurface } from "./paintLook";

const look = parsePaintLook(paintJson);
const atlas = new THREE.DataArrayTexture(new Uint8Array(4 * 7), 1, 1, 7);
const toonLib = THREE.ShaderLib.toon!;
const toonShader = (): ShaderParts => ({ vertexShader: toonLib.vertexShader, fragmentShader: toonLib.fragmentShader, uniforms: {} });
const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));

describe("paint chunk", () => {
  it("adds its uniforms, varyings and one block of fragment code just before the emissive step", () => {
    const shader = toonShader();
    addPaint(shader, paintSurface(look, "metal", atlas, (c) => toon.color(c)));
    for (const name of ["paintAtlas", "paintLayer", "paintTile", "paintStrength", "paintFade", "paintRust", "paintBare", "paintTape"]) expect(shader.uniforms[name]).toBeDefined();
    expect(shader.vertexShader).toContain("varying vec3 vPaintPos;");
    expect(shader.vertexShader.indexOf("vPaintPos = ")).toBeGreaterThan(shader.vertexShader.indexOf("#include <begin_vertex>"));
    expect(shader.fragmentShader).toContain("uniform sampler2DArray paintAtlas;");
    const paint = shader.fragmentShader.indexOf("textureGrad(paintAtlas");
    expect(paint).toBeGreaterThan(shader.fragmentShader.indexOf("#include <color_fragment>"));
    expect(paint).toBeLessThan(shader.fragmentShader.indexOf("#include <emissivemap_fragment>"));
    expect(shader.fragmentShader.match(/textureGrad\(paintAtlas/g)).toHaveLength(1); // one texture read a pixel
  });

  it("varies each cell and each placed instance, turns only faces that look up, and keeps the far tone past the fade", () => {
    const shader = toonShader();
    addPaint(shader, paintSurface(look, "wood", atlas, (c) => toon.color(c)));
    for (const name of ["paintSteps", "paintVariants", "paintCellTone", "paintFarTone"]) expect(shader.uniforms[name]).toBeDefined();
    expect((shader.uniforms.paintSteps!.value as THREE.Vector2).toArray()).toEqual(cellSteps(look, "wood"));
    expect(shader.uniforms.paintVariants!.value).toBe(look.variants);
    // The instance's place, the same for the whole instance, and only for instances: a plain mesh may move.
    expect(shader.vertexShader).toContain("flat varying vec2 vPaintObject;");
    expect(shader.vertexShader).toMatch(/#ifdef USE_INSTANCING[^#]*vPaintObject = /);
    expect(shader.fragmentShader).toContain("floor(paintPick.y * 4.0) * paintTop");
    const far = shader.fragmentShader.indexOf("paintNoise(paintT"), near = shader.fragmentShader.indexOf("if (paintNear > 0.0)");
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
    // The layer a variant reads is surfaceLayer's rule.
    expect(shader.fragmentShader).toContain(`paintVariant * ${SURFACE_LAYERS.length}.0 + min(paintVariant, 1.0)`);
    expect(shader.fragmentShader).not.toMatch(/\bsin\(/);
  });

  it("chips box edges only for unit boxes, and keys its programs by kind and edges", () => {
    const color = (c: string) => toon.color(c);
    const plain = toonShader(), boxed = toonShader();
    addPaint(plain, paintSurface(look, "metal", atlas, color));
    addPaint(boxed, paintSurface(look, "metal", atlas, color, true));
    expect(plain.fragmentShader).not.toContain("paintIn");
    expect(boxed.fragmentShader).toContain("paintIn");
    expect(paintCacheKey(paintSurface(look, "metal", atlas, color, true))).not.toBe(paintCacheKey(paintSurface(look, "wood", atlas, color, true)));
    // A surface with no edge width never chips edges, even when asked.
    expect(paintSurface(look, "mech", atlas, color, true).edges).toBe(look.surfaces.mech.edgeMeters > 0);
  });

  it("goes on the toon world material after its own patch, keeping its weathering and rim", () => {
    const material = toon.world("rustOrange", "metal");
    const shader = toonShader();
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("mossColor");
    expect(shader.fragmentShader).toContain("rimColor");
    expect(shader.fragmentShader).toContain("textureGrad(paintAtlas");
    expect(material.customProgramCacheKey()).toContain("paint-metal");
    expect(material.customProgramCacheKey()).toContain("world");
    expect(toon.world("rustOrange", null).customProgramCacheKey()).not.toContain("paint");
  });

  it("paints crate planks as wood and its straps as metal, and anything unlisted as metal", () => {
    expect(propSurface(look, "crate", "rustOrange")).toBe("wood");
    expect(propSurface(look, "crate", "sparkYellow")).toBe("metal");
    expect(propSurface(look, "no such prop", "rustOrange")).toBe("metal");
  });

  it("says so instead of silently doing nothing on a shader that is not a toon material", () => {
    expect(() => addPaint({ vertexShader: "void main() {}", fragmentShader: "void main() {}", uniforms: {} }, paintSurface(look, "wood", atlas, (c) => c))).toThrow(/addPaint/);
  });
});
