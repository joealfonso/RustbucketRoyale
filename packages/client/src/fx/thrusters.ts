import type { MechModel } from "../mechModel";
import { hash01 } from "./flipbook";
import type { FxSprites } from "./fxSprites";
import { AXIS } from "./sprites";
import { FRAMES } from "./spriteArt";

// Jet looks, from data/thrusterFx.json: a flame under each nozzle while jetting, a burst out of the back on a dash or
// a ram, a hot puff of dust under a hard landing. Nozzles are per mech kit, in the mech's own frame (forward is -z).
export interface ThrusterFxConfig {
  flame: { length: number; width: number; flicker: number; framesPerSecond: number; risingBoost: number; risingSpeed: number; tilt: [number, number, number] };
  burst: { puffs: number; speed: number; size: number; seconds: number; spread: number; drag: number };
  landing: { minAirSeconds: number; minFallSpeed: number; puffs: number; spread: number; size: number; seconds: number; hotPuffs: number };
  nozzles: Record<string, [number, number, number][]>;
}

export function parseThrusterFx(raw: unknown): ThrusterFxConfig {
  const d = raw as Record<string, Record<string, unknown> | undefined>;
  const numbers = (group: string, keys: string[]) => {
    for (const k of keys) if (typeof d?.[group]?.[k] !== "number" || !Number.isFinite(d[group]![k]) || (d[group]![k] as number) < 0) throw new Error(`thrusterFx.json: ${group}.${k} must be a number, 0 or more`);
  };
  numbers("flame", ["length", "width", "flicker", "framesPerSecond", "risingBoost", "risingSpeed"]);
  numbers("burst", ["puffs", "speed", "size", "seconds", "spread", "drag"]);
  numbers("landing", ["minAirSeconds", "minFallSpeed", "puffs", "spread", "size", "seconds", "hotPuffs"]);
  const point = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number");
  if (!point(d.flame?.tilt)) throw new Error("thrusterFx.json: flame.tilt must be [x, y, z]");
  const nozzles = d.nozzles as Record<string, unknown> | undefined;
  if (!Array.isArray(nozzles?.default)) throw new Error("thrusterFx.json: nozzles needs a default");
  for (const [id, list] of Object.entries(nozzles)) if (!Array.isArray(list) || !list.every(point)) throw new Error(`thrusterFx.json: nozzles.${id} must be a list of [x, y, z]`);
  return raw as ThrusterFxConfig;
}

// How long a jet flame is: nothing with the jets off, longer while climbing hard, and flickering in hard steps
// (a fresh random length each flipbook frame, the same one all through that frame).
export function flameLength(flame: ThrusterFxConfig["flame"], jetting: boolean, vy: number, seconds: number, seed = 0): number {
  if (!jetting) return 0;
  const climb = Math.max(0, Math.min(1, vy / Math.max(0.01, flame.risingSpeed)));
  const step = Math.floor(seconds * flame.framesPerSecond);
  const flicker = (hash01(step * 31 + seed) * 2 - 1) * flame.flicker;
  return flame.length * (1 + flame.risingBoost * climb) * (1 + flicker);
}

interface JetState { air: number; lowest: number; dashing: boolean; grounded: boolean }

export class Thrusters {
  private states = new WeakMap<MechModel, JetState>(); // per mech drawn; goes with the model
  private time = 0;
  // A hard landing at a mech's feet. Returns true when it was shown some other way (a splash in water), for no dust.
  onLanding?: (x: number, y: number, z: number) => boolean;

  constructor(private sprites: FxSprites, private config: ThrusterFxConfig) {}

  // Once a frame, before any mech is driven.
  tick(dt: number): void {
    this.time += dt;
  }

