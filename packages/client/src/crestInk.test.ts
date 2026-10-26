import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Terrain } from "@rustbucket/shared";
import groundJson from "../../../data/ground.json";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { inkOf, parseCrestInk } from "./crestInk";
import { setGroundWater } from "./groundMaterial";
import { TerrainMeshes, parseTerrainMeshLook } from "./terrainMesh";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const look = parseLook(lookJson);
const toon = new Toon(look, parsePalette(paletteJson));
const ground = paletteJson.world.ground;

function patched(m: THREE.Material): { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> } {
  const lib = THREE.ShaderLib.basic!;
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  m.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

describe("crest ink", () => {
  it("is the ground's own colour darkened, never black", () => {
    const ink = inkOf("#6a8a3a", look.outline.crest.darken);
    const original = new THREE.Color("#6a8a3a");
    expect(ink.r).toBeGreaterThan(0);
    expect(ink.g).toBeLessThan(original.g);
    // The hue survives: green stays the strongest channel.
    expect(ink.g).toBeGreaterThan(ink.r);
    expect(() => parseCrestInk({ ...look.outline.crest, darken: 0 })).toThrow(/never black/);
    expect(() => parseCrestInk({ ...look.outline.crest, pixels: 0 })).toThrow(/outline.crest/);
  });

  it("is a shell pushed out by a width in pixels, coloured per vertex by slope, beach and bed", () => {
    const m = toon.groundInk(ground);
    expect(m.side).toBe(THREE.BackSide);
    const shader = patched(m);
    expect(shader.vertexShader).toContain("float outlineMeters(vec4 mvPosition)");
    expect(shader.vertexShader).toContain("outlineUnit(mat3(modelViewMatrix) * normal)");
    for (const name of ["groundRegionNoise", "crestDirt", "crestRock", "crestSlope", "crestSand", "crestBed"]) expect(shader.vertexShader).toContain(name);
    expect(shader.fragmentShader).toContain("diffuseColor.rgb = vCrestInk;");
    expect(toon.groundInk(ground)).toBe(m); // one per ground colour
  });

  it("shares the ground's water level, so a new map's water reaches it with no call of its own", () => {
    const shader = patched(toon.groundInk(ground));
    setGroundWater(toon.ground(ground), 1.5);
    expect(shader.uniforms.groundWaterLevel!.value).toBe(1.5);
  });

  it("rings every terrain tile, switches with it, and can be turned off", () => {
    const n = 33;
    const terrain = new Terrain(64, 2, new Int32Array(n * n), 0.5);
    const scene = new THREE.Scene();
    const meshes = new TerrainMeshes(scene, terrain, toon.ground(ground), parseTerrainMeshLook(groundJson.mesh), toon.groundInk(ground));
    const tiles = meshes.group.children.filter((o) => (o as THREE.Mesh).material === toon.ground(ground) && o.children.length > 0) as THREE.Mesh[];
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      const shell = tile.children[0] as THREE.Mesh;
      expect(shell.geometry).toBe(tile.geometry);
      expect(shell.material).toBe(toon.groundInk(ground));
    }
    meshes.setInk(false);
    expect(tiles.every((t) => !t.children[0]!.visible)).toBe(true);
    meshes.dispose();
  });
});
