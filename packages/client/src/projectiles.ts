import * as THREE from "three";
import { createRayHit, type RayHit, type World } from "@rustbucket/shared";
import { CardBatch, needleCard } from "./fx/cards";
import { SlotRing } from "./fx/flipbook";
import type { WeaponFx } from "./weaponFxData";

const MECH_SKIN = 0.4; // metres; a shot's length on a mech can end a little inside its hit box

// One weapon's pooled bullets, drawn as tracer streaks: a flat two-tone needle in the weapon's colour, head at the
// bullet, tail trailing back along its path (never further back than the muzzle). Each step sweeps a ray from the old
// position to the new one, so fast shots cannot tunnel through thin walls.
export class Projectiles {
  private streaks: CardBatch;
  private ring = new SlotRing();
  private pos: Float32Array;
  private dir: Float32Array;
  private speed: Float32Array;
  private travelled: Float32Array;
  private left: Float32Array; // metres still to fly; the last step stops exactly where the shot ends
  private impactAtEnd: Uint8Array;
  private hit: RayHit = createRayHit();
  // Where a bullet hits the map, with the face it hit and which box (for the colour of the grit it kicks up).
  onImpact?: (x: number, y: number, z: number, nx: number, ny: number, nz: number, box: number) => void;
  // Where a bullet the server said hit a mech arrives.
  onMechImpact?: (x: number, y: number, z: number) => void;

  constructor(scene: THREE.Scene, private fx: WeaponFx["tracer"], outer: string, core: string, private cap: () => number) {
    const count = fx.pool;
    this.streaks = new CardBatch(scene, needleCard(fx.coreShare, outer, core), count);
    this.pos = new Float32Array(count * 3);
    this.dir = new Float32Array(count * 3);
    this.speed = new Float32Array(count);
    this.travelled = new Float32Array(count);
    this.left = new Float32Array(count);
    this.impactAtEnd = new Uint8Array(count);
  }

  spawn(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, lifetime: number, impactAtEnd: boolean): void {
    const i = this.ring.take(Math.min(this.cap(), this.fx.pool));
    if (i < 0) return;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.dir[i * 3] = dx; this.dir[i * 3 + 1] = dy; this.dir[i * 3 + 2] = dz;
    this.speed[i] = speed;
    this.travelled[i] = 0;
    this.left[i] = speed * lifetime;
    this.impactAtEnd[i] = impactAtEnd ? 1 : 0;
  }

  update(dt: number, world: World): void {
    for (let i = 0; i < this.left.length; i++) {
      if (this.left[i]! <= 0) continue;
      const dx = this.dir[i * 3]!, dy = this.dir[i * 3 + 1]!, dz = this.dir[i * 3 + 2]!;
      const x = this.pos[i * 3]!, y = this.pos[i * 3 + 1]!, z = this.pos[i * 3 + 2]!;
      const length = Math.min(this.speed[i]! * dt, this.left[i]!);

      if (world.raycast(x, y, z, dx, dy, dz, length, this.hit)) {
        const h = this.hit;
        this.onImpact?.(x + dx * h.distance, y + dy * h.distance, z + dz * h.distance, h.normalX, h.normalY, h.normalZ, h.index);
        this.left[i] = 0;
        continue;
      }

      this.pos[i * 3] = x + dx * length; this.pos[i * 3 + 1] = y + dy * length; this.pos[i * 3 + 2] = z + dz * length;
      this.travelled[i]! += length;
      this.left[i]! -= length;
      // A tracer that ended on a mech: sparks there, since no map box was hit.
      // Pulled back toward the shooter a little, so the flash sits on the armour rather than inside it.
      if (this.left[i]! <= 0 && this.impactAtEnd[i]) this.onMechImpact?.(this.pos[i * 3]! - dx * MECH_SKIN, this.pos[i * 3 + 1]! - dy * MECH_SKIN, this.pos[i * 3 + 2]! - dz * MECH_SKIN);
    }
  }

  draw(camera: THREE.Camera): void {
    this.streaks.begin();
    for (let i = 0; i < this.left.length; i++) {
      if (this.left[i]! <= 0) continue;
      const length = Math.min(this.fx.length, this.travelled[i]!);
      if (length <= 0) continue;
      this.streaks.along(camera, this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!, this.dir[i * 3]!, this.dir[i * 3 + 1]!, this.dir[i * 3 + 2]!, this.fx.width, length);
    }
    this.streaks.end();
  }
}
