import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import recoilJson from "../../../data/recoil.json";
import kitsJson from "../../../data/mechKits.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { GLOW_BROKEN, GLOW_DAMAGED, GLOW_DARK, GLOW_INTACT, createFlicker, glowLevel, parseFlicker } from "./sensorFlicker";
import { kitFromScene, parseKits } from "./mechKit";
import { createMechModel, moveGunsAndSensors, setMechDamage } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const config = parseFlicker(recoilJson.flicker);
const FRAME = 1 / 60;
// A fixed stream of random numbers, so a run is the same every time.
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

describe("sensor flicker", () => {
  it("is fully lit while intact, an ember while broken, dark on a wreck, and never moves", () => {
    const f = createFlicker();
    const random = seeded(1);
    for (let i = 0; i < 200; i++) {
      expect(glowLevel(GLOW_INTACT, f, FRAME, config, random)).toBe(1);
      expect(glowLevel(GLOW_BROKEN, f, FRAME, config, random)).toBe(config.emberLevel);
      expect(glowLevel(GLOW_DARK, f, FRAME, config, random)).toBe(config.darkLevel);
    }
    expect(config.darkLevel).toBeLessThan(config.emberLevel);
  });

  it("flickers in hard steps while damaged: lit or one of its dim levels, nothing in between, mostly lit", () => {
    const f = createFlicker();
    const random = seeded(7);
    const allowed = new Set([1, ...config.dimLevels]);
    const seen = new Set<number>();
    let lit = 0, changes = 0, last = 1;
    const frames = 60 * 30;
    for (let i = 0; i < frames; i++) {
      const level = glowLevel(GLOW_DAMAGED, f, FRAME, config, random);
      expect(allowed.has(level), `level ${level}`).toBe(true);
      seen.add(level);
      if (level === 1) lit++;
      if (level !== last) changes++;
      last = level;
    }
    expect(seen.size).toBeGreaterThan(2); // irregular: more than one dim step
    expect(lit / frames).toBeGreaterThan(0.5); // still reads as a working sensor
    expect(lit / frames).toBeLessThan(0.95); // but plainly failing
    expect(changes).toBeGreaterThan(30); // over 30 seconds
  });

  it("refuses a stutter that would never come back on", () => {
    expect(() => parseFlicker({ ...recoilJson.flicker, stutterChance: 1 })).toThrow(/stutterChance/);
  });
});

describe("sensor flicker on a mech", () => {
  const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
  const max = [60, 60, 100];
  const kits = parseKits(kitsJson);
  const parse = async (path: string) => {
    const bytes = readFileSync(new URL(`../../../assets/${path}`, import.meta.url));
    return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
  };

  it("flickers only the glows of the damaged zone, and puts every glow out on a wreck", async () => {
    const kit = kitFromScene("stiletto", kits, await parse(kits.kits.stiletto!.file!));
    const model = createMechModel("#ffffff", max, toon, "scrapSteel", kit);
    const arms = model.glows.filter((g) => g.zone === 1), torso = model.glows.filter((g) => g.zone === 2);
    expect(arms.length).toBeGreaterThan(0);
    expect(torso.length).toBeGreaterThan(0);
    setMechDamage(model, [60, 20, 100], false); // arms damaged
    const armLevels = new Set<number>();
    for (let i = 0; i < 600; i++) {
      moveGunsAndSensors(model, FRAME);
      for (const g of torso) expect(g.material.color.equals(g.base)).toBe(true);
      for (const g of arms) armLevels.add(Math.round((g.material.color.r / Math.max(1e-6, g.base.r)) * 100));
    }
    expect(armLevels.size).toBeGreaterThan(1);
    setMechDamage(model, [60, 20, 0], true);
    moveGunsAndSensors(model, FRAME);
    for (const g of model.glows) expect(g.material.color.r).toBeCloseTo(g.base.r * config.darkLevel, 5);
  });
});
