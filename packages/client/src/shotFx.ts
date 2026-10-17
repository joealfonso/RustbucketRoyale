import type { Box, Shot, WeaponStats } from "@rustbucket/shared";
import type { TimedEffects } from "./effects";
import type { Projectiles } from "./projectiles";

// Shows a shot: a flying bullet and a muzzle flash. Used for our own shots and for shots the server says others fired.
export class ShotFx {
  constructor(
    private stats: WeaponStats,
    private projectiles: Projectiles,
    private flashes: TimedEffects,
    private impacts: TimedEffects,
  ) {}

  show(shot: Shot): void {
    this.projectiles.spawn(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, this.stats.projectileSpeed, this.stats.projectileLifetime);
    this.flashes.spawn(shot.ox + shot.dx, shot.oy + shot.dy, shot.oz + shot.dz, 0.05);
  }

  update(dt: number, boxes: readonly Box[]): void {
    this.projectiles.update(dt, boxes);
    this.impacts.update(dt);
    this.flashes.update(dt);
  }
}
