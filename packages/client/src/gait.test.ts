import { describe, expect, it } from "vitest";
import gaitJson from "../../../data/gait.json";
import { createGait, parseGait, solveLeg, stepGait, type GaitInput } from "./gait";

const config = parseGait(gaitJson);
const ironclad = config.mechs.ironclad!;
const DT = 1 / 60;

// Where the foot ends up after turning the thigh at the hip and the shin at the knee, in the side view.
function footAfter(h: number[], k: number[], a: number[], turns: number[]): [number, number] {
  const rot = (y: number, z: number, t: number): [number, number] => [y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
  const [ty, tz] = rot(k[0]! - h[0]!, k[1]! - h[1]!, turns[0]!);
  const [sy, sz] = rot(a[0]! - k[0]!, a[1]! - k[1]!, turns[0]! + turns[1]!);
  return [h[0]! + ty + sy, h[1]! + tz + sz];
}

describe("leg solver", () => {
  // Ironclad's right leg in its side view (y, z): the knee sits back.
  const hip = [1.46, 0], knee = [0.9, 0.2], ankle = [0.34, -0.06];

  it("leaves a leg at rest alone", () => {
    const out = [0, 0];
    solveLeg(hip[0]!, hip[1]!, knee[0]!, knee[1]!, ankle[0]!, ankle[1]!, ankle[0]!, ankle[1]!, out);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0, 5);
  });

  it("puts the foot on a target in reach, with the knee still bending back", () => {
    const out = [0, 0];
    for (const target of [[0.5, -0.6], [0.4, 0.4], [0.6, 0]]) {
      solveLeg(hip[0]!, hip[1]!, knee[0]!, knee[1]!, ankle[0]!, ankle[1]!, target[0]!, target[1]!, out);
      const [y, z] = footAfter(hip, knee, ankle, out);
      expect(y).toBeCloseTo(target[0]!, 4);
      expect(z).toBeCloseTo(target[1]!, 4);
    }
  });

  it("stretches toward a target out of reach without breaking", () => {
    const out = [0, 0];
    solveLeg(hip[0]!, hip[1]!, knee[0]!, knee[1]!, ankle[0]!, ankle[1]!, -3, 0, out);
    expect(out.every(Number.isFinite)).toBe(true);
  });
});

describe("gait", () => {
  const sides = ["L", "R"];
  const walking = (speed: number): GaitInput => ({ vx: 0, vz: -speed, yaw: 0, grounded: true, dashing: false, limping: false, walkSpeed: 6.8, runSpeed: 13.6 });

  it("keeps a planted foot still on the ground while the body walks over it", () => {
    const g = createGait(2);
    for (let i = 0; i < 120; i++) stepGait(g, walking(6.8), ironclad, sides, config.smoothing, DT); // settle the smoothing
    // Over a few frames in which the left foot stays down, it slides back exactly as far as the body moves.
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const before = g.feet[2]!, downBefore = (g.planted & 1) !== 0;
      stepGait(g, walking(6.8), ironclad, sides, config.smoothing, DT);
      if (downBefore && (g.planted & 1) !== 0 && g.footfalls === 0) {
        expect(g.feet[2]! - before).toBeCloseTo(6.8 * DT, 3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("lands each foot in turn while walking, and stands still when stopped", () => {
    const g = createGait(2);
    let left = 0, right = 0;
    for (let i = 0; i < 300; i++) {
      stepGait(g, walking(6.8), ironclad, sides, config.smoothing, DT);
      if (g.footfalls & 1) left++;
      if (g.footfalls & 2) right++;
    }
    expect(left).toBeGreaterThan(3);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 300; i++) stepGait(g, walking(0), ironclad, sides, config.smoothing, DT);
    expect(Math.max(...g.feet.map(Math.abs))).toBeLessThan(0.01);
    expect(Math.abs(g.bob)).toBeLessThan(0.01);
  });

  it("tucks the feet up in the air and thumps every foot down on landing", () => {
    const g = createGait(4);
    const sides4 = ["FL", "FR", "BL", "BR"];
    for (let i = 0; i < 60; i++) stepGait(g, { ...walking(0), grounded: false }, ironclad, sides4, config.smoothing, DT);
    expect(g.feet[1]).toBeGreaterThan(ironclad.tuck * 0.8);
    let thumps = 0;
    for (let i = 0; i < 60; i++) {
      stepGait(g, walking(0), ironclad, sides4, config.smoothing, DT);
      if (g.footfalls === 0b1111) thumps++;
    }
    expect(thumps).toBe(1);
  });

  it("leans forward when running and into a dash", () => {
    const g = createGait(2);
    for (let i = 0; i < 120; i++) stepGait(g, walking(13.6), ironclad, sides, config.smoothing, DT);
    const running = g.pitch;
    expect(running).toBeLessThan(0);
    for (let i = 0; i < 30; i++) stepGait(g, { ...walking(13.6), dashing: true }, ironclad, sides, config.smoothing, DT);
    expect(g.pitch).toBeLessThan(running);
  });

  it("has numbers for every roster mech", () => {
    for (const id of ["ironclad", "stiletto", "cataclysm", "arbiter"]) expect(config.mechs[id]).toBeDefined();
  });
});
