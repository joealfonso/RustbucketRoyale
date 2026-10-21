import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import recoilJson from "../../../data/recoil.json";
import weaponsJson from "../../../data/weapons.json";
import kitsJson from "../../../data/mechKits.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import deathFxJson from "../../../data/deathFx.json";
import { createSpring, kickFor, kickIdFor, kickSpring, parseRecoil, stepSpring } from "./recoil";
import { kitFromScene, parseKits } from "./mechKit";
import { createMechModel, kickMech, moveGunsAndSensors, setMechDamage, type MechModel } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import { LEFT, MIDDLE, RIGHT, sideOf, splitBySide } from "./wreckSplit";

const config = parseRecoil(recoilJson.recoil);
const FRAME = 1 / 60;

describe("recoil data", () => {
  it("has a kick for every weapon and the Rail Shot", () => {
    for (const w of weaponsJson.weapons) expect(config.kicks[w.id], w.id).toBeDefined();
    expect(config.kicks.railShot).toBeDefined();
    expect(kickFor(config, "nonsense")).toBe(config.kicks[config.fallback]);
  });

  it("names only parts the kits have", () => {
    const kits = kitsJson.kits as Record<string, { parts: Record<string, unknown> }>;
    for (const [kit, parts] of Object.entries(config.guns)) {
      for (const part of parts) expect(Object.keys(kits[kit]?.parts ?? {}), `${kit} ${part}`).toContain(part);
    }
  });

  it("kicks harder the heavier the weapon, the Rail Shot hardest", () => {
    const k = config.kicks;
    expect(k.autocannon!.backMeters).toBeLessThan(k.scattergun!.backMeters);
    expect(k.scattergun!.backMeters).toBeLessThan(k.spikeDriver!.backMeters);
    expect(k.spikeDriver!.backMeters).toBeLessThan(k.railShot!.backMeters);
  });

  it("refuses a kick that could not kick a whole shot", () => {
    const bad = structuredClone(recoilJson.recoil);
    bad.kicks.autocannon.cap = 0.5;
    expect(() => parseRecoil(bad)).toThrow(/cap/);
  });
});

describe("recoil spring", () => {
  it.each(Object.keys(config.kicks))("%s: snaps back, swings past rest a little, then settles", (id) => {
    const k = config.kicks[id]!;
    const s = createSpring();
    kickSpring(s, k.cap);
    expect(s.x).toBe(1);
    let lowest = 0, t = 0;
    while (stepSpring(s, k.hz, k.damping, FRAME)) {
      lowest = Math.min(lowest, s.x);
      t += FRAME;
      expect(t, "still moving").toBeLessThan(2);
    }
    expect(s.x).toBe(0);
    expect(lowest).toBeLessThan(0); // a short spring, not a slow ease
    expect(lowest).toBeGreaterThan(-0.4); // but no wobble
    expect(t).toBeLessThan(10 / k.hz); // a fast gun settles fast
  });

  it("never stacks past its cap, however fast it fires", () => {
    const s = createSpring();
    for (let i = 0; i < 100; i++) {
      kickSpring(s, 1.4);
      stepSpring(s, 11, 0.6, 0.001);
      expect(s.x).toBeLessThanOrEqual(1.4);
    }
  });

  it("rattles at the autocannon's rate: each shot comes most of the way back before the next", () => {
    const k = config.kicks.autocannon!;
    const shots = weaponsJson.weapons.find((w) => w.id === "autocannon")!.shotsPerSecond;
    const s = createSpring();
    let highest = 0;
    for (let shot = 0; shot < 18; shot++) {
      kickSpring(s, k.cap);
      let lowest = Infinity;
      for (let t = 0; t < 1 / shots - 1e-9; t += FRAME) {
        stepSpring(s, k.hz, k.damping, FRAME);
        lowest = Math.min(lowest, s.x);
        highest = Math.max(highest, s.x);
      }
      expect(Math.abs(lowest), `shot ${shot}`).toBeLessThan(0.25);
    }
    expect(highest).toBeLessThanOrEqual(k.cap);
  });

  it("steps a long frame in small steps, so a stiff spring stays put", () => {
    const s = createSpring();
    kickSpring(s, 1);
    stepSpring(s, 11, 0.6, 0.25);
    expect(Math.abs(s.x)).toBeLessThan(0.1);
  });
});

const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
const max = [60, 60, 100];
const kits = parseKits(kitsJson);
const parse = async (path: string) => {
  const bytes = readFileSync(new URL(`../../../assets/${path}`, import.meta.url));
  return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
};
const rosterKit = async (id: string) => kitFromScene(id, kits, await parse(kits.kits[id]!.file!));
const settle = (model: MechModel) => { for (let i = 0; i < 300 && model.recoiling; i++) moveGunsAndSensors(model, FRAME); };

