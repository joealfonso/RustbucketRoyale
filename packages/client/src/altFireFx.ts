import type * as THREE from "three";
import { hash01, stepped } from "./fx/flipbook";
import type { FxSprites } from "./fx/fxSprites";
import { vfxConfig } from "./fx/quality";
import { FRAMES } from "./fx/spriteArt";
import { AXIS, BILLBOARD, FLAT, SpritePool } from "./fx/sprites";
import type { MechModel } from "./mechModel";
import type { AltFx } from "./weaponFxData";

// What a right-click looks like on the mech itself (gate 18a), in the toon sprites every effect shares: the barrel
// glowing as an autocannon spins up or a spike charges, smoke puffing out of an overheated barrel, and sparks with a
// clamp ring round the feet of a mech pinned by a full charge. The looks are per weapon in data/weaponFx.json `alt`.

// Glows drawn at once: your own gun, and a few others' at most.
const GLOWS = 8;

interface Timers { vent: number; pin: number }

export class AltFireFx {
  private timers = new WeakMap<MechModel, Timers>();
  private muzzle = { x: 0, y: 0, z: 0, fx: 0, fz: 0 };
  // The glows have pools of their own, drawn afresh each frame, because the shared pools dissolve sprites near the
  // camera and your own barrel sits just inside that range: the glow you are watching must never be eaten away.
  private fireGlow: SpritePool;
  private sparkGlow: SpritePool;

  constructor(scene: THREE.Scene, color: (name: string) => string, private sprites: FxSprites, private looks: readonly AltFx[]) {
    const { growSteps, palettes } = vfxConfig.sprites;
    const look = (palette: string) => ({ colors: palettes[palette] as [string, string, string], growSteps });
    this.fireGlow = new SpritePool(scene, look("fire"), color, 0, () => 0, GLOWS);
    this.sparkGlow = new SpritePool(scene, look("sparks"), color, 0, () => 0, GLOWS);
  }

  // Once a frame, after every glow is placed: draws them.
  update(camera: THREE.Vector3): void {
    this.fireGlow.update(0, camera);
    this.sparkGlow.update(0, camera);
  }

  // Where a mech's barrel ends in the world as drawn, and which way it faces: the same turn as computeShot.
  private place(model: MechModel, muzzle: readonly number[]): void {
    const p = model.group.position, yaw = model.group.rotation.y;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const m = this.muzzle;
    m.x = p.x + cos * muzzle[0]! + sin * muzzle[2]!;
    m.y = p.y + muzzle[1]!;
    m.z = p.z - sin * muzzle[0]! + cos * muzzle[2]!;
    m.fx = -sin; m.fz = -cos;
  }

  private timersOf(model: MechModel): Timers {
    let t = this.timers.get(model);
    if (!t) { t = { vent: 0, pin: 0 }; this.timers.set(model, t); }
    return t;
  }

  // The barrel glow, grown in hard steps with `share` (windup or charge, 0 to 1). `full` flickers it bigger.
  // `time` is any running clock in seconds, for the flicker.
  glow(model: MechModel, muzzle: readonly number[], weapon: number, share: number, full: boolean, time: number): void {
    const g = this.looks[weapon]?.glow;
    if (!g || share <= 0 || model.dead) return;
    this.place(model, muzzle);
    const s = (g.pool === "fire" ? this.fireGlow : this.sparkGlow).draw();
    if (!s) return;
    const m = this.muzzle;
    s.mode = BILLBOARD;
    s.x = m.x + m.fx * g.forwardMeters; s.y = m.y; s.z = m.z + m.fz * g.forwardMeters;
    const flick = g.flickerFps > 0 ? Math.floor(time * g.flickerFps) : 0;
    const size = (g.sizes[0] + (g.sizes[1] - g.sizes[0]) * stepped(share, g.steps)) * (full ? g.fullFlashScale * (0.9 + 0.2 * hash01(Math.floor(time * 20))) : 1);
    s.size0 = s.size1 = size;
    const frames = g.pool === "fire" ? FRAMES.fireball : FRAMES.spark;
    s.frame0 = frames.first + (flick % frames.count);
    s.spin = hash01(flick + 7) * Math.PI * 2;
    s.fadeShare = 0;
  }

  // An overheated barrel venting: a puff of grey smoke out of the muzzle every so often, rising.
  vent(model: MechModel, muzzle: readonly number[], weapon: number, dt: number): void {
    const v = this.looks[weapon]?.vent;
    if (!v || model.dead) return;
    const t = this.timersOf(model);
    if ((t.vent -= dt) > 0) return;
    t.vent = v.everySeconds * (0.7 + Math.random() * 0.6);
    this.place(model, muzzle);
    const s = this.sprites.thinSmoke.spawn();
    if (!s) return;
    const m = this.muzzle;
    s.x = m.x; s.y = m.y; s.z = m.z;
    s.vx = m.fx * 0.8 + (Math.random() - 0.5) * 0.6; s.vy = v.rise * (0.8 + Math.random() * 0.4); s.vz = m.fz * 0.8 + (Math.random() - 0.5) * 0.6;
    s.drag = 1.2;
    s.life = v.lifeSeconds;
    s.size0 = v.size[0]; s.size1 = v.size[1];
    s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
    s.spin = Math.random() * Math.PI * 2; s.spinRate = (Math.random() - 0.5) * 1.2;
    s.fadeShare = 0.5;
  }

  // Pinned by a full charge: sparks spitting off the ground round its feet and a clamp ring biting down, pulsing.
  // `weapon` is the gun whose pin look to use (the one weapon with a pin).
  pin(model: MechModel, weapon: number, dt: number): void {
    const p = this.looks[weapon]?.pin;
    if (!p || model.dead) return;
    const t = this.timersOf(model);
    if ((t.pin -= dt) > 0) return;
    t.pin = p.everySeconds;
    const at = model.group.position;
    const ring = this.sprites.sparks.spawn();
    if (ring) {
      ring.mode = FLAT;
      ring.x = at.x; ring.y = at.y + 0.08; ring.z = at.z; ring.floor = at.y;
      ring.life = p.ringSeconds;
      ring.size0 = p.ringMeters; ring.size1 = p.ringMeters * 0.8; // biting in, not spreading out
      ring.aspect = 1;
      ring.frame0 = FRAMES.ring.first; ring.frames = FRAMES.ring.count;
      ring.fadeShare = 0.4;
    }
    for (let i = 0; i < p.sparks; i++) {
      const s = this.sprites.sparks.spawn();
      if (!s) return;
      const a = Math.random() * Math.PI * 2, r = p.ringMeters * 0.45;
      s.mode = AXIS; s.streak = 0.05;
      s.x = at.x + Math.cos(a) * r; s.y = at.y + 0.1; s.z = at.z + Math.sin(a) * r;
      s.vx = Math.cos(a) * p.sparkSpeed * 0.4; s.vy = p.sparkSpeed * (0.6 + Math.random() * 0.6); s.vz = Math.sin(a) * p.sparkSpeed * 0.4;
      s.gravity = 18; s.floor = at.y;
      s.life = 0.25 + Math.random() * 0.15;
      s.size0 = s.size1 = 0.12; s.aspect = 2;
      s.frame0 = FRAMES.spark.first;
      s.fadeShare = 0.3;
    }
  }
}

// The weapon whose `alt.pin` look draws a pin (the charge kind's), or -1 if none has one.
export function pinLookOf(looks: readonly AltFx[]): number {
  return looks.findIndex((l) => l.pin !== undefined);
}
