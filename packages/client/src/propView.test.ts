import * as THREE from "three";
import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { parseMechStats } from "@rustbucket/shared";
import { buildPlayMap, propConfig } from "./loadMap";
import { PropView } from "./propView";
import { PROP_MODELS } from "./props";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

function setup() {
  const map = buildPlayMap("medium", 5, parseMechStats(mechJson));
  const view = new PropView(map, propConfig, new Toon(parseLook(lookJson), parsePalette(paletteJson)), PROP_MODELS);
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 3000);
  return { map, view, camera };
}

// Instances drawn this frame, summed over every prop mesh.
const drawn = (view: PropView) => view.group.children.reduce((n, m) => n + (m as THREE.InstancedMesh).count, 0);

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
