import type * as THREE from "three";
import type { DiveConfig } from "./dive";
import type { Debris } from "./fx/debris";
import type { FxSprites } from "./fx/fxSprites";
import { FRAMES } from "./fx/spriteArt";

// A mech coming down from the drop-in: a ring of dust thrown out along the ground and a few bits of scrap kicked up.
// The sound and the camera shake are the caller's (main.ts), which knows where you are.
export class LandingImpact {
  constructor(private sprites: FxSprites, private chunks: Debris, private config: DiveConfig["impact"], private colors: readonly THREE.Color[]) {}

  // `floor` is the ground under the spot.
  land(x: number, y: number, z: number, floor: number): void {
    const c = this.config;
    for (let i = 0; i < c.dustPuffs; i++) {
      const s = this.sprites.dust.spawn();
      if (!s) break;
      const angle = (i / c.dustPuffs) * Math.PI * 2 + Math.random() * 0.3;
      const out = c.dustSpeed * (0.7 + Math.random() * 0.5);
      s.x = x + Math.cos(angle) * c.ringMeters; s.y = y + c.dustSize * 0.25; s.z = z + Math.sin(angle) * c.ringMeters;
      s.vx = Math.cos(angle) * out; s.vz = Math.sin(angle) * out; s.vy = 0.8;
      s.drag = 2.5;
      s.life = c.dustSeconds * (0.8 + Math.random() * 0.4);
      s.size0 = c.dustSize * 0.5; s.size1 = c.dustSize * 1.3;
      s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
      s.spin = Math.random() * Math.PI * 2;
      s.fadeShare = 0.6;
    }
    this.chunks.throw(x, y, z, floor, c.debris, c.debrisSpeed, c.debrisLift, c.debrisSize, c.debrisSeconds, this.colors);
  }
}
