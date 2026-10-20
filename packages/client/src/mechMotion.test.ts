import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import kitsJson from "../../../data/mechKits.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { checkMotion, type MotionPiece } from "./kitMotion";
import { kitFromScene, parseKits } from "./mechKit";
import { createMechModel, type MechModel } from "./mechModel";
import { moveMechParts, rigMechMotion, swayConfig } from "./mechMotion";
import { aimEnd } from "./pistons";
import { createSwayState, stepSway } from "./sway";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const kits = parseKits(kitsJson);
const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));

async function rosterModel(id: string): Promise<MechModel> {
  const bytes = readFileSync(new URL(`../../../assets/${kits.kits[id]!.file}`, import.meta.url));
  const scene = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
  const model = createMechModel("#ffffff", [60, 60, 100], toon, "scrapSteel", kitFromScene(id, kits, scene));
  rigMechMotion(model.body, model.legs, model.kitPieces); // until createMechModel makes the call itself
  return model;
}

// The moving pieces of a model and what each is, from the tag mechMerge.ts puts on their geometry.
function moving(model: MechModel): { piece: MotionPiece; lod: THREE.LOD }[] {
  const out: { piece: MotionPiece; lod: THREE.LOD }[] = [];
  for (const { object } of model.kitPieces) {
    const lod = object as THREE.LOD;
    const mesh = lod.levels[0]!.object.children[0] as THREE.Mesh | undefined;
    const piece = mesh?.geometry.userData.motion as MotionPiece | undefined;
    if (piece) out.push({ piece, lod });
  }
  return out;
}

describe("kit motion data", () => {
  const good = { name: "Ram", parts: ["Leg"], path: [[0, 1, 0], [0, 0.5, 0]], radius: 0.1, piston: ["thigh_R", "shin_R"] };
  it("accepts a piston and a sway, and refuses what it cannot use", () => {
    expect(() => checkMotion("k", [good, { name: "Mast", parts: ["Leg"], path: [[0, 3, 0], [0, 4, 0]], radius: 0.2, sway: "mast", bone: "body" }], ["Leg"])).not.toThrow();
    expect(() => checkMotion("k", [{ ...good, parts: ["Arm"] }], ["Leg"])).toThrow(/parts/);
    expect(() => checkMotion("k", [{ ...good, piston: ["thigh_R", "elbow_R"] }], ["Leg"])).toThrow(/bones/);
    expect(() => checkMotion("k", [{ ...good, sway: "mast" }], ["Leg"])).toThrow(/either/);
    expect(() => checkMotion("k", [good, good], ["Leg"])).toThrow(/name/);
    expect(() => checkMotion("k", [{ ...good, split: 1.2 }], ["Leg"])).toThrow(/split/);
  });

  it.each(kits.roster!)("lifts both ends of every piston and every swaying part of %s", async (id) => {
    const model = await rosterModel(id);
    const ends = new Set(moving(model).map(({ piece }) => `${piece.motion.name} ${piece.end}`));
    for (const m of kits.kits[id]!.motion ?? []) {
      expect(ends, m.name).toContain(`${m.name} 0`);
      if (m.piston) expect(ends, m.name).toContain(`${m.name} 1`);
    }
  });
});

describe("pistons", () => {
  it("aims an end from its mount at the other's", () => {
    const q = aimEnd(new THREE.Quaternion(), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 1, 0));
    expect(new THREE.Vector3(0, -1, 0).applyQuaternion(q).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-9);
  });

  it.each(kits.roster!)("keeps %s's sleeves and rods on one line between their mounts as the legs bend", async (id) => {
    const model = await rosterModel(id);
    for (const leg of model.legs) { leg.hip.rotation.x = 0.5; leg.knee.rotation.x = -0.9; leg.ankle.rotation.x = 0.4; }
    moveMechParts(model, 1 / 60);
    model.group.updateMatrixWorld(true);
    const ends = moving(model).filter(({ piece }) => piece.motion.kind === "piston");
    expect(ends.length).toBeGreaterThan(0);
    // Each mount where its bone has carried it, and the far mount as each end now points at it.
    const world = (lod: THREE.LOD, p: THREE.Vector3) => p.clone().applyMatrix4(lod.matrixWorld);
    for (const { piece, lod } of ends) {
      const other = ends.find((e) => e.piece.motion.name === piece.motion.name && e.piece.end !== piece.end)!;
      const here = world(lod, piece.motion.points[piece.end]!), there = world(other.lod, piece.motion.points[1 - piece.end]!);
      const aimed = world(lod, piece.motion.points[1 - piece.end]!);
      // The end's own far point lies on the line from its mount to the other mount: the two halves stay in line.
      const dir = there.clone().sub(here).normalize();
      const off = aimed.clone().sub(here);
      expect(off.sub(dir.multiplyScalar(off.dot(dir))).length(), piece.motion.name).toBeLessThan(1e-4);
    }
  });

  it("leaves a blown-apart wreck's pistons as they were", async () => {
    const model = await rosterModel("ironclad");
    const end = moving(model)[0]!.lod.parent!;
    model.legs[0]!.knee.rotation.x = -0.8;
    model.legs[1]!.knee.rotation.x = -0.8;
    moveMechParts(model, 1 / 60);
    const before = end.quaternion.clone();
    model.blownApart = true;
    model.legs[0]!.knee.rotation.x = 0; model.legs[1]!.knee.rotation.x = 0;
    moveMechParts(model, 1 / 60);
    expect(end.quaternion.equals(before)).toBe(true);
  });
});

describe("sway", () => {
  it("rings down and settles back to rest, never past its largest bend", () => {
    const profile = swayConfig.profiles.mast!;
    const s = createSwayState();
    s.spin[0] = 3;
    let most = 0;
    for (let i = 0; i < 600; i++) { stepSway(s, profile, 1 / 60, swayConfig.stepSeconds); most = Math.max(most, Math.hypot(...s.angle)); }
    expect(most).toBeLessThanOrEqual((profile.maxDegrees * Math.PI) / 180 + 1e-9);
    expect(Math.hypot(...s.angle)).toBeLessThan(1e-4);
  });

  it("stays steady on a slow frame", () => {
    const profile = swayConfig.profiles.drone!;
    const s = createSwayState();
    s.angle[2] = 0.05;
    stepSway(s, profile, 0.5, swayConfig.stepSeconds);
    expect(Number.isFinite(s.angle[2]!)).toBe(true);
    expect(Math.abs(s.angle[2]!)).toBeLessThanOrEqual(0.05);
  });

  it("swings the Arbiter's mast and drones when it sets off, and stills them when it is knocked out", async () => {
    const model = await rosterModel("arbiter");
    const swayers = moving(model).filter(({ piece }) => piece.motion.kind !== "piston").map(({ lod }) => lod.parent!);
    expect(swayers).toHaveLength(5);
    for (let i = 0; i < 4; i++) moveMechParts(model, 1 / 60); // standing: nothing to lag behind
    expect(swayers.every((p) => p.quaternion.angleTo(new THREE.Quaternion()) < 1e-9)).toBe(true);
    for (let i = 0; i < 20; i++) { model.group.position.z -= (i * 0.4) / 60; moveMechParts(model, 1 / 60); }
    expect(swayers.every((p) => p.quaternion.angleTo(new THREE.Quaternion()) > 1e-3)).toBe(true);
    model.dead = true;
    moveMechParts(model, 1 / 60);
    expect(swayers.every((p) => p.quaternion.angleTo(new THREE.Quaternion()) < 1e-9)).toBe(true);
  });
});
