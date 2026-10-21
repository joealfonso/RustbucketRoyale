import { describe, expect, it } from "vitest";
import * as THREE from "three";
import groundJson from "../../../data/ground.json";
import { groundMaterial, groundShaderCode, parseGroundLook, setGroundWater } from "./groundMaterial";

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

  it("soaks the ground under and just above the water, and is dry until a map says where its water is", () => {
    const g = parseGroundLook(groundJson);
    const code = groundShaderCode(g);
    expect(code).toContain("groundWaterLevel");
    expect(code).toContain(g.wet.dampMeters.toFixed(4));
    const m = groundMaterial("#5E7F3A", new THREE.Texture(), (c) => c);
    const level = m.userData.groundWaterLevel as { value: number };
    expect(level.value).toBeLessThan(-1000);
    setGroundWater(m, -5.5);
    expect(level.value).toBe(-5.5);
    setGroundWater(m, -Infinity);
    expect(level.value).toBeLessThan(-1000);
    const bad = copy();
    bad.wet.dampStrength = 3;
    expect(() => parseGroundLook(bad)).toThrow(/wet/);
  });

  it("washes a faint tone over all the ground, and refuses a loud one", () => {
    const g = parseGroundLook(groundJson);
    const code = groundShaderCode(g);
    expect(code).toContain(g.tone.scale.toFixed(4));
    expect(code).toContain((g.tone.amount * 2).toFixed(4));
    const loud = copy();
    loud.tone.amount = 0.5;
    expect(() => parseGroundLook(loud)).toThrow(/tone/);
  });

  it("leaves how far into dirt and rock each spot is, from the same edges as the colours", () => {
    const g = parseGroundLook(groundJson);
    const code = groundShaderCode(g);
    expect(code).toContain("vec2 groundDetailMeters;");
    for (const edge of [g.regions.dirt.above, g.hills.dirt.rise, g.hills.rock.rise, g.gravel.above, g.hills.flatBelow]) {
      expect(code).toContain(`, ${edge.toFixed(4)}, `);
    }
    expect(code.lastIndexOf("fwidth(")).toBeGreaterThan(code.lastIndexOf("if (")); // derivatives outside any branch
  });
});
