import { describe, expect, it } from "vitest";
import { runSoak } from "./runSoak";

// The full match soak for the small tier runs with every test pass. Medium and large run nightly in CI
// (npm run soak), because they take a few seconds each.
describe("soak", () => {
  it("plays a whole small match on a random seed with nothing going wrong", async () => {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const report = await runSoak("small", seed);
    expect(report.problems, `replay with: SEED=${seed} npm run soak -- small`).toEqual([]);
    expect(report.eliminations).toBeGreaterThan(0);
  }, 60_000);

  it("plays the same match again from the same seed", async () => {
    const a = await runSoak("small", 4242);
    const b = await runSoak("small", 4242);
    expect(b.matchSeconds).toBe(a.matchSeconds);
    expect(b.eliminations).toBe(a.eliminations);
  }, 60_000);

  it("would catch a budget being blown", async () => {
    const report = await runSoak("small", 7, { bandwidthKbps: 1 });
    expect(report.problems.join()).toMatch(/kbps/);
  }, 60_000);
});
