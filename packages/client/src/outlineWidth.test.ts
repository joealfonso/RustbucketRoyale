import { describe, expect, it } from "vitest";
import * as THREE from "three";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { outlineMeters, outlineWidthGlsl, parseOutlineWidth } from "./outlineWidth";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const look = parseLook(lookJson);
const focal = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 3000).projectionMatrix.elements[5]!;
// Pixels on a 1080-tall screen that `metres` covers at `depth`.
const pixels = (metres: number, depth: number) => (metres / ((2 * depth) / focal)) * 1080;

describe("outline width", () => {
  it("is the same number of pixels near and middling far, for the world and the mechs", () => {
    for (const w of [look.outline.world, look.outline.mech]) {
      for (const depth of [3, 10, 30, 50]) expect(pixels(outlineMeters(w, depth, focal), depth)).toBeCloseTo(w.pixels, 5);
    }
  });

  it("thins past thinFromMeters, to thinShare of the pixels by thinToMeters, and never past maxMeters", () => {
    const w = { pixels: 2, minMeters: 0.001, maxMeters: 10, thinFromMeters: 50, thinToMeters: 150, thinShare: 0.5 };
    expect(pixels(outlineMeters(w, 100, focal), 100)).toBeLessThan(2);
    expect(pixels(outlineMeters(w, 100, focal), 100)).toBeGreaterThan(1);
    expect(pixels(outlineMeters(w, 400, focal), 400)).toBeCloseTo(1, 5);
    expect(outlineMeters({ ...w, maxMeters: 0.1 }, 400, focal)).toBe(0.1);
    expect(outlineMeters(w, 0, focal)).toBe(w.minMeters);
  });

  it("refuses widths that make no sense", () => {
    const w = look.outline.world;
    expect(() => parseOutlineWidth({ ...w, pixels: 0 }, "x")).toThrow(/pixels/);
    expect(() => parseOutlineWidth({ ...w, thinToMeters: w.thinFromMeters }, "x")).toThrow(/thinTo/);
    expect(() => parseOutlineWidth({ ...w, maxMeters: w.minMeters / 2 }, "x")).toThrow(/maxMeters/);
  });

  it("bakes the same numbers into the shader", () => {
    const glsl = outlineWidthGlsl(look.outline.mech);
    expect(glsl).toContain(look.outline.mech.maxMeters.toFixed(5));
    expect(glsl).toContain((look.outline.mech.pixels / 1080).toFixed(5));
  });
});

describe("box outlines", () => {
  const toon = new Toon(look, parsePalette(paletteJson));

  it("are the box's own size, pushed out in the shader, so a box and its hull always match", () => {
    const box = toon.box(new THREE.Group(), [0, 0, 0], [2, 3, 4], "rust");
    expect(box.hull.scale.toArray()).toEqual(box.mesh.scale.toArray());
    toon.resize(box, [1, 1, 5]);
    expect(box.hull.scale.toArray()).toEqual([1, 1, 5]);
    const many = toon.instances("rust", 2);
    many.set(0, 1, 2, 3, 4, 5, 6);
    expect(Array.from(many.hull!.instanceMatrix.array.slice(0, 16))).toEqual(Array.from(many.mesh.instanceMatrix.array.slice(0, 16)));
  });

  it("on a mech take the mech's darker ink", () => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(), toon.material("#a9b8c4"));
    toon.outlineChild(part, "#a9b8c4", true);
    const hull = part.children[0] as THREE.Mesh;
    expect((hull.material as THREE.MeshBasicMaterial).color.getHex()).toBe(toon.shellOutline("#a9b8c4", true).color.getHex());
    expect(toon.outlineMaterial("#a9b8c4", true)).not.toBe(toon.outlineMaterial("#a9b8c4"));
  });
});
