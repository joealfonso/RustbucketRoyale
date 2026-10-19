import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import kitsJson from "../../../data/mechKits.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { kitFromScene, parseKits } from "./mechKit";
import { createMechModel } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const kits = parseKits(kitsJson);

// A roster kit straight from its file in assets/, the way the browser loads it.
async function rosterKit(id: string) {
  const bytes = readFileSync(new URL(`../../../assets/${kits.kits[id]!.file}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return kitFromScene(id, kits, gltf.scene);
}
const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position!.count) / 3;

describe("leg rig", () => {
  it.each(kits.roster!)("finds %s's leg joints and cuts its legs without losing a triangle", async (id) => {
    const kit = await rosterKit(id);
    expect(kit.legs.length).toBe(id === "cataclysm" ? 4 : 2);
    for (const part of kit.parts.filter((p) => p.zone === 0)) {
      const intact = part.states[0]!;
      expect(intact.pieces, part.name).toBeDefined();
      const cut = intact.pieces!.reduce((n, p) => n + triangles(p.lods[0]!), 0);
      expect(cut, part.name).toBe(triangles(intact.lods[0]!));
    }
    // Each leg ends up with a thigh, a shin and a foot of its own.
    const pieces = new Set(kit.parts.flatMap((p) => p.states[0]!.pieces?.map((x) => x.piece) ?? []));
    expect(pieces.size).toBe(kit.legs.length * 3);
  });

  it("hangs every leg piece on a joint, so it sits where it was modelled while standing", async () => {
    const kit = await rosterKit("ironclad");
    const model = createMechModel("#ffffff", [60, 60, 100], new Toon(parseLook(lookJson), parsePalette(paletteJson)), "scrapSteel", kit);
    expect(model.legs).toHaveLength(2);
    model.group.updateMatrixWorld(true);
    // At rest a hung piece's world matrix is plain: no turn and no offset left over from the joints.
    for (const leg of model.legs) {
      for (const joint of [leg.hip, leg.knee, leg.ankle]) {
        for (const lod of joint.children.filter((c) => c instanceof THREE.LOD)) {
          const e = lod.matrixWorld.elements;
          expect(Math.hypot(e[12]!, e[13]!, e[14]!)).toBeLessThan(1e-6);
        }
      }
    }
  });
});
