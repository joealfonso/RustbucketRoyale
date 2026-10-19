import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import kitsJson from "../../../data/mechKits.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { STATES, parseKits, readOneFileStates, readPartFile, type LoadedKit } from "./mechKit";
import { createMechModel, setMechDamage } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const kits = parseKits(kitsJson);
const standin = kits.kits.standin!;

// Loads the stand-in kit straight from the files in assets/, the way the browser does from the server.
async function loadStandin(): Promise<LoadedKit> {
  const loader = new GLTFLoader();
  const parts = await Promise.all(Object.entries(standin.parts).map(async ([name, p]) => ({
    name, zone: { legs: 0, arms: 1, torso: 2 }[p.zone]!, paint: p.paint, color: null, glow: false, rusts: p.paint !== "trim" && p.paint !== "weapon",
    states: await Promise.all(STATES.map(async (state) => {
      const file = new URL(`../../../assets/${standin.folder}/Mech_${standin.name}_${name}_${state}.glb`, import.meta.url);
      const bytes = readFileSync(file);
      const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
      return readPartFile(gltf.scene);
    })),
  })));
  return { id: "test", parts, lodDistances: kits.lodDistances, legs: [] };
}

describe("mech kit", () => {
  it("loads every part in every state, with three levels of detail and its effect point", async () => {
    const kit = await loadStandin();
    expect(kit.parts).toHaveLength(Object.keys(standin.parts).length);
    for (const part of kit.parts) {
      expect(part.states).toHaveLength(3);
      for (const state of part.states) {
        expect(state!.lods).toHaveLength(3);
        expect(state!.fx).not.toBeNull();
      }
    }
    expect(kit.parts.find((p) => p.name === "Arm_R")!.states[0]!.mount).not.toBeNull();
  });

  it("builds a mech that shows each part in its zone's damage state", async () => {
    const kit = await loadStandin();
    const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
    const max = [60, 60, 100];
    const model = createMechModel("#ffffff", max, toon, "scrapSteel", kit);
    const shown = (zone: number) => model.kitParts.filter((p) => p.zone === zone).map((p) => p.states.findIndex((s) => s?.[0]?.visible));
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

  it("reads a whole mech from one file, placing each part by its object's position", async () => {
    const bytes = readFileSync(new URL(`../../../assets/${kits.kits["standin-one"]!.file}`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const legL = readOneFileStates(gltf.scene, "Leg_L");
    expect(legL[0]!.lods).toHaveLength(1);
    expect(legL[1]).toBeNull(); // no damaged version in this file
    expect(legL[2]).toBeNull();
    // The part is stored centred and moved into place by its node: the loaded geometry must sit at the hip, not at 0.
    legL[0]!.lods[0]!.computeBoundingBox();
    const box = legL[0]!.lods[0]!.boundingBox!;
    expect(box.min.x).toBeCloseTo(-0.9, 3);
    expect(box.max.y).toBeCloseTo(1.6, 3);
    expect(readOneFileStates(gltf.scene, "Arm_R")[0]!.mount).not.toBeNull();
  });

  it("without damaged or broken versions, keeps a damaged part as it is and takes a broken one away", async () => {
    const bytes = readFileSync(new URL(`../../../assets/${kits.kits["standin-one"]!.file}`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const parts = Object.entries(kits.kits["standin-one"]!.parts).map(([name, p]) => ({
      name, zone: { legs: 0, arms: 1, torso: 2 }[p.zone]!, paint: p.paint, color: null, glow: false, rusts: p.paint !== "trim" && p.paint !== "weapon", states: readOneFileStates(gltf.scene, name),
    }));
    const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
    const model = createMechModel("#ffffff", [60, 60, 100], toon, "scrapSteel", { id: "test", parts, lodDistances: kits.lodDistances, legs: [] });
    const legsShown = () => model.kitParts.filter((p) => p.zone === 0).map((p) => p.states[0]![0]!.visible);
    setMechDamage(model, [10, 60, 100], false);
    expect(legsShown()).toEqual([true, true]); // damaged: still there
    setMechDamage(model, [0, 60, 100], false);
    expect(legsShown()).toEqual([false, false]); // broken: gone, the mech crawls
  });
});

