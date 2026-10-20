import type { Terrain } from "@rustbucket/shared";
import { FRAMES } from "./fx/spriteArt";
import { FLAT, AXIS, type SpritePool } from "./fx/sprites";
import type { SplashLook, WaterLook } from "./waterLook";

// Splashes in the water (M11 11b): a ripple ring lying on the surface and a few blobs of spray thrown up that fall
// back, all from the shared water sprite pool, so they cost one draw call together and allocate nothing.
// Three sizes from data/water.json: a wading footstep, a mech landing in water, and a shot hitting the surface.

// Whether a mech standing at (x, y, z) is in the water: the same test the server slows it down with.
export function wadingAt(terrain: Terrain | null, x: number, y: number, z: number): boolean {
  return terrain !== null && terrain.wading(x, y, z);
}

// How far along a straight path (unit direction, `length` metres) it crosses the water surface over water, or -1.
// Shots are raycast against the world and end on the bed or beyond, so this is where they splash on the way through.
export function waterCrossing(terrain: Terrain | null, x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number): number {
  if (!terrain || !Number.isFinite(terrain.waterLevel) || dy === 0) return -1;
  const t = (terrain.waterLevel - y) / dy;
  if (!(t >= 0 && t <= length)) return -1;
  // Only where there is water under that spot: crossing the level over dry ground means being inside a hill.
  return terrain.waterDepthAt(x + dx * t, z + dz * t) > 0 ? t : -1;
}

export class Splashes {
  constructor(private pool: SpritePool, private look: WaterLook["splashes"]) {}

  // A foot coming down in the water at (x, z); `level` is the water surface.
  wade(x: number, level: number, z: number): void {
    this.splash(this.look.wade, x, level, z);
  }

  // A mech coming down into the water from a jump or a fall.
  landing(x: number, level: number, z: number): void {
    this.splash(this.look.landing, x, level, z);
  }

  // A shot going into the water, as its tracer gets there.
  shot(x: number, level: number, z: number): void {
    this.splash(this.look.shot, x, level, z);
  }

  private splash(k: SplashLook, x: number, level: number, z: number): void {
    const ring = this.pool.spawn();
    if (ring) {
      ring.mode = FLAT;
      ring.x = x; ring.y = level + this.look.lift; ring.z = z;
      ring.life = k.ringSeconds;
      ring.size0 = k.ringMeters * 0.3; ring.size1 = k.ringMeters;
      ring.frame0 = FRAMES.ring.first; ring.frames = FRAMES.ring.count;
      ring.spin = Math.random() * Math.PI * 2;
      ring.fadeShare = 0.5;
    }
    for (let i = 0; i < k.drops; i++) {
      const s = this.pool.spawn();
      if (!s) return;
      const up = k.dropSpeed[0] + Math.random() * (k.dropSpeed[1] - k.dropSpeed[0]);
      const angle = (i / Math.max(1, k.drops)) * Math.PI * 2 + Math.random() * 0.8;
      const out = up * k.spread * (0.5 + Math.random() * 0.5);
      // Drawn as short streaks along their flight, so spray reads as flung water, not a puff of smoke.
      s.mode = AXIS;
      s.x = x; s.y = level + this.look.lift; s.z = z;
      s.vx = Math.cos(angle) * out; s.vy = up; s.vz = Math.sin(angle) * out;
      s.gravity = this.look.gravity;
      s.floor = level - 0.5; // sinks out of sight under the surface rather than resting on it
      s.age = -Math.random() * 0.05; // not all in the same instant
      s.life = k.dropSeconds;
      s.size0 = k.dropMeters; s.size1 = k.dropMeters * 0.6;
      s.aspect = 1.4;
      s.streak = 0.05;
      s.frame0 = FRAMES.spark.first; s.frames = FRAMES.spark.count;
      s.fadeShare = 0.3;
    }
  }
}
