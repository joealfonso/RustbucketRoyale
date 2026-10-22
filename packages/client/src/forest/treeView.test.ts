import * as THREE from "three";
import { describe, expect, it } from "vitest";
import mechJson from "../../../../data/mech.json";
import paletteJson from "../../../../data/palette.json";
import lookJson from "../../../../data/look.json";
import forestJson from "../../../../data/forest.json";
import { parseMechStats } from "@rustbucket/shared";
import { buildPlayMap, propConfig } from "../loadMap";
import { PropView } from "../propView";
import { PROP_MODELS } from "../props";
import { Toon, parseLook, parsePalette } from "../toonMaterial";
import { parseForest } from "./config";
import { TreeView } from "./treeView";

const forest = parseForest(forestJson);
const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
const map = buildPlayMap("medium", 11, parseMechStats(mechJson));
const pine = propConfig.types.findIndex((t) => t.id === "pine");
const trees = map.props.filter((p) => p.type === pine);

// Trees drawn this frame by one kind of mesh ("pine", "far pine", "pine stump", "falling pine"). The meshes of one way
// of drawing share one instance buffer, so each buffer is counted once.
function drawn(view: TreeView, name: string): number {
  const counted = new Map<THREE.BufferAttribute, number>();
  for (const m of view.group.children as THREE.InstancedMesh[]) if (m.name === name) counted.set(m.instanceMatrix, m.count);
  return [...counted.values()].reduce((a, b) => a + b, 0);
}

function lookingAt(x: number, y: number, z: number, from: [number, number, number], far = 3000): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, far);
  camera.position.set(...from);
  camera.lookAt(x, y, z);
  return camera;
}

describe("tree view", () => {
  it("draws the woods of a medium map, and the props view leaves them to it", () => {
    expect(trees.length).toBeGreaterThan(300); // medium is an island, about two thirds land
    const props = new PropView(map, propConfig, toon, PROP_MODELS);
    const meshes = props.group.children as THREE.InstancedMesh[];
    expect(meshes.every((m) => m.count <= map.props.length - trees.length)).toBe(true);
  });

  it("draws near trees as models and far ones as spires", () => {
    const view = new TreeView(map, propConfig, toon, forest);
    const t = trees[0]!;
    view.cull(lookingAt(t.x, t.y, t.z, [t.x - 30, t.y, t.z], 100), t.x - 25, t.y, t.z);
    expect(drawn(view, "pine")).toBeGreaterThan(0);
    expect(drawn(view, "far pine")).toBe(0);
    view.cull(lookingAt(0, 0, 0, [0, 900, 1]), 0, 0, 0);
    expect(drawn(view, "pine")).toBe(0);
    expect(drawn(view, "far pine")).toBe(trees.length);
  });

  it("knocks a tree down to a stump, lands it once and lets it go", () => {
    const view = new TreeView(map, propConfig, toon, forest);
    const t = trees[0]!;
    const camera = lookingAt(t.x, t.y, t.z, [t.x - 30, t.y, t.z]);
    let landed = 0;
    view.onLand = () => landed++;
    expect(view.has(t.id)).toBe(true);
    view.fell(t.id, 0);
    view.cull(camera, t.x - 25, t.y, t.z);
    expect(drawn(view, "pine stump")).toBe(1);
    const step = 1 / 30, f = forest.fall;
    for (let s = 0; s < (f.seconds + f.bounceSeconds) / step; s++) view.update(step);
    expect(drawn(view, "falling pine")).toBe(1);
    expect(landed).toBe(1);
    for (let s = 0; s < (f.lieSeconds + f.sinkSeconds + 1) / step; s++) view.update(step);
    expect(drawn(view, "falling pine")).toBe(0);
    expect(landed).toBe(1);
    view.cull(camera, t.x - 25, t.y, t.z);
    expect(drawn(view, "pine stump")).toBe(1);
  });

  it("leaves just the stump of a tree that fell before you came", () => {
    const view = new TreeView(map, propConfig, toon, forest);
    const t = trees[1]!;
    view.fell(t.id, Number.NaN, true);
    view.update(0.1);
    expect(drawn(view, "falling pine")).toBe(0);
  });

  it("falls the way it was pushed", () => {
    const view = new TreeView(map, propConfig, toon, forest);
    const t = trees[2]!;
    view.fell(t.id, 0); // toward +x
    for (let s = 0; s < 60; s++) view.update(1 / 30);
    const mesh = (view.group.children as THREE.InstancedMesh[]).find((m) => m.name === "falling pine" && m.count > 0)!;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    // The trunk's own up now points mostly along +x.
    const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
    expect(up.x).toBeGreaterThan(0.8);
  });
});
