import { describe, expect, it } from "vitest";
import * as THREE from "three";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import { installToonLight, lightsBeginChunk, toonParsChunk } from "./toonLight";

const look = parseLook(lookJson);
new Toon(look, parsePalette(paletteJson)); // installs the chunks, as every page does before compiling anything

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
    const pars = toonParsChunk({ edge: 0.1, fadeFrom: 0.6, skyTint: 0.25 }, "struct ToonMaterial {\nvec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;");
    expect(pars).toContain("smoothstep( 0.4000, 0.6001");
    expect(pars).toContain("smoothstep( 0.6000, 1.0, rim )");
    expect(pars).toContain(", 0.2500 );");
  });

  it("fails loudly if three's chunks change under it", () => {
    expect(() => toonParsChunk(look.shadows, "something else")).toThrow(/toon lighting chunk changed/);
    expect(() => lightsBeginChunk("something else")).toThrow(/directional light code changed/);
  });

  it("can be installed again with the same numbers, but not with different ones", () => {
    expect(() => installToonLight(look.shadows)).not.toThrow();
    expect(() => installToonLight({ ...look.shadows, edge: look.shadows.edge + 0.01 })).toThrow(/set it once/);
  });
});
