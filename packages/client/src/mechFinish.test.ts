import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import kitsJson from "../../../data/mechKits.json";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { writeGlb } from "../../../scripts/assets/glbWrite";
import { box, merge } from "./dressing/shapes";
import { parseKits, readOneFileStates, setFinish } from "./mechKit";
import { addOutlineNormals } from "./outlineNormals";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import type { ShaderParts } from "./paint/paintChunk";

// Gate V9: the roster's shading normals, edge wear and finishes, from the model script's .glb to the toon material.

const look = parseLook(lookJson);
const toon = new Toon(look, parsePalette(paletteJson));
// Two chamfered plates, one on the other, as a mech script would build a part.
const part = merge(box([0, 1, 0], [1.2, 0.8, 0.6], 0.04), box([0, 1.6, 0], [0.8, 0.3, 0.5], 0.03));

async function load(hard: boolean): Promise<THREE.BufferGeometry> {
  const bytes = writeGlb([{ name: "Torso", mesh: part }], { quantize: true, ...(hard ? {} : { hardSurface: false }) });
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "");
  return readOneFileStates(gltf.scene, "Torso")[0]!.lods[0]!;
}

describe("mech surfaces", () => {
  it("loads the model's edge wear into each corner's finish, and the part's finish beside it", async () => {
    const g = await load(true);
    const finish = g.attributes.finish!;
    const wear = new Set<number>();
    for (let i = 0; i < finish.count; i++) wear.add(finish.getX(i));
    expect([...wear].sort()).toEqual([0, 1]); // big faces clean, chamfers marked
    const state = { lods: [g], fx: null, mount: null };
    setFinish(state, "rubber");
    expect(finish.getY(0)).toBe(2);
    setFinish(state, undefined);
    expect(finish.getY(0)).toBe(0); // paint, the default
  });

  it("bends the shading normals over the chamfers but keeps the outline shell exactly where flat normals put it", async () => {
    const [hard, flat] = await Promise.all([load(true), load(false)]);
    let bent = 0, worst = 0;
    const n = hard.attributes.normal!, m = flat.attributes.normal!;
    const a = hard.attributes.outlineNormal!, b = flat.attributes.outlineNormal!;
    for (let i = 0; i < n.count; i++) {
      if (Math.abs(n.getX(i) - m.getX(i)) + Math.abs(n.getY(i) - m.getY(i)) + Math.abs(n.getZ(i) - m.getZ(i)) > 0.05) bent++;
      worst = Math.max(worst, Math.abs(a.getX(i) - b.getX(i)), Math.abs(a.getY(i) - b.getY(i)), Math.abs(a.getZ(i) - b.getZ(i)));
    }
    expect(bent).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.02); // the flat file's outline comes from 8-bit normals, so only that rounding differs
    // And on flat normals, outlines from the faces are the outlines from the normals.
    const again = addOutlineNormals(flat.clone(), true).attributes.outlineNormal!;
    for (let i = 0; i < again.count; i++) expect(Math.abs(again.getY(i) - b.getY(i))).toBeLessThan(0.02);
  });

  it("refuses a part with a finish it does not know", () => {
    const bad = JSON.parse(JSON.stringify(kitsJson));
    const kit = Object.values(bad.kits as Record<string, { parts: Record<string, { finish?: string }> }>)[0]!;
    Object.values(kit.parts)[0]!.finish = "chrome";
    expect(() => parseKits(bad)).toThrow(/chrome/);
  });

  it("gives kit materials the chips, the glint and the flat rubber, and leaves other materials alone", () => {
    const toonLib = THREE.ShaderLib.toon!;
    const patched = (m: THREE.Material): ShaderParts => {
      const shader = { vertexShader: toonLib.vertexShader, fragmentShader: toonLib.fragmentShader, uniforms: {} };
      m.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      return shader;
    };
    const kitPaint = toon.ownMaterial("#ffffff", true, "mech", true);
    const shader = patched(kitPaint);
    expect(shader.vertexShader).toContain("attribute vec2 finish;");
    for (const line of ["wearColor", "toonGlint * glintColor", "toonFlatten = toonRubber", "(1.0 - toonRubber)", "vFinish.x * "]) expect(shader.fragmentShader).toContain(line);
    // Chips first, then rust over them.
    expect(shader.fragmentShader.indexOf("wearColor;")).toBeLessThan(shader.fragmentShader.indexOf("rustDark : rustColor"));
    expect(kitPaint.customProgramCacheKey()).toContain("finish");
    const plain = patched(toon.ownMaterial("#ffffff", true, "mech"));
    expect(plain.vertexShader).not.toContain("finish");
    expect(THREE.ShaderChunk.lights_toon_pars_fragment).toContain("toonGlint");
  });
});
