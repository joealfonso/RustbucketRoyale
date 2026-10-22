import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Terrain } from "@rustbucket/shared";
import waterJson from "../../../data/water.json";
import { waterGeometry, waterLive, waterMaterial, waterShaderCode } from "./waterMesh";
import { parseWaterLook } from "./waterLook";

// A 40 m square with a round pond in the middle: corners within 10 m of the centre are 1.5 m down, the water
// stands 0.5 m down, everything else is dry ground at 0.
function pond(): Terrain {
  const cells = 10, cell = 4, n = cells + 1;
  const heights = new Int32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    heights[j * n + i] = Math.hypot(i * cell - 20, j * cell - 20) < 10 ? -150 : 0;
  }
  return new Terrain(cells * cell, cell, heights, 0.5, -50, 0.1);
}

// Whether the water mesh has a triangle over (x, z), and the depth it draws there (interpolated like the shader).
function drawnDepthAt(geometry: THREE.BufferGeometry, x: number, z: number): number | null {
  const p = geometry.getAttribute("position"), d = geometry.getAttribute("waterDepth"), index = geometry.getIndex()!;
  for (let k = 0; k < index.count; k += 3) {
    const [a, b, c] = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    const ax = p.getX(a), az = p.getZ(a), bx = p.getX(b), bz = p.getZ(b), cx = p.getX(c), cz = p.getZ(c);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const wc = 1 - wa - wb;
    if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return wa * d.getX(a) + wb * d.getX(b) + wc * d.getX(c);
  }
  return null;
}

describe("water mesh", () => {
  it("is nothing on a dry map", () => {
    expect(waterGeometry(Terrain.flat(40, 4))).toBeNull();
  });

  it("covers every wet spot, drawing the real depth there, and never dry ground", () => {
    const terrain = pond();
    const geometry = waterGeometry(terrain)!;
    for (let x = -19.5; x < 20; x += 1.3) {
      for (let z = -19.5; z < 20; z += 1.3) {
        const depth = drawnDepthAt(geometry, x, z);
        const real = terrain.waterLevel - terrain.heightAt(x, z);
        if (real > 0) {
          expect(depth, `water missing at ${x}, ${z}`).not.toBeNull();
          expect(depth!).toBeCloseTo(real, 4);
        } else if (depth !== null) {
          expect(depth, `water drawn over dry ground at ${x}, ${z}`).toBeLessThanOrEqual(1e-6); // the shader cuts it away
        }
      }
    }
  });

  it("lies flat at the water level, two triangles per cell that dips under it", () => {
    const terrain = pond();
    const geometry = waterGeometry(terrain)!;
    const p = geometry.getAttribute("position");
    for (let v = 0; v < p.count; v++) expect(p.getY(v)).toBeCloseTo(terrain.waterLevel);
    let wetCells = 0;
    const n = terrain.corners - 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (Math.min(terrain.corner(i, j), terrain.corner(i + 1, j), terrain.corner(i, j + 1), terrain.corner(i + 1, j + 1)) < terrain.waterLevel) wetCells++;
    }
    expect(wetCells).toBeGreaterThan(0);
    expect(geometry.getIndex()!.count).toBe(wetCells * 6);
  });
});

// A 40 m island: dry land within 10 m of the middle, sea 3 m deep everywhere else, so every edge corner is under it.
function islet(): Terrain {
  const cells = 10, cell = 4, n = cells + 1;
  const heights = new Int32Array(n * n), coast = new Int32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = Math.hypot(i * cell - 20, j * cell - 20);
    heights[j * n + i] = d < 10 ? 0 : -400;
    coast[j * n + i] = Math.round((10 - d) * 100);
  }
  return new Terrain(cells * cell, cell, heights, 0.5, -100, 0.1, coast, 300);
}

