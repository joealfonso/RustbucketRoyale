import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import kitsJson from "../../../data/mechKits.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { STATES, parseKits, readKitState, type LoadedKit } from "./mechKit";
import { createMechModel, setMechDamage } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const kits = parseKits(kitsJson);
const standin = kits.kits.standin!;

// Loads the stand-in kit straight from the files in assets/, the way the browser does from the server.
async function loadStandin(): Promise<LoadedKit> {
  const loader = new GLTFLoader();
  const parts = await Promise.all(Object.entries(standin.parts).map(async ([name, p]) => ({
    name, zone: { legs: 0, arms: 1, torso: 2 }[p.zone]!, paint: p.paint,
    states: await Promise.all(STATES.map(async (state) => {
      const file = new URL(`../../../assets/${standin.folder}/Mech_${standin.name}_${name}_${state}.glb`, import.meta.url);
      const bytes = readFileSync(file);
      const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
      return readKitState(gltf.scene, file.pathname);
    })),
  })));
  return { parts, lodDistances: kits.lodDistances };
}

describe("mech kit", () => {
  it("loads every part in every state, with three levels of detail and its effect point", async () => {
    const kit = await loadStandin();
    expect(kit.parts).toHaveLength(Object.keys(standin.parts).length);
    for (const part of kit.parts) {
      expect(part.states).toHaveLength(3);
      for (const state of part.states) {
        expect(state.lods).toHaveLength(3);
        expect(state.fx).not.toBeNull();
      }
    }
    expect(kit.parts.find((p) => p.name === "Arm_R")!.states[0]!.mount).not.toBeNull();
  });

  it("builds a mech that shows each part in its zone's damage state", async () => {
    const kit = await loadStandin();
    const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
    const max = [60, 60, 100];
    const model = createMechModel("#ffffff", max, toon, "scrapSteel", kit);
    const shown = (zone: number) => model.kitParts.filter((p) => p.zone === zone).map((p) => p.states.findIndex((s) => s.visible));
    expect(shown(0)).toEqual([0, 0]);
    setMechDamage(model, [10, 0, 100], false);
    expect(shown(0)).toEqual([1, 1]); // legs damaged
    expect(shown(1)).toEqual([2, 2]); // arms broken
    expect(shown(2)).toEqual([0, 0, 0]); // torso, jets and sensor whole
    expect(model.gunParts.every((g) => !g.visible)).toBe(true); // no arm, no gun
    expect(model.fxAnchors.every((a) => a instanceof THREE.Object3D)).toBe(true);
  });

  it("refuses a kit naming a zone that does not exist", () => {
    const bad = { ...kitsJson, kits: { x: { folder: "f", name: "X", parts: { Tail: { zone: "tail", paint: "body" } } } } };
    expect(() => parseKits(bad)).toThrow(/tail/);
  });
});
