import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import kitsJson from "../../../data/mechKits.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { kitFromScene, parseKits } from "./mechKit";
import { createMechModel, setMechDamage } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const kits = parseKits(kitsJson);

async function loadRosterKit(id: string) {
  const bytes = readFileSync(new URL(`../../../assets/${kits.kits[id]!.file}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return kitFromScene(id, kits, gltf.scene);
}

describe("serial numbers", () => {
  // A roster mech still drawn as the stand-in (the Longshot until gate 15c builds its model) has no serial yet.
  for (const id of kits.roster!.filter((r) => !kits.kits[r]!.file?.includes("standin"))) {
    it(`${id}: every serial lies flat on the hull, facing out, with nothing of the mech in front of it`, async () => {
      const kit = await loadRosterKit(id);
      const wanted = kits.kits[id]!.serials ?? [];
      expect(wanted.length).toBeGreaterThan(0); // docs/MECH_ROSTER.md gives every roster mech one
      expect(kit.serials.map((s) => s.text)).toEqual(wanted.map((s) => s.text));
      const whole = new THREE.Group();
      for (const p of kit.parts) whole.add(new THREE.Mesh(p.states[0]!.lods[0]!, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
      whole.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      for (const s of kit.serials) {
        // Looking straight at the number's middle and the corners of its letters (which fill about the middle 80% of
        // the plane), from a metre out: the first thing hit is the surface it is painted on, just behind it.
        const out = new THREE.Vector3(0, 0, 1).applyQuaternion(s.turn);
        const size = s.geometry.parameters;
        for (const [u, v] of [[0, 0], [0.36, 0.36], [-0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]] as const) {
          const spot = new THREE.Vector3(u * size.width, v * size.height, 0).applyQuaternion(s.turn).add(s.point);
          raycaster.set(spot.clone().addScaledVector(out, 1), out.clone().negate());
          const first = raycaster.intersectObject(whole, true)[0];
          expect(first, `${id} ${s.text}: nothing behind its corner ${u}, ${v}`).toBeDefined();
          expect(first!.distance, `${id} ${s.text}: something covers its corner ${u}, ${v}`).toBeGreaterThan(0.99);
          expect(first!.distance, `${id} ${s.text}: floats off the hull at its corner ${u}, ${v}`).toBeLessThan(1.08);
        }
      }
    });
  }

  it("go with their zone: a leg number with the legs, while the chest number stays and rusts", async () => {
    // Just enough of a page for the serial's canvas, which these tests never look at.
    const context = new Proxy({}, { get: () => () => {} });
    (globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
    const kit = await loadRosterKit("ironclad");
    const model = createMechModel("#ffffff", [60, 60, 100], new Toon(parseLook(lookJson), parsePalette(paletteJson)), "scrapSteel", kit);
    const [chest, leg] = model.serials;
    expect([chest!.zone, leg!.zone]).toEqual([2, 0]);
    const chestPaint = model.paints.find((p) => p.material.map && p.zone === 2)!.material;
    setMechDamage(model, [0, 60, 30], false);
    expect(leg!.object.visible).toBe(false);
    expect(chest!.object.visible).toBe(true);
    expect((chestPaint.userData.rustCover as { value: number }).value).toBeGreaterThan(0);
  });
});
