import { DROP_BURNING } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";
import type { MechModel } from "./mechModel";

const DEG = Math.PI / 180;

// How far a mech leans for a drop phase: braking on the retro-jets it rocks back to land feet first. In the ball it
// stays upright, hidden inside it.
export function diveTilt(config: DiveConfig["pose"], phase: number): number {
  return phase === DROP_BURNING ? config.burnTiltDegrees * DEG : 0;
}

// The braking pose: the whole mech tips about the middle of its body (its feet tuck on their own in the air,
// gait.ts). Call after the model has been placed this frame; it is placed afresh every frame, so the shift that
// keeps the body's middle still never adds up.
export class DivePose {
  private tilts = new WeakMap<MechModel, number>();

  constructor(private config: DiveConfig["pose"]) {}

  apply(model: MechModel, phase: number, dt: number): void {
    const c = this.config;
    const was = this.tilts.get(model) ?? 0;
    const target = diveTilt(c, phase);
    const tilt = was + (target - was) * Math.min(1, dt * c.followPerSecond);
    if (Math.abs(tilt) < 1e-4 && was === 0) return;
    this.tilts.set(model, Math.abs(tilt) < 1e-4 ? 0 : tilt);
    const g = model.group;
    if (g.rotation.order !== "YXZ") g.rotation.order = "YXZ"; // turned to face its way, then tipped along it
    g.rotation.x = -tilt;
    // Tipping about the feet would swing the body forward; this puts its middle back where it was.
    const h = c.pivotMeters, yaw = g.rotation.y;
    const back = h * Math.sin(tilt);
    g.position.x += back * Math.sin(yaw);
    g.position.y += h * (1 - Math.cos(tilt));
    g.position.z += back * Math.cos(yaw);
  }
}
