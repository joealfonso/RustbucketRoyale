import { describe, expect, it } from "vitest";
import * as THREE from "three";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import { installToonLight, lightsBeginChunk, lightsEndChunk, parseShadowBrush, shadowBrushLight, toonParsChunk, type ToonLightLook } from "./toonLight";

const look = parseLook(lookJson);
new Toon(look, parsePalette(paletteJson)); // installs the chunks, as every page does before compiling anything
const lightLook: ToonLightLook = { ...look.shadows, bands: look.bands, bandEdges: look.bandEdges, edgePixels: look.bandEdgePixels, brush: look.shadowBrush };
const toonChunk = "struct ToonMaterial {\nvec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;";

describe("the toon sun", () => {
  it("is installed into three's shader chunks by the toon look", () => {
    expect(THREE.ShaderChunk.lights_toon_pars_fragment).toContain("toonShadow");
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain("toonSunLit = directLight.visible ? toonShadow(");
  });

  it("only changes the toon materials: everything else keeps three's own shadow line", () => {
    const begin = THREE.ShaderChunk.lights_fragment_begin;
    expect(begin).toContain("#if defined( TOON ) && defined( SHADOWMAP_TYPE_PCF )");
    expect(begin).toContain("directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]");
  });

  it("bakes the look's numbers in", () => {
    const pars = toonParsChunk({ edge: 0.1, fadeFrom: 0.6, bands: [0.2, 0.6, 1], bandEdges: [0.45, 0.7], edgePixels: 1.5, brush: look.shadowBrush }, toonChunk);
    expect(pars).toContain("smoothstep( 0.4000, 0.6001");
    expect(pars).toContain("smoothstep( 0.6000, 1.0, rim )");
    expect(pars).toContain("vec2 toonEdges = vec2( 0.4500, 0.7000 );");
    expect(pars).toContain("vec3 toonLevels = vec3( 0.2000, 0.6000, 1.0000 );");
    expect(pars).toContain("fwidth( toward ), 1e-5 ) * 0.7500;");
  });

  it("steps the bands over a pixel or so, not from a texture, with the shadow and middle bands turned toward the sky", () => {
    const pars = toonParsChunk(lightLook, toonChunk);
    expect(pars).toContain("smoothstep( toonEdges.x - aa, toonEdges.x + aa, toward )");
    expect(pars).not.toContain("texture2D( gradientMap");
    expect(pars).toContain("mix( key, cool, toonShade.x )");
    expect(pars).toContain("mix( key, cool, toonShade.y )");
  });

  it("shares one shade between every toon material, set by the light preset", () => {
    const shared = THREE.ShaderLib.toon!.uniforms.toonShade!.value as Float32Array;
    expect(shared).toBeInstanceOf(Float32Array); // copied by reference when a material compiles, unlike a Vector4
    const toon = new Toon(look, parsePalette(paletteJson));
    for (const p of toon.presets) {
      toon.useLight(p);
      expect([shared[0], shared[1]]).toEqual([Math.fround(p.shade.shadow), Math.fround(p.shade.mid)]);
    }
  });

  it("fails loudly if three's chunks change under it", () => {
    expect(() => toonParsChunk(lightLook, "something else")).toThrow(/toon lighting chunk changed/);
    expect(() => lightsBeginChunk("something else")).toThrow(/directional light code changed/);
  });

  it("can be installed again with the same numbers, but not with different ones", () => {
    const first = look.light.presets[0]!.shade;
    expect(() => installToonLight(lightLook, first)).not.toThrow();
    expect(() => installToonLight({ ...lightLook, edge: lightLook.edge + 0.01 }, first)).toThrow(/set it once/);
    expect(() => installToonLight({ ...lightLook, bands: [0.1, 0.5, 1] }, first)).toThrow(/set it once/);
  });
});

describe("painted shadows", () => {
  const brush = parseShadowBrush({ strength: 0.12, reach: 0.05 });

  it("mark only the shadow band, never the lit bands", () => {
    expect(shadowBrushLight(brush, 0.04, 1, 0)).toBeCloseTo(0.096);
    expect(shadowBrushLight(brush, -0.02, 1, 0)).toBeCloseTo(-0.048);
    expect(shadowBrushLight(brush, 0.04, 1, 1)).toBe(0);
    expect(shadowBrushLight(brush, 0.04, 1, 0.5)).toBeCloseTo(0.048); // across the band edge's pixel
  });

  it("fade with the atlas and leave seams and rivets as they are", () => {
    expect(shadowBrushLight(brush, 0.04, 0, 0)).toBe(0);
    expect(shadowBrushLight(brush, 0.04, 0.5, 0)).toBeCloseTo(0.048);
    expect(shadowBrushLight(brush, 0.2, 1, 0)).toBe(0); // a seam's dark step is past the reach of a brush mark
  });

  it("are baked into the toon materials only, after every light, and only with a sun", () => {
    const end = lightsEndChunk(brush, "RE_IndirectDiffuse( irradiance );");
    expect(end).toContain("#if defined( TOON ) && NUM_DIR_LIGHTS > 0");
    expect(end).toContain("step( abs( toonBrush ), 0.0500 ) * 2.4000 * toonBrushNear * ( 1.0 - toonSunSide )");
    expect(THREE.ShaderChunk.lights_fragment_end).toContain("toonBrushNear");
    expect(() => lightsEndChunk(brush, "something else")).toThrow(/light end code changed/);
  });

  it("refuse a loud or empty brush", () => {
    expect(() => parseShadowBrush({ strength: 0.8, reach: 0.05 })).toThrow(/shadowBrush/);
    expect(() => parseShadowBrush({ strength: 0.1, reach: 0 })).toThrow(/shadowBrush/);
  });
});

describe("the hard highlight", () => {
  it("is one flat shape, only in the top band, only on curved parts, lit by the sun's hue", () => {
    const pars = toonParsChunk(lightLook, toonChunk);
    expect(pars).toContain("toonGlint = max( toonGlint, lit * topBand * step( 1e-5, toonGlintSize ) * step( toonGlintBend, bendPerMetre ) * ( 1.0 - step(");
    expect(pars).toContain("toonGlintLight = key / max(");
    expect(pars).not.toContain("pow("); // no gloss falloff
  });
});
