import * as THREE from "three";
import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { parseMechStats } from "@rustbucket/shared";
import { buildPlayMap, propConfig } from "./loadMap";
import { PropView, drawnFar } from "./propView";
import { PROP_MODELS } from "./props";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

function setup() {
  const map = buildPlayMap("medium", 5, parseMechStats(mechJson));
  const view = new PropView(map, propConfig, new Toon(parseLook(lookJson), parsePalette(paletteJson)), PROP_MODELS);
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 3000);
  return { map, view, camera };
}

// Props drawn this frame (or only those drawn one way: "standing prop", "far prop"). The meshes of one way of drawing
// a model share one instance buffer, so each buffer is counted once.
function drawn(view: PropView, name?: string): number {
  const counted = new Map<THREE.BufferAttribute, number>();
  for (const m of view.group.children as THREE.InstancedMesh[]) if (!name || m.name === name) counted.set(m.instanceMatrix, m.count);
  return [...counted.values()].reduce((a, b) => a + b, 0);
}

describe("far boxes", () => {
  const near = 140 ** 2, far = 150 ** 2;

  it("switches to the box past the far distance and back inside the near one", () => {
    expect(drawnFar(false, 100 ** 2, near, far)).toBe(false);
    expect(drawnFar(false, 151 ** 2, near, far)).toBe(true);
    expect(drawnFar(true, 139 ** 2, near, far)).toBe(false);
  });

  it("keeps whatever it was between the two, so the boundary does not flicker", () => {
    expect(drawnFar(false, 145 ** 2, near, far)).toBe(false);
    expect(drawnFar(true, 145 ** 2, near, far)).toBe(true);
  });
});

describe("prop view", () => {
  it("draws only the props in front of the camera", () => {
    const { map, view, camera } = setup();
    camera.position.set(0, 300, 0);
    camera.lookAt(0, 0, 0);
    view.cull(camera);
    const fromAbove = drawn(view);
    camera.position.set(0, 3, 0);
    camera.lookAt(10, 3, 0);
    view.cull(camera);
    const sideways = drawn(view);
    expect(map.props.length).toBeGreaterThan(100);
    expect(sideways).toBeGreaterThan(0);
    expect(sideways).toBeLessThan(fromAbove);
  });

  it("draws near props as models and far ones as boxes", () => {
    const { view, camera } = setup();
    // Low over the middle with the view cut off at 100 m: everything drawn is near.
    camera.far = 100;
    camera.updateProjectionMatrix();
    camera.position.set(0, 3, 0);
    camera.lookAt(10, 3, 0);
    view.cull(camera);
    expect(drawn(view, "standing prop")).toBeGreaterThan(0);
    expect(drawn(view, "far prop")).toBe(0);
    // High above the map: everything is far.
    camera.far = 3000;
    camera.updateProjectionMatrix();
    camera.position.set(0, 600, 0);
    camera.lookAt(0, 0, 0);
    view.cull(camera);
    expect(drawn(view, "standing prop")).toBe(0);
    expect(drawn(view, "far prop")).toBeGreaterThan(0);
  });

  it("shows a broken prop's debris in its place", () => {
    const { map, view, camera } = setup();
    const prop = map.props.find((p) => PROP_MODELS[propConfig.types[p.type]!.id])!;
    camera.position.set(prop.x, prop.y + 10, prop.z + 20);
    camera.lookAt(prop.x, prop.y, prop.z);
    view.cull(camera);
    const meshes = view.group.children as THREE.InstancedMesh[];
    const before = meshes.map((m) => m.count);
    view.destroy(prop.id);
    view.cull(camera);
    const after = meshes.map((m) => m.count);
    // Every standing mesh of that model lost one instance and every debris mesh gained one.
    expect(after.some((n, i) => n === before[i]! - 1)).toBe(true);
    expect(after.some((n, i) => n === before[i]! + 1)).toBe(true);
  });
});
