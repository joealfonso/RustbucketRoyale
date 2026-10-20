import { describe, expect, it } from "vitest";
import type { TitanState } from "@rustbucket/shared";
import { TitanTrack, createTitanPose } from "./titanTrack";
import { STOMP, THROW, WALK } from "./titanPose";

const state = (x: number, yaw: number, action: TitanState["action"], actionSeconds: number, hp = 1): TitanState => ({ x, y: 0, z: 0, yaw, hp, action, actionSeconds });

describe("TitanTrack", () => {
  it("draws nothing before the first snapshot", () => {
    expect(new TitanTrack(8).sample(0, createTitanPose())).toBe(false);
  });

  it("blends between the two snapshots around the moment drawn, with the speed between them", () => {
    const track = new TitanTrack(8);
    track.push(state(0, 0, "walk", 1, 1), 1000, 1000);
    track.push(state(10, 1, "walk", 1.1, 0.5), 1100, 1100);
    const p = createTitanPose();
    track.sample(1050, p);
    expect(p.x).toBeCloseTo(5);
    expect(p.yaw).toBeCloseTo(0.5);
    expect(p.hp).toBeCloseTo(0.75);
    expect(p.vx).toBeCloseTo(100); // 10 m in 0.1 s
    expect(p.action).toBe(WALK);
  });

  it("turns the short way round", () => {
    const track = new TitanTrack(8);
    track.push(state(0, 3, "walk", 0), 0, 0);
    track.push(state(0, -3, "walk", 0.1), 100, 100);
    const p = createTitanPose();
    track.sample(50, p);
    expect(Math.abs(Math.sin(p.yaw) - Math.sin(Math.PI))).toBeLessThan(0.01);
  });

  it("holds still past the newest snapshot while the action clock runs on", () => {
    const track = new TitanTrack(8);
    track.push(state(0, 0, "stomp", 0.2), 0, 0);
    track.push(state(2, 0, "stomp", 0.3), 100, 100);
    const p = createTitanPose();
    track.sample(400, p);
    expect(p.x).toBeCloseTo(2);
    expect(p.vx).toBe(0);
    expect(p.seconds).toBeCloseTo(0.6);
  });

  it("starts a new action at the server's own moment, not when the next snapshot arrives", () => {
    const track = new TitanTrack(8);
    track.push(state(0, 0, "walk", 5), 1000, 1000);
    // Sent 100 ms later, the stomp already 0.04 s in: it began at 1060 ms.
    track.push(state(0, 0, "stomp", 0.04), 1100, 1100);
    const p = createTitanPose();
    track.sample(1050, p);
    expect(p.action).toBe(WALK);
    expect(p.seconds).toBeCloseTo(5.05);
    track.sample(1070, p);
    expect(p.action).toBe(STOMP);
    expect(p.seconds).toBeCloseTo(0.01);
  });

  it("counts a move begun again between snapshots as a new one", () => {
    const track = new TitanTrack(8);
    track.push(state(0, 0, "throw", 1.9), 1000, 1000);
    track.push(state(0, 0, "throw", 0.05), 1100, 1100);
    const p = createTitanPose();
    track.sample(1080, p);
    expect(p.action).toBe(THROW);
    expect(p.seconds).toBeCloseTo(0.03);
  });

  it("never restarts a walk whose clock stopped at the wire's limit", () => {
    const track = new TitanTrack(8);
    track.push(state(0, 0, "walk", 12.75), 1000, 1000);
    track.push(state(1, 0, "walk", 12.75), 1100, 1100);
    const p = createTitanPose();
    track.sample(1050, p);
    expect(p.seconds).toBeGreaterThan(12.7);
  });

  it("draws as far behind the best arrival as asked, whatever the clocks' offset", () => {
    const track = new TitanTrack(8);
    track.push(state(0, 0, "walk", 0), 0, 5000);
    track.push(state(0, 0, "walk", 0), 100, 5130); // late by 30 ms
    expect(track.renderTime(5200, 100)).toBe(5200 - 5000 - 100);
  });

  it("keeps only its newest samples, allocating nothing as it goes", () => {
    const track = new TitanTrack(3);
    for (let i = 0; i < 10; i++) track.push(state(i, 0, "walk", i * 0.1), i * 100, i * 100);
    expect(track.size).toBe(3);
    const p = createTitanPose();
    track.sample(0, p); // before the oldest kept: held there
    expect(p.x).toBe(7);
  });
});
