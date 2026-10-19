import * as THREE from "three";
import { CardBatch, needleCard, starCard } from "./fx/cards";
import { SlotRing } from "./fx/flipbook";
import { flashFrame, type WeaponFx } from "./weaponFxData";

// Pellets of one trigger pull leave the same muzzle together; this close in time and space they share one flash.
const SAME_FLASH_SECONDS = 0.02;
const DEGREES = Math.PI / 180;

// One weapon's muzzle flashes: a star facing the camera, so it reads from behind your own mech, and a flame along
// the barrel, so it reads from the side. A two or three frame flipbook (data/weaponFx.json): each frame swaps the
// size and turn outright, no fading.
class WeaponFlashes {
  private stars: CardBatch;
  private plumes: CardBatch;
  private ring = new SlotRing();
  private age: Float32Array;
  private pos: Float32Array;
  private dir: Float32Array;
  private roll: Float32Array;
  private lastSlot = -1;

  constructor(scene: THREE.Scene, private fx: WeaponFx["flash"], outer: string, core: string, private cap: () => number) {
    this.stars = new CardBatch(scene, starCard(fx.points, fx.inner, fx.aspect, fx.coreScale, outer, core), fx.pool);
    this.plumes = new CardBatch(scene, needleCard(fx.coreScale, outer, core), fx.pool);
    this.age = new Float32Array(fx.pool).fill(Infinity);
    this.pos = new Float32Array(fx.pool * 3);
    this.dir = new Float32Array(fx.pool * 3);
    this.roll = new Float32Array(fx.pool);
  }

  spawn(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const last = this.lastSlot;
    if (last >= 0 && this.age[last]! < SAME_FLASH_SECONDS && this.pos[last * 3] === x && this.pos[last * 3 + 1] === y && this.pos[last * 3 + 2] === z) return;
    const i = this.ring.take(Math.min(this.cap(), this.fx.pool));
    if (i < 0) return;
    this.lastSlot = i;
    this.age[i] = 0;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.dir[i * 3] = dx; this.dir[i * 3 + 1] = dy; this.dir[i * 3 + 2] = dz;
    // A random turn per shot, in steps of the star's own symmetry, so a burst of the same star still flickers.
    this.roll[i] = Math.floor(Math.random() * this.fx.points) * (Math.PI / this.fx.points);
  }

  update(dt: number): void {
    for (let i = 0; i < this.age.length; i++) this.age[i]! += dt;
  }

  draw(camera: THREE.Camera): void {
    this.stars.begin();
    this.plumes.begin();
    const frames = this.fx.frames;
    for (let i = 0; i < this.age.length; i++) {
      const frame = flashFrame(this.age[i]!, this.fx.frameSeconds, frames.length);
      if (frame < 0) continue;
      const f = frames[frame]!;
      const x = this.pos[i * 3]!, y = this.pos[i * 3 + 1]!, z = this.pos[i * 3 + 2]!;
      const dx = this.dir[i * 3]!, dy = this.dir[i * 3 + 1]!, dz = this.dir[i * 3 + 2]!;
      this.stars.facing(camera, x, y, z, this.roll[i]! + f.spin * DEGREES, f.size, f.size);
      // The flame starts at the muzzle and points out: its head is `plume` metres down the barrel line.
      this.plumes.along(camera, x + dx * f.plume, y + dy * f.plume, z + dz * f.plume, dx, dy, dz, f.width, f.plume);
    }
    this.stars.end();
    this.plumes.end();
  }
}

// Muzzle flashes for every weapon, by weapon index.
export class MuzzleFlashes {
  private weapons: WeaponFlashes[];

  constructor(scene: THREE.Scene, fx: readonly WeaponFx[], colors: readonly string[], color: (name: string) => string, cap: (pool: number) => number) {
    this.weapons = fx.map((w, i) => new WeaponFlashes(scene, w.flash, colors[i]!, color(w.flash.core), () => cap(w.flash.pool)));
  }

  spawn(weapon: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    this.weapons[weapon]?.spawn(x, y, z, dx, dy, dz);
  }

  update(dt: number): void {
    for (const w of this.weapons) w.update(dt);
  }

  draw(camera: THREE.Camera): void {
    for (const w of this.weapons) w.draw(camera);
  }
}
