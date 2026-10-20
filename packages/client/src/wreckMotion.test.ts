import { describe, expect, it } from "vitest";
import * as THREE from "three";
import deathFxJson from "../../../data/deathFx.json";
import { BOUNCED, IN_AIR, LANDED, flattestAngle, restHeight, seededRandom, stepPiece, tumbleAt, type FlyingPiece, type TumblePose } from "./wreckMotion";

const motion = deathFxJson.pieces;
const DT = 1 / 60;
const thrown = (): FlyingPiece => ({ x: 0, y: 2.4, z: 0, vx: 6, vy: 8, vz: 0, angle: 0, spin: 9, restAngle: 0, bounces: 0, down: false });

describe("stepPiece", () => {
  it("flies, bounces at most maxBounces times, never sinks below the floor, and is down well within 3 s", () => {
    const p = thrown();
    let bounces = 0, landedAt = -1;
    for (let i = 0; i < 180; i++) {
      const hit = stepPiece(p, DT, 0, motion);
      if (hit === BOUNCED) bounces++;
      if (hit === LANDED) landedAt = i * DT;
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
    expect(bounces).toBeLessThanOrEqual(motion.maxBounces);
    expect(p.down).toBe(true);
    expect(landedAt).toBeGreaterThan(0);
    expect(landedAt).toBeLessThan(3);
    expect([p.vx, p.vy, p.vz, p.spin]).toEqual([0, 0, 0, 0]);
    expect(p.y).toBe(0);
  });

  it("loses speed with each bounce", () => {
    const p = thrown();
    const ups: number[] = [];
    for (let i = 0; i < 180 && !p.down; i++) if (stepPiece(p, DT, 0, motion) === BOUNCED) ups.push(p.vy);
    for (let i = 1; i < ups.length; i++) expect(ups[i]!).toBeLessThan(ups[i - 1]!);
  });

  it("once down rolls to its rest angle and stays on the floor as the floor changes", () => {
    const p = { ...thrown(), down: true, vx: 0, vy: 0, spin: 0, angle: 0.3, restAngle: Math.PI / 2 };
    for (let i = 0; i < 60; i++) expect(stepPiece(p, DT, 0.25, motion)).toBe(IN_AIR);
    expect(p.angle).toBe(Math.PI / 2);
    expect(p.y).toBe(0.25);
  });
});

describe("flattestAngle and restHeight", () => {
  // An arm: tall and thin, standing upright at angle 0.
  const min = new THREE.Vector3(-0.3, -1, -0.3), max = new THREE.Vector3(0.3, 1, 0.3);
  const axis = new THREE.Vector3(1, 0, 0);
  const q = new THREE.Quaternion();
  const heightAt = (a: number) => restHeight(min, max, q.setFromAxisAngle(axis, a));

  it("measures how high the middle rests: half its height standing, half its thickness lying", () => {
    expect(heightAt(0)).toBeCloseTo(1);
    expect(heightAt(Math.PI / 2)).toBeCloseTo(0.3);
  });

  it("lays an arm along the ground rather than standing it on its end", () => {
    expect(flattestAngle(0.4, heightAt)).toBeCloseTo(Math.PI / 2);
    expect(flattestAngle(-0.4, heightAt)).toBeCloseTo(-Math.PI / 2);
    expect(flattestAngle(3.5, heightAt)).toBeCloseTo((3 * Math.PI) / 2);
  });
});

describe("tumbleAt", () => {
  const torso = deathFxJson.torso;
  const pose: TumblePose = { along: 0, tip: 0, roll: 0, hop: 0, fall: 0, done: false };

  it("starts where the mech stood and ends lying still at the full distance and turn, on the ground", () => {
    tumbleAt(0, torso, pose);
    expect([pose.along, pose.tip, pose.roll, pose.hop, pose.fall, pose.done]).toEqual([0, 0, 0, 0, 0, false]);
    tumbleAt(torso.seconds + 1, torso, pose);
    expect(pose.along).toBeCloseTo(torso.meters);
    expect(pose.tip).toBeCloseTo((torso.degrees * Math.PI) / 180);
    expect(pose.hop).toBe(0);
    expect(pose.roll).toBeCloseTo(0);
    expect(pose.fall).toBe(1);
    expect(pose.done).toBe(true);
  });

  it("turns fastest at first and never turns back", () => {
    let last = 0, lastStep = Infinity;
    for (let t = 0.05; t <= torso.seconds; t += 0.05) {
      tumbleAt(t, torso, pose);
      expect(pose.tip).toBeGreaterThanOrEqual(last);
      expect(pose.tip - last).toBeLessThanOrEqual(lastStep + 1e-9);
      lastStep = pose.tip - last;
      last = pose.tip;
    }
  });
});

describe("seededRandom", () => {
  it("gives the same numbers for the same mech, between 0 and 1", () => {
    const a = { seed: 7 }, b = { seed: 7 };
    for (let i = 0; i < 50; i++) {
      const x = seededRandom(a);
      expect(x).toBe(seededRandom(b));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
