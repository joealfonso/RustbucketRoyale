import * as THREE from "three";
import { describe, expect, it } from "vitest";
import abilitiesJson from "../../../data/abilities.json";
import abilityFxJson from "../../../data/abilityFx.json";
import { parseAbilities, type BarrageStats } from "@rustbucket/shared";
import { parseAbilityFx } from "./abilityFx";
import { MortarWarnings, warningRadius, warningSeconds, whistleSeconds } from "./mortarWarning";

const strike = parseAbilities(abilitiesJson).mechs.cataclysm as BarrageStats;
const fx = parseAbilityFx(abilityFxJson);

describe("mortar warning", () => {
  it("lasts from the call until after the last shell, and covers everywhere a shell can hurt", () => {
    expect(strike.kind).toBe("barrage");
    expect(warningSeconds(strike)).toBeCloseTo(strike.delaySeconds + strike.shells * strike.shellSeconds);
    expect(warningSeconds(strike)).toBeGreaterThan(strike.delaySeconds + (strike.shells - 1) * strike.shellSeconds);
    expect(warningRadius(strike)).toBe(strike.spreadMeters + strike.blastRadius);
  });

  it("whistles so the whistle ends as the first shell lands, never before the call", () => {
    expect(whistleSeconds(strike, 0.6)).toBeCloseTo(strike.delaySeconds - 0.6);
    expect(whistleSeconds({ ...strike, delaySeconds: 0.2 }, 0.6)).toBe(0);
  });

  it("shows a ring of the right size, whistles once at its centre, and clears itself", () => {
    const scene = new THREE.Scene();
    const whistles: number[][] = [];
    const warnings = new MortarWarnings(scene, fx.warning, (c) => c, (x, y, z) => whistles.push([x, y, z]));
    warnings.show(10, 2, -5, strike);
    const ring = scene.children.find((c) => c.visible)!;
    expect(ring.scale.x).toBe(warningRadius(strike));
    const dt = 1 / 60;
    let t = 0;
    for (; t < warningSeconds(strike) + 0.1; t += dt) {
      warnings.update(dt);
      if (t < whistleSeconds(strike, fx.warning.whistleLeadSeconds) - dt) expect(whistles.length).toBe(0);
    }
    expect(whistles.length).toBe(1);
    expect(whistles[0]![0]).toBe(10);
    expect(whistles[0]![2]).toBe(-5);
    expect(scene.children.every((c) => !c.visible)).toBe(true);
  });
});