  // One mech this frame: whether its jets fire, whether it is dashing (or ramming), whether it is on the ground, and
  // how fast it rises.
  drive(model: MechModel, jetting: boolean, dashing: boolean, grounded: boolean, vy: number, dt: number): void {
    let state = this.states.get(model);
    if (!state) {
      state = { air: 0, lowest: 0, dashing, grounded };
      this.states.set(model, state);
    }
    const nozzles = this.config.nozzles[model.gaitId] ?? this.config.nozzles.default!;
    const p = model.group.position, yaw = model.group.rotation.y, drop = model.body.position.y;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const { flame, burst } = this.config;

    if (jetting && !model.dead) {
      const [tx, ty, tz] = flame.tilt;
      for (let i = 0; i < nozzles.length; i++) {
        const length = flameLength(flame, true, vy, this.time, i);
        const s = this.sprites.fire.draw();
        if (!s) break;
        const [nx, ny, nz] = nozzles[i]!;
        s.mode = AXIS;
        s.x = p.x + nx * cos + nz * sin; s.y = p.y + ny + drop; s.z = p.z - nx * sin + nz * cos;
        s.ax = tx * cos + tz * sin; s.ay = ty; s.az = -tx * sin + tz * cos;
        s.size0 = s.size1 = flame.width; s.aspect = length / flame.width;
        s.frame0 = FRAMES.flame.first; s.frames = FRAMES.flame.count; s.fps = flame.framesPerSecond;
        s.age = this.time + i * 0.37; // the nozzles flicker out of step with each other
      }
    }

    if (dashing && !state.dashing && !model.dead) {
      // Out of the back: forward is -z in the mech's frame, so back in the world is (sin, 0, cos) of its yaw.
      for (const [nx, ny, nz] of nozzles) {
        for (let i = 0; i < burst.puffs; i++) {
          const s = this.sprites.fire.spawn();
          if (!s) break;
          const out = burst.speed * (0.6 + Math.random() * 0.6);
          s.x = p.x + nx * cos + nz * sin; s.y = p.y + ny + drop; s.z = p.z - nx * sin + nz * cos;
          s.vx = sin * out + (Math.random() - 0.5) * burst.spread * out; s.vy = (Math.random() - 0.3) * burst.spread * out; s.vz = cos * out + (Math.random() - 0.5) * burst.spread * out;
          s.drag = burst.drag;
          s.age = -i * 0.03;
          s.life = burst.seconds;
          s.size0 = burst.size * 0.5; s.size1 = burst.size;
          s.frame0 = FRAMES.fireball.first; s.frames = FRAMES.fireball.count;
          s.spin = Math.random() * Math.PI * 2;
        }
      }
    }
    state.dashing = dashing;

    if (!grounded) {
      state.air += dt;
      state.lowest = Math.min(state.lowest, vy);
    } else {
      if (!state.grounded) this.land(model, state);
      state.air = 0; state.lowest = 0;
    }
    state.grounded = grounded;
  }

  private land(model: MechModel, state: JetState): void {
    const { landing } = this.config;
    if (model.dead || state.air < landing.minAirSeconds || -state.lowest < landing.minFallSpeed) return;
    const p = model.group.position;
    if (this.onLanding?.(p.x, p.y, p.z)) return;
    for (let i = 0; i < landing.puffs; i++) {
      const angle = (i / landing.puffs) * Math.PI * 2 + Math.random() * 0.4;
      this.sprites.dustPuff(p.x + Math.cos(angle) * landing.spread, p.y, p.z + Math.sin(angle) * landing.spread, landing.size, landing.seconds);
    }
    // A puff or two still hot from the jets, in the middle.
    for (let i = 0; i < landing.hotPuffs; i++) {
      const s = this.sprites.fire.spawn();
      if (!s) break;
      s.x = p.x + (Math.random() - 0.5); s.y = p.y + 0.3; s.z = p.z + (Math.random() - 0.5);
      s.vy = 1;
      s.life = landing.seconds * 0.6;
      s.size0 = landing.size * 0.5; s.size1 = landing.size;
      s.frame0 = FRAMES.fireball.first + 1; s.frames = FRAMES.fireball.count - 1;
      s.spin = Math.random() * Math.PI * 2;
    }
  }
}