describe("recoil on a mech", () => {
  it("kicks the grey-box gun arm back and up, then puts it back exactly", () => {
    const model = createMechModel("#ffffff", max);
    expect(model.guns).toHaveLength(1);
    const gun = model.guns[0]!;
    const barrel = model.gunParts[0]!;
    const rest = barrel.position.clone();
    kickMech(model, config.kicks.spikeDriver!, 1.2);
    moveGunsAndSensors(model, FRAME);
    expect(barrel.position.z).toBeGreaterThan(rest.z + 0.1); // back (forward is -z)
    expect(barrel.position.y).toBeGreaterThan(rest.y); // muzzle up
    expect(gun.objects).toContain(model.armMeshes[1]);
    expect(model.body.position.z).toBeGreaterThan(0); // a heavy weapon shoves the torso
    settle(model);
    expect(model.recoiling).toBe(false);
    expect(barrel.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(model.body.position.z).toBe(0);
  });

  it("leaves the torso alone for the autocannon", () => {
    const model = createMechModel("#ffffff", max);
    kickMech(model, config.kicks.autocannon!, 1.2);
    moveGunsAndSensors(model, FRAME);
    expect(model.body.position.z).toBe(0);
  });

  it("goes back to rest the moment the mech is knocked out, so it blows apart from its built pose", () => {
    const model = createMechModel("#ffffff", max);
    const rest = model.gunParts[0]!.position.clone();
    kickMech(model, config.kicks.railShot!, 1.2);
    moveGunsAndSensors(model, FRAME);
    setMechDamage(model, [60, 60, 0], true);
    expect(model.gunParts[0]!.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(model.body.position.z).toBe(0);
    kickMech(model, config.kicks.railShot!, 1.2); // a wreck does not kick
    expect(model.recoiling).toBe(false);
  });

  it("gives the Arbiter a gun on each side that kicks with its own muzzle", async () => {
    const model = createMechModel("#ffffff", max, toon, "scrapSteel", await rosterKit("arbiter"));
    expect(model.guns.map((g) => g.side).sort()).toEqual([LEFT, RIGHT]);
    const muzzles = kitsJson.kits.arbiter.muzzles;
    const right = model.guns.find((g) => g.side === RIGHT)!, left = model.guns.find((g) => g.side === LEFT)!;
    expect(sideOf(muzzles[0]![0]!, config.sideMeters)).toBe(RIGHT);
    kickMech(model, config.kicks.autocannon!, muzzles[0]![0]!);
    expect(right.spring.x).toBe(1);
    expect(left.spring.x).toBe(0);
  });

  it("kicks the Cataclysm's raised barrels back down their own slope, the Ironclad's level gun straight back", async () => {
    const cataclysm = createMechModel("#ffffff", max, toon, "scrapSteel", await rosterKit("cataclysm"));
    const barrels = cataclysm.guns.find((g) => g.side === MIDDLE)!;
    expect(barrels.back.y).toBeLessThan(-0.2); // back is down the slope: the muzzles are high at the front
    expect(barrels.back.z).toBeGreaterThan(0.8);
    const ironclad = createMechModel("#ffffff", max, toon, "scrapSteel", await rosterKit("ironclad"));
    expect(Math.abs(ironclad.guns[0]!.back.y)).toBeLessThan(0.05);
  });

  it.each(kits.roster!)("%s: its gun is its own piece, and still blows apart with its side", async (id) => {
    const model = createMechModel("#ffffff", max, toon, "scrapSteel", await rosterKit(id));
    expect(model.guns.length, "guns").toBeGreaterThan(0);
    // Every kit muzzle has a gun to kick: its own side's, or one in the middle.
    for (const m of (kitsJson.kits as Record<string, { muzzles?: number[][] }>)[id]!.muzzles ?? []) {
      const side = sideOf(m[0]!, config.sideMeters);
      expect(model.guns.some((g) => g.side === side || g.side === MIDDLE), `muzzle at x ${m[0]}`).toBe(true);
    }
    // deathFx.ts pools a fixed number of meshes for each side of the arms; the guns must not crowd any out.
    const perSide = [0, 0, 0];
    for (const piece of model.kitPieces) {
      if (piece.zone !== 1 || !piece.object.visible) continue;
      for (const mesh of piece.object.levels[0]!.object.children) {
        const sides = splitBySide((mesh as THREE.Mesh).geometry, deathFxJson.middleMeters);
        for (let side = LEFT; side <= RIGHT; side++) if (sides[side]) perSide[side]! += 1;
      }
    }
    for (const n of perSide) expect(n).toBeLessThanOrEqual(deathFxJson.meshesPerPiece);
  });
});

describe("right-click kicks (gate 18a)", () => {
  const config = parseRecoil(recoilJson.recoil);
  it("kicks a slug and a full charge harder than the gun's own shot", () => {
    expect(kickIdFor(config, "scattergun", true)).toBe("scattergunAlt");
    expect(kickIdFor(config, "spikeDriver", true)).toBe("spikeDriverAlt");
    expect(kickFor(config, "spikeDriverAlt").backMeters).toBeGreaterThan(kickFor(config, "spikeDriver").backMeters);
    expect(kickFor(config, "scattergunAlt").climbDegrees).toBeGreaterThan(kickFor(config, "scattergun").climbDegrees);
  });

  it("falls back to the gun's own kick when it has no alt one, or the shot is not in the alt look", () => {
    expect(kickIdFor(config, "autocannon", true)).toBe("autocannon");
    expect(kickIdFor(config, "spikeDriver", false)).toBe("spikeDriver");
  });
});
