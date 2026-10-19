import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Terrain } from "@rustbucket/shared";
import groundJson from "../../../data/ground.json";
import { parseTerrainMeshLook, planTerrainNodes, selectTerrainNodes, terrainGeometry, type TerrainNode } from "./terrainMesh";

// A small seeded generator, so a failure replays the same hills.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Bumpy hills: every corner a random height within ±3 m, in whole centimetres like the real ones.
function bumpy(cells: number, cell: number, seed: number): Terrain {
  const r = rng(seed);
  const n = cells + 1;
  const heights = new Int32Array(n * n);
  for (let i = 0; i < heights.length; i++) heights[i] = Math.round((r() - 0.5) * 600);
  return new Terrain(cells * cell, cell, heights, 0.5);
}

function leaves(node: TerrainNode, out: TerrainNode[] = []): TerrainNode[] {
  if (node.children.length === 0) out.push(node);
  for (const child of node.children) leaves(child, out);
  return out;
}

// How many times each cell is covered by the given nodes.
function coverage(nodes: TerrainNode[], cells: number): Int32Array {
  const covered = new Int32Array(cells * cells);
  for (const node of nodes) for (let j = node.j0; j < node.j1; j++) for (let i = node.i0; i < node.i1; i++) covered[j * cells + i]!++;
  return covered;
}

const look = parseTerrainMeshLook(groundJson.mesh);

describe("terrain mesh", () => {
  it("at full detail, matches Terrain.heightAt everywhere, with the same triangle split", () => {
    const terrain = bumpy(20, 4, 7);
    const geometry = terrainGeometry(terrain, { i0: 0, j0: 0, i1: 20, j1: 20, stride: 1 }, false);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const caster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    const r = rng(99);
    const problems: string[] = [];
    for (let k = 0; k < 2000; k++) {
      const x = (r() - 0.5) * 79.9, z = (r() - 0.5) * 79.9;
      // From above, so only faces that point up are hit: this checks the winding too.
      caster.set(from.set(x, 100, z), down);
      const hit = caster.intersectObject(mesh)[0];
      const expected = terrain.heightAt(x, z);
      if (!hit) problems.push(`no ground under ${x}, ${z}`);
      else if (Math.abs(hit.point.y - expected) > 1e-3) problems.push(`at ${x.toFixed(2)}, ${z.toFixed(2)}: drawn ${hit.point.y.toFixed(3)}, walked ${expected.toFixed(3)}`);
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("tiles the map once over, including a part tile at the far edge", () => {
    for (const cells of [75, 250, 500]) {
      const root = planTerrainNodes(cells, 32);
      const covered = coverage(leaves(root), cells);
      expect(covered.every((c) => c === 1)).toBe(true);
      for (const leaf of leaves(root)) expect(leaf.stride).toBe(1);
    }
  });

  it("from any camera, draws tiles that cover the map once, fine near the camera and coarse far off", () => {
    const terrain = Terrain.flat(2000, 4);
    const root = planTerrainNodes(500, 32);
    for (const [x, y, z] of [[0, 2, 0], [-990, 5, -990], [700, 40, -300], [0, 1500, 1]]) {
      const drawn: TerrainNode[] = [];
      selectTerrainNodes(root, terrain, x!, y!, z!, 200, 8, (node) => drawn.push(node));
      expect(coverage(drawn, 500).every((c) => c === 1)).toBe(true);
      for (const node of drawn) expect(node.stride).toBeLessThanOrEqual(8);
      if (y! < 100) {
        // The tile under the camera is full detail.
        const i = Math.floor((x! + 1000) / 4), j = Math.floor((z! + 1000) / 4);
        const under = drawn.find((n) => i >= n.i0 && i < n.i1 && j >= n.j0 && j < n.j1)!;
        expect(under.stride).toBe(1);
        expect(drawn.some((n) => n.stride > 1)).toBe(true);
      }
    }
  });

  it("draws every tile at full detail when the coarsest step is 1", () => {
    const terrain = Terrain.flat(1000, 4);
    const root = planTerrainNodes(250, 32);
    const drawn: TerrainNode[] = [];
    selectTerrainNodes(root, terrain, 0, 1000, 0, 200, 1, (node) => drawn.push(node));
    expect(drawn.every((n) => n.stride === 1)).toBe(true);
    expect(coverage(drawn, 250).every((c) => c === 1)).toBe(true);
  });

  it("hangs skirts on the inner sides of a coarse tile, deep enough to close any gap, but not on the map's edge", () => {
    const terrain = bumpy(64, 4, 3);
    const corner = terrainGeometry(terrain, { i0: 0, j0: 0, i1: 32, j1: 32, stride: 2 }, true);
    const plain = terrainGeometry(terrain, { i0: 0, j0: 0, i1: 32, j1: 32, stride: 2 }, false);
    const top = 17 * 17;
    expect(plain.getAttribute("position").count).toBe(top);
    // A corner tile touches the map's edge on two sides, so it has skirts on the other two.
    expect(corner.getAttribute("position").count).toBe(top + 17 * 2);
    // Every skirt reaches below the lowest corner on the map, so it closes a gap of any depth.
    const y = corner.getAttribute("position");
    for (let v = top; v < y.count; v++) expect(y.getY(v)).toBeLessThan(terrain.minHeight - 0.99);
    const middle = terrainGeometry(terrain, { i0: 16, j0: 16, i1: 48, j1: 48, stride: 2 }, true);
    expect(middle.getAttribute("position").count).toBe(top + 17 * 4);
  });

  it("checks its settings on load", () => {
    expect(look.tileMeters).toBeGreaterThan(0);
    expect(() => parseTerrainMeshLook({ ...groundJson.mesh, lod: { ...groundJson.mesh.lod, maxStride: 3 } })).toThrow(/power of two/);
    expect(() => parseTerrainMeshLook({ tileMeters: 64 })).toThrow();
  });
});
