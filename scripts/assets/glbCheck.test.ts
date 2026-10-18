import { describe, expect, it } from "vitest";
import rulesJson from "../../data/assetRules.json";
import { checkModel, countTriangles, readGltfJson, type AssetRules, type GltfJson } from "./glbCheck";

const rules = rulesJson as AssetRules;

// A model with one triangle list of `triangles` triangles in the given material.
const model = (triangles: number, material = "MasterToon"): GltfJson => ({
  meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1 }, material: 0 }] }],
  accessors: [{ count: triangles * 3 }, { count: triangles * 2 }],
  materials: [{ name: material }],
});

// Packs glTF JSON into a .glb: the 12 byte header, then the JSON chunk padded to four bytes.
function glb(json: GltfJson): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += " ";
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
  v.setUint32(12, body.length, true); v.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

describe("asset checker", () => {
  it("reads a .glb and counts its triangles", () => {
    expect(countTriangles(readGltfJson(glb(model(1200))))).toBe(1200);
  });

  it("passes a model that follows the rules", () => {
    expect(checkModel("Mech_Leg_L_Intact", model(4000), rules).problems).toEqual([]);
    expect(checkModel("Prop_Barrel_Destroyed", model(800), rules).problems).toEqual([]);
  });

  it("fails one over budget, badly named, missing its state, or with its own material", () => {
    expect(checkModel("Mech_Torso_Intact", model(12000), rules).problems.join()).toMatch(/over the 10000 budget/);
    expect(checkModel("mech_torso_intact", model(100), rules).problems.length).toBeGreaterThan(0);
    expect(checkModel("Prop_Barrel", model(800), rules).problems.join()).toMatch(/must end with its state/);
    expect(checkModel("Prop_Barrel_Intact", model(800, "Rusty_PBR"), rules).problems.join()).toMatch(/Rusty_PBR/);
  });

  it("only notes a prop under the usual minimum", () => {
    const r = checkModel("Prop_Crate_Intact", model(12), rules);
    expect(r.problems).toEqual([]);
    expect(r.warnings.join()).toMatch(/under the usual 300/);
  });
});
