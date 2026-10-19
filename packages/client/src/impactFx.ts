import * as THREE from "three";
import { CardBatch, starCard } from "./fx/cards";
import { SlotRing } from "./fx/flipbook";
import { FRAMES } from "./fx/spriteArt";
import { AXIS, BILLBOARD, SpritePool, type SpriteLook } from "./fx/sprites";
import { flashFrame, nearestFamily, sparkVelocity, type WeaponFx, type WeaponFxConfig } from "./weaponFxData";

const LIFT_OFF_SURFACE = 0.08; // metres out from the face, so a puff or spark never starts inside the wall

// Where a bullet lands. On the map: a burst of short spark streaks that arc and fall, and a puff of grit in the
// colours of whatever was hit. On a mech: brighter metal sparks and a quick flat flash. Every piece comes from a
// fixed pool (data/weaponFx.json), the oldest reused when all are busy.
export class ImpactFx {
  private worldSparks: SpritePool;
  private mechSparks: SpritePool;
  private grit: SpritePool[];
  private flashes: CardBatch;
  private flashRing = new SlotRing();
  private flashAge: Float32Array;
  private flashPos: Float32Array;
  private flashScale: Float32Array;
  private flashRoll: Float32Array;
  private likes: string[]; // the palette colour each grit family stands for
  private familyOfColor: number[] = [];
  private boxColors: readonly number[] = [];
  private v = { x: 0, y: 0, z: 0 };
  private cameraAt = new THREE.Vector3();

  constructor(scene: THREE.Scene, private config: WeaponFxConfig, color: (name: string) => string, growSteps: number, private cap: (pool: number) => number) {
    const { sparks, grit, mechFlash } = config;
    const look = (colors: [string, string, string]): SpriteLook => ({ colors, growSteps });
    this.worldSparks = new SpritePool(scene, look(sparks.world), color, sparks.pool, () => cap(sparks.pool));
    this.mechSparks = new SpritePool(scene, look(sparks.mech), color, sparks.pool, () => cap(sparks.pool));
    this.grit = grit.families.map((f) => new SpritePool(scene, look(f.colors), color, grit.pool, () => cap(grit.pool)));
    this.flashes = new CardBatch(scene, starCard(mechFlash.points, mechFlash.inner, 1, mechFlash.coreScale, color(mechFlash.colors[1]), color(mechFlash.colors[0])), mechFlash.pool);
    this.flashAge = new Float32Array(mechFlash.pool).fill(Infinity);
    this.flashPos = new Float32Array(mechFlash.pool * 3);
    this.flashScale = new Float32Array(mechFlash.pool);
    this.flashRoll = new Float32Array(mechFlash.pool);
    this.likes = grit.families.map((f) => color(f.like));
  }

  // The new map's box colours (palette hex, as drawn) and which colour each box is, for picking grit colours.
  setSurfaces(palette: readonly string[], boxColors: readonly number[]): void {
    this.familyOfColor = palette.map((hex) => nearestFamily(hex, this.likes));
    this.boxColors = boxColors;
  }

  // A bullet hit a map box (`box`, or -1 if unknown) on the face with normal (nx, ny, nz).
  world(fx: WeaponFx["impact"], x: number, y: number, z: number, nx: number, ny: number, nz: number, box: number): void {
    x += nx * LIFT_OFF_SURFACE; y += ny * LIFT_OFF_SURFACE; z += nz * LIFT_OFF_SURFACE;
    const count = fx.sparks[0] + Math.floor(Math.random() * (fx.sparks[1] - fx.sparks[0] + 1));
    for (let i = 0; i < count; i++) this.spark(this.worldSparks, fx, x, y, z, nx, ny, nz);
    const family = this.familyOfColor[this.boxColors[box] ?? -1] ?? 0;
    for (let i = 0; i < fx.grit; i++) this.puff(this.grit[family]!, fx.gritScale, x, y, z, i);
  }

  // A bullet hit a mech. No face normal comes with it, so the sparks fly up and out every way.
  mech(fx: WeaponFx["impact"], x: number, y: number, z: number): void {
    for (let i = 0; i < fx.mechSparks; i++) this.spark(this.mechSparks, fx, x, y, z, 0, 0.3, 0, 1.6);
    const i = this.flashRing.take(Math.min(this.cap(this.config.mechFlash.pool), this.flashAge.length));
    if (i < 0) return;
    this.flashAge[i] = 0;
    this.flashPos[i * 3] = x; this.flashPos[i * 3 + 1] = y; this.flashPos[i * 3 + 2] = z;
    this.flashScale[i] = fx.mechFlashScale;
    this.flashRoll[i] = Math.random() * Math.PI;
  }

  update(dt: number): void {
    for (let i = 0; i < this.flashAge.length; i++) this.flashAge[i]! += dt;
  }

  // Sparks and grit move here, on the frame clock, the way the other sprite effects do.
  draw(camera: THREE.Camera, dt: number): void {
    camera.getWorldPosition(this.cameraAt);
    this.worldSparks.update(dt, this.cameraAt);
    this.mechSparks.update(dt, this.cameraAt);
    for (const g of this.grit) g.update(dt, this.cameraAt);
    const { sizes, frameSeconds } = this.config.mechFlash;
    this.flashes.begin();
    for (let i = 0; i < this.flashAge.length; i++) {
      const frame = flashFrame(this.flashAge[i]!, frameSeconds, sizes.length);
      if (frame < 0) continue;
      const size = sizes[frame]! * this.flashScale[i]!;
      this.flashes.facing(camera, this.flashPos[i * 3]!, this.flashPos[i * 3 + 1]!, this.flashPos[i * 3 + 2]!, this.flashRoll[i]! + frame * 0.6, size, size);
    }
    this.flashes.end();
  }

  private spark(pool: SpritePool, fx: WeaponFx["impact"], x: number, y: number, z: number, nx: number, ny: number, nz: number, spreadScale = 1): void {
    const s = pool.spawn();
    if (!s) return;
    const look = this.config.sparks;
    sparkVelocity(nx, ny, nz, fx.sparkSpeed, fx.spread * spreadScale, look.lift, Math.random(), Math.random(), Math.random(), this.v);
    s.x = x; s.y = y; s.z = z;
    s.vx = this.v.x; s.vy = this.v.y; s.vz = this.v.z;
    s.gravity = look.gravity; s.drag = look.drag;
    s.life = look.lifeSeconds * (0.7 + 0.3 * Math.random());
    s.size0 = look.size; s.size1 = look.size;
    s.aspect = look.aspect; s.streak = look.streakSeconds; s.mode = AXIS;
    s.frame0 = FRAMES.spark.first; s.frames = FRAMES.spark.count;
    s.shade1 = 1; // cools from the light band to the dark one as it flies
  }

  private puff(pool: SpritePool, scale: number, x: number, y: number, z: number, n: number): void {
    const s = pool.spawn();
    if (!s) return;
    const look = this.config.grit;
    s.x = x; s.y = y; s.z = z;
    s.vy = look.rise; s.drag = 3;
    s.vx = (Math.random() - 0.5) * look.rise; s.vz = (Math.random() - 0.5) * look.rise;
    s.age = -n * 0.05; // a second puff for a heavy hit comes a moment after the first
    s.life = look.lifeSeconds;
    s.size0 = look.startSize * scale; s.size1 = look.endSize * scale;
    s.mode = BILLBOARD; s.spin = Math.random() * Math.PI * 2;
    s.frame0 = FRAMES.smoke.first; s.frames = FRAMES.smoke.count;
    s.shade1 = 1; s.fadeShare = 0.5;
  }
}
