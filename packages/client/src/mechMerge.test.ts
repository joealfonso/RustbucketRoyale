import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import kitsJson from "../../../data/mechKits.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import abilityFxJson from "../../../data/abilityFx.json";
import { parseAbilityFx } from "./abilityFx";
import { makeGhost } from "./ghostLook";
import { STATES, kitFromScene, parseKits, readPartFile, type LoadedKit } from "./mechKit";
import { mergedPieces } from "./mechMerge";
import { createMechModel, setMechDamage, type MechModel } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const kits = parseKits(kitsJson);
const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
const max = [60, 60, 100];

const parse = async (path: string) => {
  const bytes = readFileSync(new URL(`../../../assets/${path}`, import.meta.url));
  return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
};
const rosterKit = async (id: string) => kitFromScene(id, kits, await parse(kits.kits[id]!.file!));
// The stand-in has every damage state and three levels of detail, which the roster models do not.
async function standinKit(): Promise<LoadedKit> {
  const k = kits.kits.standin!;
  const parts = await Promise.all(Object.entries(k.parts).map(async ([name, p]) => ({
    name, zone: { legs: 0, arms: 1, torso: 2 }[p.zone]!, paint: p.paint, color: null, glow: false, rusts: p.paint !== "trim" && p.paint !== "weapon",
    states: await Promise.all(STATES.map(async (state) => readPartFile(await parse(`${k.folder}/Mech_${k.name}_${name}_${state}.glb`)))),
  })));
  return { id: "standin", parts, lodDistances: kits.lodDistances, legs: [] };
}

const triangles = (g: THREE.BufferGeometry | null | undefined) => (!g ? 0 : (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3);
// Triangles a part shows at a level of detail in one state, cut into leg pieces or not.
const partTriangles = (kit: LoadedKit, part: LoadedKit["parts"][number], state: number, level: number) => {
  const s = part.states[state];
  if (!s) return 0;
  const at = (lods: THREE.BufferGeometry[]) => triangles(lods[Math.min(level, lods.length - 1)]);
  return s.pieces && kit.legs.length > 0 ? s.pieces.reduce((n, p) => n + at(p.lods), 0) : at(s.lods);
};
// What setMechDamage shows for a part: its own damaged version, or the intact one when it has none.
const shownState = (part: LoadedKit["parts"][number], state: number) => (state === 1 && !part.states[1] ? 0 : state);
// Triangles drawn for one zone at the nearest level: every visible mesh under a visible piece, fills only.
function drawnTriangles(model: MechModel, zone: number): number {
  let n = 0;
  for (const piece of model.kitPieces) {
    if (piece.zone !== zone || !piece.object.visible) continue;
    piece.object.levels[0]!.object.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.Material).side !== THREE.BackSide) n += triangles(o.geometry);
    });
  }
  return n;
}

