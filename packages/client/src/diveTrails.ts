import { DROP_BALL, DROP_BURNING } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";
import type { DropSprites } from "./fx/dropSprites";
import type { MechModel } from "./mechModel";
import { FRAMES } from "./fx/spriteArt";
import type { Sprite } from "./fx/sprites";

// A smoke trail behind every ball falling in, so from anywhere you can see who is coming down and where. Gate 16b
// draws it as a chain of chunky inked puffs, one every few metres of travel, left hanging in the air where the mech
// passed and swelling in hard steps as they darken a band and dissolve, like a cartoon's smoke rather than a soft
// streak. They come from the inked smoke pool, so a sky full of divers is one draw call. Only for others: your own
// would rise between the camera and your ball and hide the ground you are aiming at (you get speed lines instead).
export class DiveTrails {
  private travelled = new WeakMap<MechModel, number>(); // metres since each mech's last puff

  constructor(private sprites: DropSprites, private config: DiveConfig["trail"]) {}

  // One mech this frame, at its drop phase and speed in m/s.
  emit(model: MechModel, phase: number, vx: number, vy: number, vz: number, dt: number): void {
    if ((phase !== DROP_BALL && phase !== DROP_BURNING) || model.dead) return;
    const c = this.config;
    const speed = Math.hypot(vx, vy, vz);
    // Never more than one puff a frame: a long frame leaves a gap rather than a clump.
    const d = Math.min(c.spacingMeters, (this.travelled.get(model) ?? Math.random() * c.spacingMeters) + speed * dt);
    if (d < c.spacingMeters) { this.travelled.set(model, d); return; }
    this.travelled.set(model, d - c.spacingMeters);
    puff(this.sprites, model.group.position.x, model.group.position.y + c.centerMeters, model.group.position.z, c.width, c.grow, c.seconds, c.rise);
  }
}

// One chunky inked smoke puff: it pops in at full width, swells in steps, slides a band darker and dissolves from
// inside with inked holes.
export function puff(sprites: DropSprites, x: number, y: number, z: number, width: number, grow: number, seconds: number, rise: number): Sprite | null {
  const s = sprites.smoke.spawn();
  if (!s) return null;
  const jitter = width * 0.25;
  s.x = x + (Math.random() - 0.5) * jitter; s.y = y + (Math.random() - 0.5) * jitter; s.z = z + (Math.random() - 0.5) * jitter;
  s.vy = rise; s.drag = 0.6;
  s.life = seconds * (0.85 + Math.random() * 0.3);
  s.size0 = width * (0.85 + Math.random() * 0.3); s.size1 = s.size0 * grow;
  s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
  s.spin = (Math.random() - 0.5) * 0.8; // a little only: the bands are lit from the upper left, as the world is
  s.shade0 = 0; s.shade1 = 1;
  s.fadeShare = 0.45;
  return s;
}
