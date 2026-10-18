import { describe, expect, it } from "vitest";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { createMechModel, setMechDamage } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const look = parseLook(lookJson);
const toon = new Toon(look, parsePalette(paletteJson));
const cover = (m: unknown) => ((m as { userData: { rustCover?: { value: number } } }).userData.rustCover?.value ?? -1);

describe("rust", () => {
  it("a zone's paint rusts more the more it is hurt, from none when whole to the most when broken", () => {
    const max = [60, 60, 100];
    const model = createMechModel("#2E8FD6", max, toon, "paintWhite");
    const at = (fraction: number) => { setMechDamage(model, max.map((h) => h * fraction), false); return cover(model.zoneMaterials[2]); };
    expect(at(1)).toBe(0);
    const spots = at(0.75), patches = at(0.4), most = at(0);
    expect(spots).toBeGreaterThan(0);
    expect(patches).toBeGreaterThan(spots);
    expect(most).toBeCloseTo(look.rust.maxCover, 5);
  });

  it("only touches materials made to rust, and the plain look never rusts", () => {
    expect(cover(toon.material("rustOrange"))).toBe(-1);
    const plain = createMechModel("#2E8FD6", [60, 60, 100]);
    setMechDamage(plain, [0, 0, 10], false);
    expect(cover(plain.zoneMaterials[0])).toBe(-1);
  });
});
