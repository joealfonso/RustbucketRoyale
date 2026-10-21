import { DROP_BURNING, DROP_DIVING } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";
import type { FxSprites } from "./fx/fxSprites";
import type { MechModel } from "./mechModel";
import { AXIS } from "./fx/sprites";
import { FRAMES } from "./fx/spriteArt";

// A smoke trail behind every mech diving in, so from anywhere you can see who is coming down and where. Each puff is
// stretched along the way the mech falls, so a few a second join up into one streak; they come from the shared smoke
// pool, so a sky full of divers costs no more draw calls. Only for others: your own would run between the camera and
// your mech and hide the ground you are aiming at (you get speed lines instead).
export class DiveTrails {
  private timers = new WeakMap<MechModel, number>();

  constructor(private sprites: FxSprites, private config: DiveConfig["trail"]) {}

  // One mech this frame, at its drop phase and speed in m/s.
  emit(model: MechModel, phase: number, vx: number, vy: number, vz: number, dt: number): void {
    if ((phase !== DROP_DIVING && phase !== DROP_BURNING) || model.dead) return;
    const c = this.config, every = 1 / c.puffsPerSecond;
    // Never more than one puff a frame: a long frame leaves a gap rather than a clump.
    const t = Math.min(every, (this.timers.get(model) ?? Math.random() * every) + dt);
    if (t < every) { this.timers.set(model, t); return; }
    this.timers.set(model, t - every);
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 1) return;
    const s = this.sprites.smoke.spawn();
    if (!s) return;
    const p = model.group.position;
    const dx = vx / speed, dy = vy / speed, dz = vz / speed;
    // Long enough to reach the last puff, so the streak has no gaps.
    const length = speed * every * c.overlap;
    s.mode = AXIS;
    s.ax = dx; s.ay = dy; s.az = dz;
    s.x = p.x - dx * length * 0.5; s.y = p.y + c.centerMeters - dy * length * 0.5; s.z = p.z - dz * length * 0.5;
    s.vy = c.rise; s.drag = 0.5;
    s.life = c.seconds;
    s.size0 = c.width; s.size1 = c.width * c.grow;
    s.aspect = Math.max(1, length / c.width);
    s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
    s.fadeShare = 0.7;
  }
}
