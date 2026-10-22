import * as THREE from "three";
import { describe, expect, it } from "vitest";
import lookJson from "../../../data/look.json";
import { parsePresetHaze, steppedHaze, useHaze } from "./haze";
import { parseLight } from "./lightPresets";

const presets = parseLight(lookJson.light).presets;
const softness = lookJson.haze.stepSoftness;

describe("stepped haze", () => {
  it("starts clear, ends fully in the haze colour, and never thins with distance", () => {
    for (const p of presets) {
      expect(steppedHaze(0, p.haze, softness).amount).toBeCloseTo(0, 6);
      const end = steppedHaze(1, p.haze, softness);
      expect(end.amount).toBeCloseTo(1, 6);
      expect(end.band).toBeCloseTo(p.haze.steps.length, 6); // the last band is the haze colour, the sky's horizon
      let last = 0;
      for (let f = 0; f <= 1; f += 0.001) {
        const { amount } = steppedHaze(f, p.haze, softness);
        expect(amount).toBeGreaterThanOrEqual(last - 1e-9);
        last = amount;
      }
    }
  });

  it("holds each step flat between edges, with two or three bands per preset", () => {
    for (const p of presets) {
      const bands = [...p.haze.steps.map((s) => s.at), p.haze.fullAt];
      expect(bands.length).toBeGreaterThanOrEqual(2);
      expect(bands.length).toBeLessThanOrEqual(4);
      for (let i = 0; i < p.haze.steps.length; i++) {
        const mid = (bands[i]! + bands[i + 1]!) / 2;
        expect(steppedHaze(mid, p.haze, softness).amount).toBeCloseTo(p.haze.steps[i]!.amount, 3);
      }
    }
  });

  it("rejects steps out of order", () => {
    const base = presets[0]!.haze;
    expect(() => parsePresetHaze({ ...base, steps: [{ at: 0.5, amount: 0.5, tint: "#ffffff" }, { at: 0.2, amount: 0.6, tint: "#ffffff" }] }, "test")).toThrow(/haze step/);
    expect(() => parsePresetHaze({ ...base, steps: [{ at: 0.2, amount: 1, tint: "#ffffff" }] }, "test")).toThrow(/haze step/);
    expect(() => parsePresetHaze({ ...base, fullAt: base.steps[0]!.at }, "test")).toThrow(/fullAt/);
  });

  it("reaches every material: each material's copy of its uniforms shares the step values", () => {
    const copy = THREE.UniformsUtils.clone(THREE.ShaderLib.toon!.uniforms);
    const merged = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    const p = presets[0]!;
    useHaze(p.haze, (c) => c);
    for (const u of [copy, merged]) {
      const steps = u.hazeSteps!.value as Float32Array;
      const tints = u.hazeTints!.value as Float32Array;
      expect(steps[0]).toBeCloseTo(p.haze.steps[0]!.at, 6);
      const last = p.haze.steps.length;
      expect([steps[last * 2], steps[last * 2 + 1]]).toEqual([Math.fround(p.haze.fullAt), 1]);
      expect(new THREE.Color().fromArray(tints, last * 3).getHexString()).toBe(new THREE.Color(p.haze.color).getHexString());
    }
  });
});
