// Walking up a stair or ledge, the sim lifts the mech the whole step in one tick (mechStep.ts resolveBoxes), which
// reads as a hop each step; walking down, it falls under gravity and looks smooth. The sim stays exact: only the drawn
// mech and the camera, which follows it, ease up the step over a few frames.

export interface StepEaseConfig {
  minRiseMeters: number; // smaller rises (walking up a slope) are left alone
  maxRiseMeters: number; // bigger ones are not a step (a jet, a correction) and are left alone too
  perSecond: number; // how fast the lag closes: about 1 / perSecond seconds to most of the way
}

export function parseStepEase(raw: unknown): StepEaseConfig {
  const d = raw as StepEaseConfig;
  if (!(d?.minRiseMeters >= 0 && d.maxRiseMeters > d.minRiseMeters && d.perSecond > 0)) {
    throw new Error("stepEase.json: needs minRiseMeters 0 or more, maxRiseMeters above it and perSecond above 0");
  }
  return d;
}

export class StepEase {
  // Added to the drawn height: below zero right after a step up, back to zero as it eases.
  offset = 0;

  constructor(private config: StepEaseConfig) {}

  // After each sim step: how far the mech rose, and whether it stood on the ground before and after.
  stepped(rise: number, grounded: boolean): void {
    if (grounded && rise > this.config.minRiseMeters && rise <= this.config.maxRiseMeters) this.offset -= rise;
  }

  // Each frame: the offset to draw with now.
  update(dt: number): number {
    this.offset *= Math.exp(-this.config.perSecond * dt);
    if (this.offset > -1e-4) this.offset = 0;
    return this.offset;
  }

  reset(): void {
    this.offset = 0;
  }
}
