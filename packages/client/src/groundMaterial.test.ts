import { describe, expect, it } from "vitest";
import * as THREE from "three";
import groundJson from "../../../data/ground.json";
import { groundMaterial, groundShaderCode, parseGroundLook } from "./groundMaterial";

const copy = () => JSON.parse(JSON.stringify(groundJson)) as typeof groundJson;

describe("ground look", () => {
  it("loads the data file", () => {
    const g = parseGroundLook(groundJson);
    expect(g.regions.darkMoss.below).toBeLessThan(g.regions.dryGrass.above);
  });

  it("refuses regions out of order, stains that would cross their cell and tracks longer than theirs", () => {
    const regions = copy();
    regions.regions.dirt.above = 0.1;
    expect(() => parseGroundLook(regions)).toThrow(/regions/);
    const oil = copy();
    oil.oil.maxRadius = oil.oil.cellMeters;
    expect(() => parseGroundLook(oil)).toThrow(/oil/);
    const tracks = copy();
    tracks.tracks.maxLength = tracks.tracks.cellMeters * 2;
    expect(() => parseGroundLook(tracks)).toThrow(/tracks/);
    const chance = copy();
    chance.oil.chance = 2;
    expect(() => parseGroundLook(chance)).toThrow(/chance/);
  });

  it("refuses hill bands out of order", () => {
    const steep = copy();
    steep.hills.rock.rise = steep.hills.dirt.rise / 2;
    expect(() => parseGroundLook(steep)).toThrow(/hills/);
    const strata = copy();
    strata.hills.rock.strataShare = 2;
    expect(() => parseGroundLook(strata)).toThrow(/strata/);
  });

  it("bakes the numbers into the shader and keeps the bands and fog", () => {
    const g = parseGroundLook(groundJson);
    const code = groundShaderCode(g);
    expect(code).toContain(g.regions.scale.toFixed(4));
    expect(code).toContain((g.tracks.gauge / 2).toFixed(4));
    expect(code).not.toContain("sin(dot"); // the hash must not depend on how a graphics card does sin()
    expect(code).toContain(g.hills.rock.rise.toFixed(4));
    expect(code).not.toMatch(/\bflat\b/); // a reserved word in GLSL ES 3, which fails the whole shader
    const m = groundMaterial("#5E7F3A", new THREE.Texture(), (c) => c);
    expect(m.fog).toBe(true);
    expect(m.gradientMap).toBeTruthy();
  });
});
