import { DROP_BURNING, DROP_DIVING, DROP_RIDING } from "@rustbucket/shared";
import { share, type DiveConfig } from "./dive";
import type { MechModel } from "./mechModel";

const DEG = Math.PI / 180;

// How far nose down a mech leans for a drop phase and the way it is moving: steeper travel, steeper lean; braking on
// the retro-jets it rocks back to land feet first.
export function diveTilt(config: DiveConfig["pose"], phase: number, vx: number, vy: number, vz: number): number {
  if (phase === DROP_BURNING) return config.burnTiltDegrees * DEG;
  if (phase !== DROP_DIVING) return 0;
  const below = Math.atan2(-vy, Math.hypot(vx, vz)) / DEG;
  const steep = share(below, config.levelFallDegrees, config.steepFallDegrees);
  return (config.levelTiltDegrees + (config.steepTiltDegrees - config.levelTiltDegrees) * steep) * DEG;
}

// The falling pose: the whole mech tips over about the middle of its body (its feet tuck on their own in the air,
// gait.ts), with a slow wobble in the wind. Call after the model has been placed this frame; it is placed afresh
// every frame, so the shift that keeps the body's middle still never adds up.
export class DivePose {
  private tilts = new WeakMap<MechModel, number>();
  private clock = 0;

  constructor(private config: DiveConfig["pose"]) {}

  tick(dt: number): void {
    this.clock += dt;
  }

  apply(model: MechModel, phase: number, vx: number, vy: number, vz: number, dt: number, seed: number): void {
    const c = this.config;
    const was = this.tilts.get(model) ?? 0;
    const wobble = phase === DROP_DIVING || phase === DROP_RIDING ? Math.sin(this.clock * c.wobblePerSecond * Math.PI * 2 + seed) * c.wobbleDegrees * DEG : 0;
    const target = diveTilt(c, phase, vx, vy, vz) + wobble;
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
