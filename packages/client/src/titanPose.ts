import type { TitanConfig } from "@rustbucket/shared";
import type { TitanLook } from "./titanLook";

// The Titan's moves as a few numbers laid over its walk, worked out from what it is doing and how far into it (the
// server's action clock, titanTrack.ts) with the server's own timings (data/titan.json), so the foot lands on the
// moment the server's stomp does and the car leaves the hands as the server throws it. Pure, so it is tested;
// titanView.ts puts the numbers on the model.
export interface TitanMotion {
  pitch: number; // radians the body tips back (forward is negative, as the gait's lean)
  roll: number;
  footLift: number; footForward: number; // metres the stomping foot (its first leg) is raised and pushed ahead
  arms: number; // radians both arms swing up about the shoulders: 0 hanging, PI straight overhead
  car: boolean; // a car is in its hands
  topple: number; // radians it has tipped forward while falling
}

export function createTitanMotion(): TitanMotion {
  return { pitch: 0, roll: 0, footLift: 0, footForward: 0, arms: 0, car: false, topple: 0 };
}

// The server's timings the moves follow.
export type TitanTimings = Pick<TitanConfig, "stomp" | "throw" | "roar" | "fall">;

// Indices into TITAN_ACTIONS (shared titan.ts), as titanTrack.ts reports the action.
export const WALK = 0, STOMP = 1, THROW = 2, ROAR = 3, DOWN = 4;
const DEG = Math.PI / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

// True once when a clock moving from `before` to `after` passes `at`.
export function crossed(before: number, after: number, at: number): boolean {
  return before < at && after >= at;
}

export function titanMotion(action: number, seconds: number, look: TitanLook, timing: TitanTimings, out: TitanMotion): TitanMotion {
  out.pitch = 0; out.roll = 0; out.footLift = 0; out.footForward = 0; out.arms = 0; out.car = false; out.topple = 0;
  const s = Math.max(0, seconds);
  if (action === STOMP) {
    const k = look.stomp, windup = timing.stomp.windupSeconds;
    // The foot is up until just before the server's stomp lands, and comes down hard onto that moment.
    const raise = Math.max(1e-3, windup - k.slamSeconds);
    if (s < raise) {
      // Rears back with the foot coming up and forward, slow and heavy.
      const up = smooth(s / raise);
      out.footLift = up * k.footLiftMeters;
      out.footForward = up * k.footForwardMeters;
      out.pitch = up * k.rearDegrees * DEG;
    } else if (s < windup) {
      // Down: the foot falls faster as it goes, the body throws its weight forward.
      const down = clamp01((s - raise) / k.slamSeconds);
      out.footLift = k.footLiftMeters * (1 - down * down);
      out.footForward = k.footForwardMeters;
      out.pitch = (k.rearDegrees + (-k.slamDegrees - k.rearDegrees) * down) * DEG;
    } else {
      const back = smooth((s - windup) / Math.max(1e-3, timing.stomp.recoverSeconds));
      out.footForward = k.footForwardMeters * (1 - back);
      out.pitch = -k.slamDegrees * (1 - back) * DEG;
    }
  } else if (action === THROW) {
    const k = look.throw, windup = timing.throw.windupSeconds;
    const swingFrom = Math.max(1e-3, windup - k.swingSeconds);
    if (s < swingFrom) {
      // Picks up a car and hauls it up behind its head, leaning back under the weight.
      const up = smooth(s / swingFrom);
      out.arms = up * k.raisedDegrees * DEG;
      out.pitch = up * k.leanBackDegrees * DEG;
      out.car = s >= k.pickupShare * swingFrom;
    } else if (s < windup) {
      // Heaves it over: the arms come forward faster and faster and let go overhead, where the server's car starts.
      const swing = clamp01((s - swingFrom) / Math.max(1e-3, windup - swingFrom));
      out.arms = (k.raisedDegrees + (k.releaseDegrees - k.raisedDegrees) * swing * swing) * DEG;
      out.pitch = (k.leanBackDegrees + (-k.leanForwardDegrees - k.leanBackDegrees) * swing) * DEG;
      out.car = true;
    } else {
      // Follows through, arms coming down.
      const back = smooth((s - windup) / Math.max(1e-3, timing.throw.recoverSeconds));
      out.arms = k.releaseDegrees * (1 - back) * DEG;
      out.pitch = -k.leanForwardDegrees * (1 - back) * DEG;
    }
  } else if (action === ROAR) {
    const k = look.roar;
    // Up quickly, held, and down: a hump over the roar's length with a fast start.
    const t = clamp01(s / timing.roar.seconds);
    const swell = Math.min(1, t * 5) * smooth((1 - t) * 3);
    out.pitch = swell * k.rearDegrees * DEG;
    out.arms = swell * k.armDegrees * DEG;
    out.roll = swell * Math.sin(s * k.shudderHz * Math.PI * 2) * k.shudderDegrees * DEG;
  } else if (action === DOWN) {
    // Tips forward slowly, then faster, until the body hits the ground when the server's fall ends.
    const t = clamp01(s / timing.fall.seconds);
    out.topple = t * t * look.fall.toppleDegrees * DEG;
  }
  return out;
}