describe("the open sea round an island", () => {
  it("runs on past the map's edge at the edge's depth, from the edge's own corners, so there is no seam", () => {
    const terrain = islet();
    const geometry = waterGeometry(terrain, 500)!;
    for (const [x, z] of [[-200, 0], [0, 300], [400, 400], [-25, -21]] as const) expect(drawnDepthAt(geometry, x, z)).toBeCloseTo(3, 4);
    expect(drawnDepthAt(geometry, -600, 0)).toBeNull(); // it stops where the sea is said to
    // Every vertex at the map's edge is used once: the ring shares them with the water inside the map.
    const p = geometry.getAttribute("position");
    const edge = new Set<string>();
    for (let v = 0; v < p.count; v++) if (Math.max(Math.abs(p.getX(v)), Math.abs(p.getZ(v))) === 20) edge.add(`${p.getX(v)},${p.getZ(v)}`);
    expect(edge.size).toBe(40);
    expect([...edge].length).toBe([...Array(p.count).keys()].filter((v) => Math.max(Math.abs(p.getX(v)), Math.abs(p.getZ(v))) === 20).length);
  });

  it("faces up all the way round, like the water in the map", () => {
    const geometry = waterGeometry(islet(), 500)!;
    const p = geometry.getAttribute("position"), index = geometry.getIndex()!;
    for (let k = 0; k < index.count; k += 3) {
      const [a, b, c] = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
      const ux = p.getX(b) - p.getX(a), uz = p.getZ(b) - p.getZ(a), vx = p.getX(c) - p.getX(a), vz = p.getZ(c) - p.getZ(a);
      expect(uz * vx - ux * vz).toBeGreaterThan(0); // the y of the face's normal
    }
  });

  it("is not drawn round a map that is not an island", () => {
    const pondOnly = waterGeometry(pond(), 500)!;
    expect(drawnDepthAt(pondOnly, -100, 0)).toBeNull();
  });
});

describe("water look", () => {
  const look = parseWaterLook(waterJson);

  it("loads the data file and refuses bands out of order", () => {
    expect(look.surface.shallow.belowMeters).toBeLessThan(look.surface.deep.aboveMeters);
    const bad = JSON.parse(JSON.stringify(waterJson)) as typeof waterJson;
    bad.surface.shallow.belowMeters = 2;
    expect(() => parseWaterLook(bad)).toThrow(/shallow/);
    const sky = JSON.parse(JSON.stringify(waterJson)) as typeof waterJson;
    sky.surface.sky.steps.reverse();
    expect(() => parseWaterLook(sky)).toThrow(/sky steps/);
    const drops = JSON.parse(JSON.stringify(waterJson)) as typeof waterJson;
    drops.splashes.wade.dropSpeed = [5, 1];
    expect(() => parseWaterLook(drops)).toThrow(/dropSpeed/);
  });

  it("bakes the numbers into the shader, keeps the toon bands and fog, and has no gloss", () => {
    const code = waterShaderCode(look.surface);
    expect(code).toContain(look.surface.deep.aboveMeters.toFixed(4));
    expect(code).toContain("discard");
    expect(code).not.toContain("sin(dot");
    expect(code).not.toMatch(/\bflat\b/); // a reserved word in GLSL ES 3
    const m = waterMaterial(look.surface, new THREE.Texture(), (c) => c, waterLive(look.surface.wakes.max));
    expect(m).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(m.fog).toBe(true);
    expect(m.gradientMap).toBeTruthy();
    expect(m.opacity).toBe(look.surface.opacity);
    expect(m.transparent).toBe(true); // the shallows are see-through even if the rest is not
  });

  it("steps down in depth bands, glints toward the sun and foams round what stands in it", () => {
    const code = waterShaderCode(look.surface);
    expect(look.surface.deeper.aboveMeters).toBeGreaterThan(look.surface.deep.aboveMeters);
    expect(code).toContain(look.surface.deeper.aboveMeters.toFixed(4));
    expect(code).toContain("waterSun");
    expect(code).toContain("waterWakes[k]");
    expect(code).not.toMatch(/pow\(/); // a hard shape, no specular falloff
    const bad = JSON.parse(JSON.stringify(waterJson)) as typeof waterJson;
    bad.surface.deeper.aboveMeters = bad.surface.deep.aboveMeters;
    expect(() => parseWaterLook(bad)).toThrow(/deeper/);
    const wakes = JSON.parse(JSON.stringify(waterJson)) as typeof waterJson;
    wakes.surface.wakes.max = 1.5;
    expect(() => parseWaterLook(wakes)).toThrow(/wakes/);
    const glint = JSON.parse(JSON.stringify(waterJson)) as typeof waterJson;
    glint.surface.sunGlint.pathDegrees = 0;
    expect(() => parseWaterLook(glint)).toThrow(/sunGlint/);
  });
});
