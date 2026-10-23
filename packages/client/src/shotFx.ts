import * as THREE from "three";
import type { Shot, WeaponStats, World } from "@rustbucket/shared";
import { ImpactFx } from "./impactFx";
import { MuzzleFlashes } from "./muzzleFlash";
import { Projectiles } from "./projectiles";
import { capFor, usesAltLook, weaponFxFor, type WeaponFx, type WeaponFxConfig } from "./weaponFxData";

// Shows a shot: the muzzle flash, the tracer, and the impact where it lands, each in the look of the weapon that
// fired it (data/weaponFx.json). Used for our own shots and for shots the server says others fired.
export class ShotFx {
  private fx: WeaponFx[];
  private altFx: WeaponFx[]; // each weapon's right-click look (gate 18a)
  private tracers: Projectiles[];
  private altTracers: Projectiles[];
  private flashes: MuzzleFlashes;
  private altFlashes: MuzzleFlashes;
  readonly impacts: ImpactFx;
  // Called where a bullet hits the map, for the sound; with the weapon (index in weapons.json) and the face it hit,
  // so the style test page can stick a rivet there.
  onImpact?: (x: number, y: number, z: number, weapon: number, nx: number, ny: number, nz: number) => void;
  // Called where a bullet the shooter was told hit a mech arrives (the style page's firing range sticks rivets there).
  onMechImpact?: (x: number, y: number, z: number, weapon: number) => void;
  // Called where a bullet goes into the water, for the splash and its sound.
  onWater?: (x: number, y: number, z: number) => void;

  // `quality` is read on every spawn (the effects setting can change mid match); "low" keeps data's lowShare of each pool.
  constructor(
    scene: THREE.Scene, config: WeaponFxConfig, private weapons: readonly WeaponStats[], color: (name: string) => string,
    growSteps: number, quality: () => string,
  ) {
    const looks = weaponFxFor(config, weapons);
    this.fx = looks;
    this.altFx = looks.map((l) => l.alt);
    const cap = (pool: number) => capFor(pool, quality(), config.lowShare);
    const colors = weapons.map((w) => color(w.color));
    this.flashes = new MuzzleFlashes(scene, this.fx, colors, color, cap);
    this.altFlashes = new MuzzleFlashes(scene, this.altFx, colors, color, cap);
    this.impacts = new ImpactFx(scene, config, color, growSteps, cap);
    this.tracers = this.makeTracers(scene, this.fx, color, cap);
    this.altTracers = this.makeTracers(scene, this.altFx, color, cap);
  }

  private makeTracers(scene: THREE.Scene, looks: WeaponFx[], color: (name: string) => string, cap: (pool: number) => number): Projectiles[] {
    return looks.map((fx, i) => {
      const tracer = new Projectiles(scene, fx.tracer, color(this.weapons[i]!.color), color(fx.tracer.core), () => cap(fx.tracer.pool));
      tracer.onImpact = (x, y, z, nx, ny, nz, box) => {
        this.impacts.world(fx.impact, x, y, z, nx, ny, nz, box);
        this.onImpact?.(x, y, z, i, nx, ny, nz);
      };
      tracer.onMechImpact = (x, y, z) => { this.impacts.mech(fx.impact, x, y, z); this.onMechImpact?.(x, y, z, i); };
      tracer.onWater = (x, y, z) => this.onWater?.(x, y, z);
      return tracer;
    });
  }

  // `weapon` is the index in weapons.json; anything unknown (a shooter we have not seen yet) draws as the first.
  // The tracer lives just long enough to reach where the shot ended, so it lands when the hit does.
  // `alt` is -1 for a primary shot, or the right-click shot's share (1 for a slug or a full charge).
  show(shot: Shot, weapon: number, hitMech = false, alt = -1): void {
    const w = this.tracers[weapon] ? weapon : 0;
    const stats = this.weapons[w]!;
    const lifetime = Math.min(stats.projectileLifetime, shot.length / stats.projectileSpeed);
    const altLook = usesAltLook(stats.secondary.kind, alt);
    (altLook ? this.altTracers : this.tracers)[w]!.spawn(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, stats.projectileSpeed, lifetime, hitMech);
    (altLook ? this.altFlashes : this.flashes).spawn(w, shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz);
  }

  // The server says one of our shots hit a mech here.
  hitMech(x: number, y: number, z: number, weapon: number, alt = -1): void {
    const w = this.fx[weapon] ? weapon : 0;
    const look = usesAltLook(this.weapons[w]!.secondary.kind, alt) ? this.altFx[w]! : this.fx[w]!;
    this.impacts.mech(look.impact, x, y, z);
  }

  // On the sim clock: bullets fly and hit things, flipbooks count their frames.
  update(dt: number, world: World): void {
    for (const t of this.tracers) t.update(dt, world);
    for (const t of this.altTracers) t.update(dt, world);
    this.flashes.update(dt);
    this.altFlashes.update(dt);
    this.impacts.update(dt);
  }

  // Once a frame, just before rendering, with the camera where it will be drawn from.
  draw(camera: THREE.Camera, dt: number): void {
    camera.updateMatrixWorld();
    for (const t of this.tracers) t.draw(camera);
    for (const t of this.altTracers) t.draw(camera);
    this.flashes.draw(camera);
    this.altFlashes.draw(camera);
    this.impacts.draw(camera, dt);
  }
}
