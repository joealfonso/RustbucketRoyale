import { DROP_BURNING, DROP_NONE, applyLook, type Aim, type MechStats } from "@rustbucket/shared";
import { share, type DiveConfig } from "./dive";
import type { ThirdPersonCamera } from "./thirdPersonCamera";

const DEG = Math.PI / 180;

// The camera while you drop in: further back and higher, above and behind your ball, wider the faster you fall, and
// free to look further down than walking allows, so you can put the crosshair on the ground you want to land on.
// The ball steers by the crosshair's ground point, not the pitch, so the extra range is only for aiming; the pitch
// sent to the server is held to the walking limit (simPitch).
export class DiveCamera {
  private blend = 0; // 0 walking, 1 fully pulled back
  private floor: number; // the lowest pitch allowed right now, in degrees

  constructor(private config: DiveConfig["camera"], stats: MechStats) {
    this.floor = stats.minPitch;
  }

  // Mouse look for this frame, in place of applyLook. Dropping, the view reaches down to dive.json minPitchDegrees;
  // once down it eases back up to the walking limit instead of snapping there.
  look(aim: Aim, dx: number, dy: number, stats: MechStats, dropping: boolean, dt: number): void {
    const walk = stats.minPitch;
    this.floor = dropping ? Math.min(walk, this.config.minPitchDegrees) : Math.min(walk, this.floor + this.config.pitchReturnDegreesPerSecond * dt);
    if (this.floor >= walk) { applyLook(aim, dx, dy, stats); return; }
    aim.yaw -= dx * stats.mouseSensitivity * DEG;
    aim.pitch = Math.min(stats.maxPitch * DEG, Math.max(this.floor * DEG, aim.pitch - dy * stats.mouseSensitivity * DEG));
  }

  // Pulls the camera back and widens it for this frame. `phase` is your drop phase, `fall` your fall speed in m/s.
  update(rig: ThirdPersonCamera, phase: number, fall: number, dt: number): void {
    const c = this.config;
    const target = phase === DROP_NONE ? 0 : phase === DROP_BURNING ? c.burnPull : 1;
    this.blend += (target - this.blend) * Math.min(1, dt * c.followPerSecond);
    rig.setPull(this.blend * c.pullBackMeters, this.blend * c.liftMeters);
    rig.setFovExtra(this.blend * share(fall, c.fovFromSpeed, c.fovFullSpeed) * c.fovWidenDegrees);
  }
}

// The pitch the simulation is given: never below the walking limit, the same as the server allows, so prediction
// and the server step the drop with the same number.
export function simPitch(pitch: number, stats: MechStats): number {
  return Math.max(pitch, stats.minPitch * DEG);
}
