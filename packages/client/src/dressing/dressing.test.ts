import * as THREE from "three";
import { describe, expect, it } from "vitest";
import mechJson from "../../../../data/mech.json";
import paletteJson from "../../../../data/palette.json";
import lookJson from "../../../../data/look.json";
import { parseMechStats } from "@rustbucket/shared";
import { buildPlayMap } from "../loadMap";
import { MapMeshes } from "../mapRenderer";
import { Toon, parseLook, parsePalette } from "../toonMaterial";
import { BUILDERS, Dressing, scatter } from "./index";

function setup(scatterPerChunk = 40) {
  const map = buildPlayMap("medium", 5, parseMechStats(mechJson));
  const scene = new THREE.Scene();
  const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
  const meshes = new MapMeshes(scene, map, toon);
  const hidden = new Set<number>();
  const original = meshes.setVisible.bind(meshes);
  meshes.setVisible = (i, visible) => { if (visible) hidden.delete(i); else hidden.add(i); original(i, visible); };
  const dressing = new Dressing(scene, toon, map, meshes, BUILDERS, scatter, { radiusMeters: 120, chunkMeters: 50, scatterPerChunk });
  return { map, dressing, hidden };
}

describe("junkyard dressing", () => {
  it("every box kind in the chunk data has a builder or is plain", () => {
    const { map } = setup();
    for (const kind of map.kindNames) expect(kind === "plain" || kind in BUILDERS).toBe(true);
  });

  it("hides the plain boxes it dresses near you, and gives them back when you leave", () => {
    const { map, dressing, hidden } = setup();
    dressing.update(0, 0);
    expect(hidden.size).toBeGreaterThan(0);
    for (const i of hidden) {
      const b = map.boxes[i]!;
      expect(Math.hypot((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)).toBeLessThan(120 + 50 * 1.5);
    }
    const near = new Set(hidden);
    dressing.update(400, 400);
    for (const i of near) {
      const b = map.boxes[i]!;
      if (Math.hypot((b.minX + b.maxX) / 2 - 400, (b.minZ + b.maxZ) / 2 - 400) > 250) expect(hidden.has(i)).toBe(false);
    }
  });

  it("draws one mesh and one outline per paint, the same way every time", () => {
    const a = setup(), b = setup();
    a.dressing.update(0, 0);
    b.dressing.update(0, 0);
    expect(a.dressing.group.children.length).toBeGreaterThan(2);
    expect(a.dressing.group.children.length % 2).toBe(0);
    const count = (d: Dressing) => d.group.children.reduce((n, c) => n + ((c as THREE.Mesh).geometry.index?.count ?? 0), 0);
    expect(count(a.dressing)).toBe(count(b.dressing));
  });
});
