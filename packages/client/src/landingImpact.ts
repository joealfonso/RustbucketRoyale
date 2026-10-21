import type * as THREE from "three";
import type { DiveConfig } from "./dive";
import type { Debris } from "./fx/debris";
import type { DropSprites } from "./fx/dropSprites";
import { FLAT } from "./fx/sprites";
import { FRAMES } from "./fx/spriteArt";

// A mech coming down from the drop-in, drawn like a cartoon impact (gate 16b): a quick hand-drawn shockwave ring
// snapping out along the ground, a slower flat ring of dust behind it, chunky inked dust puffs thrown out round the
// feet, and a few bits of scrap kicked up. The sound and the camera shake are the caller's (main.ts), which knows
// where you are.
export class LandingImpact {
  constructor(private sprites: DropSprites, private chunks: Debris, private config: DiveConfig["impact"], private colors: readonly THREE.Color[]) {}

  // `floor` is the ground under the spot.
  land(x: number, y: number, z: number, floor: number): void {
    const c = this.config;
    this.ring(x, floor, z, c.shockStartMeters, c.shockEndMeters, c.shockSeconds, 0);
    this.ring(x, floor, z, c.ringStartMeters, c.ringEndMeters, c.ringSeconds, 1);
    for (let i = 0; i < c.dustPuffs; i++) {
      const s = this.sprites.dust.spawn();
      if (!s) break;
      const angle = (i / c.dustPuffs) * Math.PI * 2 + Math.random() * 0.3;
      const out = c.dustSpeed * (0.7 + Math.random() * 0.5);
      s.x = x + Math.cos(angle) * c.ringMeters; s.y = y + c.dustSize * 0.3; s.z = z + Math.sin(angle) * c.ringMeters;
      s.vx = Math.cos(angle) * out; s.vz = Math.sin(angle) * out; s.vy = 1.2;
      s.drag = 2.5;
      s.life = c.dustSeconds * (0.8 + Math.random() * 0.4);
      s.size0 = c.dustSize * 0.7; s.size1 = c.dustSize * 1.4;
      s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
      s.spin = (Math.random() - 0.5) * 0.6;
      s.shade0 = 0; s.shade1 = 1;
      s.fadeShare = 0.5;
    }
    this.chunks.throw(x, y, z, floor, c.debris, c.debrisSpeed, c.debrisLift, c.debrisSize, c.debrisSeconds, this.colors);
  }

  // A flat ring lying on the ground, stepping out from `from` to `to` metres across and thinning frame by frame.
  private ring(x: number, y: number, z: number, from: number, to: number, seconds: number, shade: number): void {
    const s = this.sprites.dust.spawn();
    if (!s) return;
    s.mode = FLAT;
    s.x = x; s.y = y + 0.15; s.z = z;
    s.life = seconds;
    s.size0 = from; s.size1 = to;
    s.frame0 = FRAMES.ring.first; s.frames = FRAMES.ring.count;
    s.spin = Math.random() * Math.PI * 2;
    s.shade0 = shade; s.shade1 = shade;
    s.fadeShare = 0.35;
  }
}