describe("merged mech parts", () => {
  it.each([...kits.roster!, "standin"])("keeps every triangle of %s, fills and outlines, at every level of detail", async (id) => {
    const kit = id === "standin" ? await standinKit() : await rosterKit(id);
    const pieces = mergedPieces(kit, toon, "paintWhite", "frameNavy");
    for (let level = 0; level < 3; level++) {
      const expected = kit.parts.reduce((n, part) => n + [0, 1, 2].reduce((m, s) => m + partTriangles(kit, part, s, level), 0), 0);
      const fills = pieces.reduce((n, p) => n + p.fills.reduce((m, f) => m + triangles(f.lods[Math.min(level, f.lods.length - 1)]), 0), 0);
      const outlines = pieces.reduce((n, p) => n + p.outlines.reduce((m, f) => m + triangles(f.lods[Math.min(level, f.lods.length - 1)]), 0), 0);
      expect(fills, `level ${level}`).toBe(expected);
      expect(outlines, `level ${level}`).toBe(expected);
    }
    // The point of it: far fewer meshes than a mesh and an outline for every part, state and leg piece.
    const unmerged = kit.parts.reduce((n, part) => n + part.states.reduce((m, s) => m + (!s ? 0 : s.pieces && kit.legs.length > 0 ? s.pieces.length : 1), 0), 0) * 2;
    expect(pieces.reduce((n, p) => n + p.fills.length + p.outlines.length, 0)).toBeLessThan(unmerged * 0.6);
  });

  it("paints each part's corners in its own colour", async () => {
    const kit = await rosterKit("ironclad");
    const colours = new Set<string>();
    for (const piece of mergedPieces(kit, toon, "paintWhite", "frameNavy")) {
      for (const fill of piece.fills) {
        const c = fill.lods[0]?.attributes.color;
        if (c) for (let i = 0; i < c.count; i++) colours.add(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString());
      }
    }
    const scheme = kits.kits.ironclad!.scheme!;
    for (const name of ["hull", "hazard", "hazardBlack", "frame"]) expect(colours, name).toContain(new THREE.Color(toon.color(scheme[name]!)).getHexString());
  });

  it("shows exactly one state of every part as a zone is hurt", async () => {
    const kit = await standinKit();
    const model = createMechModel("#ffffff", max, toon, "scrapSteel", kit);
    for (const hp of [[60, 60, 100], [20, 60, 100], [20, 0, 30], [0, 0, 30], [60, 20, 0]]) {
      setMechDamage(model, hp, false);
      for (let zone = 0; zone < 3; zone++) {
        const state = hp[zone]! <= 0 ? 2 : hp[zone]! / max[zone]! < 0.5 ? 1 : 0;
        const expected = kit.parts.filter((p) => p.zone === zone).reduce((n, p) => n + partTriangles(kit, p, shownState(p, state), 0), 0);
        expect(drawnTriangles(model, zone), `zone ${zone} at ${hp}`).toBe(expected);
      }
    }
  });

  it("hangs each leg piece on its own joint, so walking still bends the legs", async () => {
    const kit = await rosterKit("cataclysm");
    const model = createMechModel("#ffffff", max, toon, "scrapSteel", kit);
    expect(model.legs).toHaveLength(4);
    for (const leg of model.legs) {
      for (const joint of [leg.hip, leg.knee, leg.ankle]) expect(joint.children.some((c) => c instanceof THREE.LOD)).toBe(true);
    }
    // Every leg triangle hangs on a joint, none on the body.
    expect(model.kitPieces.filter((p) => p.zone === 0 && p.object.parent === model.body)).toHaveLength(0);
    expect(drawnTriangles(model, 0)).toBe(kit.parts.filter((p) => p.zone === 0).reduce((n, p) => n + partTriangles(kit, p, 0, 0), 0));
    // Broken legs are gone.
    setMechDamage(model, [0, 60, 100], false);
    expect(drawnTriangles(model, 0)).toBe(0);
  });

  it("draws a decoy see-through without touching the real mechs of the same kit", async () => {
    const kit = await rosterKit("arbiter");
    const real = createMechModel("#ffffff", max, toon, "scrapSteel", kit);
    const decoy = createMechModel("#ffffff", max, toon, "scrapSteel", kit);
    makeGhost(decoy, parseAbilityFx(abilityFxJson).ghost);
    const drawn = (model: MechModel) => {
      const out: THREE.Material[] = [];
      model.group.traverse((o) => { if (o instanceof THREE.Mesh && o.visible && (o.material as THREE.Material).side !== THREE.BackSide) out.push(o.material as THREE.Material); });
      return out;
    };
    expect(drawn(decoy).length).toBeGreaterThan(0);
    expect(drawn(decoy).every((m) => m.transparent)).toBe(true);
    expect(drawn(real).every((m) => !m.transparent)).toBe(true);
  });

  it("puts the glows out when the torso breaks, the merged ones too", async () => {
    const kit = await rosterKit("stiletto");
    const model = createMechModel("#ffffff", max, toon, "scrapSteel", kit);
    expect(model.glows.length).toBeGreaterThan(0);
    setMechDamage(model, [60, 60, 0], false);
    for (const glow of model.glows) expect(glow.material.color.r).toBeLessThan(glow.base.r * 0.2);
  });
});
