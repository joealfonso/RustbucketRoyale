import * as THREE from "three";
import type { Shot, WeaponStats, World } from "@rustbucket/shared";
import { ImpactFx } from "./impactFx";
import { MuzzleFlashes } from "./muzzleFlash";
import { Projectiles } from "./projectiles";
import { capFor, weaponFxFor, type WeaponFx, type WeaponFxConfig } from "./weaponFxData";

// Shows a shot: the muzzle flash, the tracer, and the impact where it lands, each in the look of the weapon that
// fired it (data/weaponFx.json). Used for our own shots and for shots the server says others fired.
export class ShotFx {
  private fx: WeaponFx[];
  private tracers: Projectiles[];
  private flashes: MuzzleFlashes;
  readonly impacts: ImpactFx;
  // Called where a bullet hits the map, for the sound.
  onImpact?: (x: number, y: number, z: number) => void;
  // Called where a bullet goes into the water, for the splash and its sound.
  onWater?: (x: number, y: number, z: number) => void;

  // `quality` is read on every spawn (the effects setting can change mid match); "low" keeps data's lowShare of each pool.
  constructor(
    scene: THREE.Scene, config: WeaponFxConfig, private weapons: readonly WeaponStats[], color: (name: string) => string,
    growSteps: number, quality: () => string,
  ) {
    this.fx = weaponFxFor(config, weapons);
    const cap = (pool: number) => capFor(pool, quality(), config.lowShare);
    this.flashes = new MuzzleFlashes(scene, this.fx, weapons.map((w) => color(w.color)), color, cap);
    this.impacts = new ImpactFx(scene, config, color, growSteps, cap);
    this.tracers = this.fx.map((fx, i) => {
      const tracer = new Projectiles(scene, fx.tracer, color(weapons[i]!.color), color(fx.tracer.core), () => cap(fx.tracer.pool));
      tracer.onImpact = (x, y, z, nx, ny, nz, box) => {
        this.impacts.world(fx.impact, x, y, z, nx, ny, nz, box);
        this.onImpact?.(x, y, z);
      };
      tracer.onMechImpact = (x, y, z) => this.impacts.mech(fx.impact, x, y, z);
      tracer.onWater = (x, y, z) => this.onWater?.(x, y, z);
      return tracer;
    });
  }

  // `weapon` is the index in weapons.json; anything unknown (a shooter we have not seen yet) draws as the first.
  // The tracer lives just long enough to reach where the shot ended, so it lands when the hit does.
  show(shot: Shot, weapon: number, hitMech = false): void {
    const w = this.tracers[weapon] ? weapon : 0;
    const stats = this.weapons[w]!;
    const lifetime = Math.min(stats.projectileLifetime, shot.length / stats.projectileSpeed);
    this.tracers[w]!.spawn(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, stats.projectileSpeed, lifetime, hitMech);
    this.flashes.spawn(w, shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz);
  }

  // The server says one of our shots hit a mech here.
  hitMech(x: number, y: number, z: number, weapon: number): void {
    this.impacts.mech((this.fx[weapon] ?? this.fx[0]!).impact, x, y, z);
  }

  // On the sim clock: bullets fly and hit things, flipbooks count their frames.
  update(dt: number, world: World): void {
    for (const t of this.tracers) t.update(dt, world);
    this.flashes.update(dt);
    this.impacts.update(dt);
  }

  // Once a frame, just before rendering, with the camera where it will be drawn from.
  draw(camera: THREE.Camera, dt: number): void {
    camera.updateMatrixWorld();
    for (const t of this.tracers) t.draw(camera);
    this.flashes.draw(camera);
    this.impacts.draw(camera, dt);
  }
}
