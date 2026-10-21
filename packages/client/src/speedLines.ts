import type * as THREE from "three";
import type { DiveConfig } from "./dive";
import { share } from "./dive";
import type { DropSprites } from "./fx/dropSprites";
import { AXIS } from "./fx/sprites";
import { FRAMES } from "./fx/spriteArt";

// Comic speed lines while you dive (gate 16b): a few tapered, inked streaks rushing past the camera, more of them the
// faster you fall, like the action lines in a cartoon panel. Each is a spot near the camera that drifts against your
// fall and wraps round when it passes; drawn as one-frame sprites from the inked streak pool, so nothing is made
// while playing. Kept off the middle of the view, where the ground you aim at is.
export class SpeedLines {
  private spots: Float32Array; // x, y, z of each streak, relative to the camera

  constructor(private config: DiveConfig["speedLines"], private sprites: DropSprites) {
    const n = Math.floor(config.count);
    this.spots = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.place(i, Math.random() * 2 - 1, 0, -1, 0);
  }

  // Each frame: where the camera is and how you are moving (m/s). Fast enough, the streaks show.
  update(camera: THREE.Vector3, vx: number, vy: number, vz: number, dt: number): void {
    const c = this.config;
    const speed = Math.hypot(vx, vy, vz);
    const strength = share(speed, c.fromSpeed, c.fullSpeed);
    if (strength <= 0) return;
    const dx = vx / speed, dy = vy / speed, dz = vz / speed;
    const n = this.spots.length / 3;
    // Only some of them at a slow fall: the panel fills with lines as you speed up.
    const shown = Math.ceil(n * strength);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      // The air stands still, so seen from the camera it comes at you against your travel.
      const x = this.spots[o]! - vx * dt, y = this.spots[o + 1]! - vy * dt, z = this.spots[o + 2]! - vz * dt;
      if (x * dx + y * dy + z * dz < -c.radiusMeters) this.place(i, 1, dx, dy, dz);
      else { this.spots[o] = x; this.spots[o + 1] = y; this.spots[o + 2] = z; }
      if (i >= shown) continue;
      const s = this.sprites.streaks.draw();
      if (!s) return;
      // Each streak runs back from its spot along the way the air goes past; the sprite grows from its foot.
      const length = c.lengthMeters * (0.6 + strength * 0.4) * (0.7 + 0.6 * ((i * 0.618) % 1));
      s.mode = AXIS;
      s.x = camera.x + this.spots[o]! - dx * length; s.y = camera.y + this.spots[o + 1]! - dy * length; s.z = camera.z + this.spots[o + 2]! - dz * length;
      s.ax = dx; s.ay = dy; s.az = dz;
      s.size0 = s.size1 = c.widthMeters;
      s.aspect = length / c.widthMeters;
      s.frame0 = FRAMES.streak.first;
    }
  }

  // A fresh spot for a streak, `ahead` (-1 to 1) of the camera along the travel (dx, dy, dz), somewhere in a ring round
  // that line between the clear middle and the outer radius.
  private place(i: number, ahead: number, dx: number, dy: number, dz: number): void {
    const c = this.config;
    // Two directions across the travel: crossed with straight up, or with x when the travel is near vertical.
    const helperY = Math.abs(dy) < 0.9 ? 1 : 0, helperX = 1 - helperY;
    let ax = -dz * helperY, ay = dz * helperX, az = dx * helperY - dy * helperX;
    const length = Math.hypot(ax, ay, az) || 1;
    ax /= length; ay /= length; az /= length;
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    const angle = Math.random() * Math.PI * 2;
    const r = c.clearRadiusMeters + Math.random() * (c.radiusMeters - c.clearRadiusMeters);
    const ca = Math.cos(angle) * r, sa = Math.sin(angle) * r;
    const o = i * 3;
    const forward = ahead * c.radiusMeters * (0.6 + Math.random() * 0.4);
    this.spots[o] = dx * forward + ax * ca + bx * sa;
    this.spots[o + 1] = dy * forward + ay * ca + by * sa;
    this.spots[o + 2] = dz * forward + az * ca + bz * sa;
  }
}
