import * as THREE from "three";
import { describe, expect, it } from "vitest";
import mechJson from "../../../../data/mech.json";
import paletteJson from "../../../../data/palette.json";
import lookJson from "../../../../data/look.json";
import { parseMechStats } from "@rustbucket/shared";
import { buildPlayMap, type PlayMap } from "../loadMap";
import { MapMeshes } from "../mapRenderer";
import { Toon, parseLook, parsePalette } from "../toonMaterial";
import { farStone } from "./farBoulders";
import { BUILDERS, Dressing, scatter } from "./index";

const mech = parseMechStats(mechJson);
const boulderIndices = (map: PlayMap) => map.boxes.map((_, i) => i).filter((i) => map.kindNames[map.kinds[i]!] === "boulder");

function setup(tier: string, seed: number) {
  const map = buildPlayMap(tier, seed, mech);
  const scene = new THREE.Scene();
  const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
  const meshes = new MapMeshes(scene, map, toon);
  const shownBoxes = new Set<number>();
  const original = meshes.setVisible.bind(meshes);
  meshes.setVisible = (i, visible) => { if (visible) shownBoxes.add(i); original(i, visible); };
  const dressing = new Dressing(scene, toon, map, meshes, BUILDERS, scatter, { radiusMeters: 120, chunkMeters: 50, scatterPerChunk: 0, buildAtOnce: 2 });
  return { map, dressing, meshes, shownBoxes };
}

describe("far boulders", () => {
  it("is a stone of a few dozen triangles filling a 1 m cube", () => {
    const stone = farStone();
    expect(stone.indices.length / 3).toBeLessThanOrEqual(80);
    for (let a = 0; a < 3; a++) {
      const values = stone.positions.filter((_, i) => i % 3 === a);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(Math.max(...values)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it("fills each boulder's box and stays inside it", () => {
    const { map, dressing } = setup("medium", 11);
    const stone = farStone();
    const mesh = dressing.far!.rocks.mesh;
    const matrix = new THREE.Matrix4(), p = new THREE.Vector3();
    const boulders = boulderIndices(map);
    expect(boulders.length).toBeGreaterThan(50);
    boulders.forEach((boxIndex, instance) => {
      const b = map.boxes[boxIndex]!;
      mesh.getMatrixAt(instance, matrix);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < stone.positions.length; i += 3) {
        p.set(stone.positions[i]!, stone.positions[i + 1]!, stone.positions[i + 2]!).applyMatrix4(matrix);
        p.toArray().forEach((v, a) => { min[a] = Math.min(min[a]!, v); max[a] = Math.max(max[a]!, v); });
      }
      const lo = [b.minX, b.minY, b.minZ], hi = [b.maxX, b.maxY, b.maxZ];
      for (let a = 0; a < 3; a++) {
        const size = hi[a]! - lo[a]!;
        expect(min[a]!).toBeGreaterThanOrEqual(lo[a]! - 0.01);
        expect(max[a]!).toBeLessThanOrEqual(hi[a]! + 0.01);
        expect(min[a]! - lo[a]!).toBeLessThan(size * 0.12);
        expect(hi[a]! - max[a]!).toBeLessThan(size * 0.12);
      }
    });
  });

  it("is turned by box index, so the field is not all alike", () => {
    const { map, dressing } = setup("medium", 11);
    const turns = new Set<string>();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), at = new THREE.Vector3(), size = new THREE.Vector3();
    boulderIndices(map).forEach((_, instance) => {
      dressing.far!.rocks.mesh.getMatrixAt(instance, m);
      m.decompose(at, q, size);
      turns.add(q.toArray().map((n) => n.toFixed(2)).join());
    });
    expect(turns.size).toBe(4);
  });

  for (const [tier, seed] of [["medium", 11], ["large", 2]] as const) {
    it(`covers exactly the boulders not dressed near you, as you move and jump (${tier} ${seed})`, () => {
      const { map, dressing, meshes, shownBoxes } = setup(tier, seed);
      const boulders = boulderIndices(map);
      const check = () => {
        let far = 0;
        for (const i of boulders) {
          expect(dressing.far!.shown(i)).toBe(!dressing.isDressed(i));
          if (dressing.far!.shown(i)) far++;
        }
        return far;
      };
      // Before the first update nothing is dressed, so every boulder is a far stone, and no boulder is ever a box.
      expect(check()).toBe(boulders.length);
      // Start beside a boulder, walk away from it a chunk at a time, then cut far across the map like a spectator.
      const b = map.boxes[boulders[0]!]!;
      const sx = (b.minX + b.maxX) / 2, sz = (b.minZ + b.maxZ) / 2;
      dressing.update(sx, sz);
      expect(check()).toBeLessThan(boulders.length);
      for (let step = 1; step <= 6; step++) dressing.update(sx + step * 30, sz + step * 20);
      check();
      for (let frame = 0; frame < 120; frame++) dressing.update(-sx, -sz);
      check();
      // The plain boxes of boulders never come back, and their colour (only boulders wear it) is not drawn at all.
      expect(boulders.filter((i) => shownBoxes.has(i))).toEqual([]);
      const boulderColour = meshes.group.children.filter((c) => (c as THREE.InstancedMesh).count === boulders.length);
      expect(boulderColour.length).toBe(2);
      for (const c of boulderColour) expect(c.visible).toBe(false);
    });
  }
});
