import * as THREE from "three";
import { describe, expect, it } from "vitest";
import paintJson from "../../../../data/paint.json";
import paletteJson from "../../../../data/palette.json";
import lookJson from "../../../../data/look.json";
import { Toon, parseLook, parsePalette } from "../toonMaterial";
import { addGroundDetail, groundDetail } from "./groundDetail";
import { addPaint, paintCacheKey, paintSurface, type ShaderParts } from "./paintChunk";
import { parsePaintLook, propSurface } from "./paintLook";

const look = parsePaintLook(paintJson);
const atlas = new THREE.DataArrayTexture(new Uint8Array(4 * 4), 1, 1, 4);
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

describe("ground detail chunk", () => {
  it("reads the ground layer twice, in world space, before the emissive step", () => {
    const shader = toonShader();
    addGroundDetail(shader, groundDetail(look, atlas));
    expect(shader.uniforms.detailAtlas).toBeDefined();
    expect(shader.uniforms.detailLayer!.value).toBe(3);
    expect(shader.vertexShader).toContain("vDetailPos = (modelMatrix * detailPos).xyz;");
    expect(shader.fragmentShader.match(/textureGrad\(detailAtlas/g)).toHaveLength(2);
    expect(shader.fragmentShader.indexOf("textureGrad(detailAtlas")).toBeLessThan(shader.fragmentShader.indexOf("#include <emissivemap_fragment>"));
  });

  it("goes on the Toon's ground material after its own patches", () => {
    const material = toon.ground("moss");
    const shader = toonShader();
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("groundDarkMoss");
    expect(shader.fragmentShader).toContain("textureGrad(detailAtlas");
    expect(material.customProgramCacheKey()).toBe("toon-ground-ground-detail");
  });
});
