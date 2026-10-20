import { describe, expect, it } from "vitest";
import { ReplayFrames, createDrawnMech, type Bracket } from "./replayFrames";

const mech = (x: number, yaw = 0, hp = 100) => ({ ...createDrawnMech(3), x, yaw, vx: x, hp: [hp, hp, hp] });
const bracket = (): Bracket => ({ a: 0, b: 0, t: 0 });

// Frames every 100 ms from 0, mech 7 at x = time in seconds.
function filled(frames: number, capacity = 8): ReplayFrames {
  const r = new ReplayFrames(capacity, 4, 3);
  for (let i = 0; i < frames; i++) {
    r.begin(i * 100);
    r.add(7, mech(i / 10));
  }
  return r;
}

describe("ReplayFrames", () => {
  it("keeps only the newest frames once the ring is full", () => {
    const r = filled(20);
    expect(r.size).toBe(8);
    expect(r.timeAt(0)).toBe(1200);
    expect(r.newestTime).toBe(1900);
  });

  it("finds the frames either side of a moment, and holds at the ends", () => {
    const r = filled(20);
    const b = bracket();
    expect(r.bracket(1450, b)).toBe(true);
    expect(r.timeAt(b.a)).toBe(1400);
    expect(r.timeAt(b.b)).toBe(1500);
    expect(b.t).toBeCloseTo(0.5);
    r.bracket(100, b);
    expect(b.a).toBe(0); expect(b.t).toBe(0);
    r.bracket(5000, b);
    expect(b.a).toBe(7); expect(b.b).toBe(7);
    expect(new ReplayFrames(4, 4, 3).bracket(0, b)).toBe(false);
  });

  it("blends a mech between frames, and takes its state from the nearer one", () => {
    const r = new ReplayFrames(4, 4, 3);
    r.begin(0); r.add(7, { ...mech(0, 0, 100), jetting: true });
    r.begin(100); r.add(7, { ...mech(10, 0, 40), dead: true });
    const out = createDrawnMech(3);
    expect(r.sample(25, 7, bracket(), out)).toBe(true);
    expect(out.x).toBeCloseTo(2.5);
    expect(out.jetting).toBe(true);
    expect(out.hp).toEqual([100, 100, 100]);
    r.sample(75, 7, bracket(), out);
    expect(out.dead).toBe(true);
    expect(out.hp).toEqual([40, 40, 40]);
  });

  it("turns the short way through a half turn", () => {
    const r = new ReplayFrames(4, 4, 3);
    r.begin(0); r.add(7, mech(0, Math.PI - 0.1));
    r.begin(100); r.add(7, mech(0, -Math.PI + 0.1));
    const out = createDrawnMech(3);
    r.sample(50, 7, bracket(), out);
    expect(Math.abs(Math.cos(out.yaw) + 1)).toBeLessThan(0.01); // facing PI, not swinging through 0
  });

  it("holds a mech that is in only one of the two frames where that one has it", () => {
    const r = new ReplayFrames(4, 4, 3);
    r.begin(0); r.add(7, mech(1));
    r.begin(100); r.add(7, mech(2)); r.add(9, mech(50));
    const out = createDrawnMech(3);
    expect(r.sample(50, 9, bracket(), out)).toBe(true);
    expect(out.x).toBe(50);
    expect(r.sample(50, 3, bracket(), out)).toBe(false);
  });

  it("says when a mech first appears in a stretch of the recording", () => {
    const r = new ReplayFrames(8, 4, 3);
    for (let i = 0; i < 6; i++) {
      r.begin(i * 100);
      r.add(1, mech(0));
      if (i >= 3) r.add(2, mech(0));
    }
    expect(r.firstSeen(2, 0, 500)).toBe(300);
    expect(r.firstSeen(2, 0, 200)).toBeNaN();
    expect(r.firstSeen(1, 150, 500)).toBe(200);
  });

  it("leaves out mechs past the per-frame limit instead of spilling into the next frame", () => {
    const r = new ReplayFrames(4, 2, 3);
    r.begin(0);
    r.add(1, mech(0)); r.add(2, mech(0)); r.add(3, mech(0));
    expect(r.countAt(0)).toBe(2);
    r.begin(100);
    expect(r.countAt(1)).toBe(0);
  });
});
