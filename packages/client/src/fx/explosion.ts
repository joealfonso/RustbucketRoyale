import * as THREE from "three";
import type { Terrain } from "@rustbucket/shared";
import { groundTilt } from "../groundTilt";
import type { ChunkPhysics, Debris } from "./debris";
import type { FxSprites } from "./fxSprites";
import { vfxLevel } from "./quality";
import { AXIS, FLAT } from "./sprites";
import { FRAMES } from "./spriteArt";

// The look of a blast, from data/explosionFx.json. Every size is per metre of the blast's reach, so a mortar shell,
// a grenade and a barrel each come out as big as the damage they do.
export interface ExplosionFxConfig {
  fireball: { sizePerMeter: number; seconds: number; startShare: number; lift: number; riseSpeed: number; drag: number; blobSpread: number; blobSize: number; blobDelaySeconds: number; fadeShare: number };
  flash: { intensity: number; seconds: number; meters: number; color: string };
  ring: { radiusPerMeter: number; seconds: number; startShare: number; lift: number };
  smoke: { sizePerMeter: number; growth: number; seconds: number; riseSpeed: number; drag: number; afterFireShare: number; spreadPerMeter: number; delaySeconds: number; startShade: number; endShade: number; fadeShare: number };
  debris: { speedPerMeter: number; lift: number; size: number; seconds: number; colors: string[] };
  // The spray from a hard hit (pop): streaks flung out and up, falling.
  sparks: { speed: number; lift: number; gravity: number; seconds: number; size: number; streakSeconds: number; fadeShare: number };
  scorch: { sizePerMeter: number; seconds: number; fadeShare: number; fadeFromMeters: number; fadeToMeters: number; lift: number };
  chunks: ChunkPhysics;
}

export function parseExplosionFx(raw: unknown): ExplosionFxConfig {
  const d = raw as Record<string, Record<string, unknown> | undefined>;
  const numbers = (group: string, keys: string[]) => {
    for (const k of keys) if (typeof d?.[group]?.[k] !== "number" || !Number.isFinite(d[group]![k]) || (d[group]![k] as number) < 0) throw new Error(`explosionFx.json: ${group}.${k} must be a number, 0 or more`);
  };
  numbers("fireball", ["sizePerMeter", "seconds", "startShare", "lift", "riseSpeed", "drag", "blobSpread", "blobSize", "blobDelaySeconds", "fadeShare"]);
  numbers("flash", ["intensity", "seconds", "meters"]);
  numbers("ring", ["radiusPerMeter", "seconds", "startShare", "lift"]);
  numbers("smoke", ["sizePerMeter", "growth", "seconds", "riseSpeed", "drag", "afterFireShare", "spreadPerMeter", "delaySeconds", "startShade", "endShade", "fadeShare"]);
  numbers("sparks", ["speed", "lift", "gravity", "seconds", "size", "streakSeconds", "fadeShare"]);
  numbers("debris", ["speedPerMeter", "lift", "size", "seconds"]);
  numbers("scorch", ["sizePerMeter", "seconds", "fadeShare", "fadeFromMeters", "fadeToMeters", "lift"]);
  numbers("chunks", ["gravity", "bounce", "friction", "spin", "sinkShare"]);
  if (!Array.isArray(d.debris?.colors) || d.debris.colors.length === 0) throw new Error("explosionFx.json: debris.colors needs at least one colour");
  return raw as ExplosionFxConfig;
}

// Explosions as a layered toon blast: a flipbook fireball with a few lumps round it, a flat shockwave ring on the
// ground, a column of smoke puffs that rise and darken, chunks flung out, a scorch mark left behind, and a short flash
// of light on everything nearby. All of it from the shared pools; nothing is made per explosion.
export class Explosions {
  private light: THREE.PointLight;
  private lightAge: number;
  private chunkColors: THREE.Color[];
  private terrain: Terrain | null = null;
  private tilt = { x: 0, z: 0 };
  private normal = [0, 1, 0];

  constructor(scene: THREE.Scene, private sprites: FxSprites, private debris: Debris, private config: ExplosionFxConfig, color: (name: string) => string) {
    this.light = new THREE.PointLight(color(config.flash.color), 0, config.flash.meters, 1.5);
    this.lightAge = config.flash.seconds;
    scene.add(this.light);
    this.chunkColors = config.debris.colors.map((c) => new THREE.Color(color(c)));
  }

  // The hills of the map being played, so rings and scorches lie along the slope. Null for level ground.
  setTerrain(terrain: Terrain | null): void {
    this.terrain = terrain;
  }

  // A blast reaching `radius` metres, centred at (x, y, z), over ground at height `floor`.
  blast(x: number, y: number, z: number, radius: number, floor: number): void {
    const level = vfxLevel();
    const { fireball, smoke, debris, scorch } = this.config;
    const size = radius * fireball.sizePerMeter * 2;
    const lumps = Math.max(1, level.blastBlobs ?? 1);
    for (let i = 0; i < lumps; i++) {
      const s = this.sprites.fire.spawn();
      if (!s) break;
      // The first is the main ball; the rest are smaller lumps round it, a beat later, so it bulges unevenly.
      const lump = i > 0;
      const angle = Math.random() * Math.PI * 2, out = lump ? size * fireball.blobSpread : 0;
      const width = lump ? size * fireball.blobSize : size;
      s.x = x + Math.cos(angle) * out; s.y = y + size * fireball.lift + (lump ? (Math.random() - 0.3) * out : 0); s.z = z + Math.sin(angle) * out;
      s.vy = fireball.riseSpeed; s.drag = fireball.drag;
      s.age = lump ? -i * fireball.blobDelaySeconds : 0;
      s.life = fireball.seconds * (lump ? 0.8 : 1);
      s.size0 = width * fireball.startShare; s.size1 = width;
      s.frame0 = FRAMES.fireball.first; s.frames = FRAMES.fireball.count;
      s.spin = Math.random() * Math.PI * 2;
      s.fadeShare = fireball.fadeShare;
    }
    this.ring(x, floor, z, radius);

    const puffs = level.blastSmoke ?? 0;
    for (let i = 0; i < puffs; i++) {
      const s = this.sprites.smoke.spawn();
      if (!s) break;
      const spread = radius * smoke.spreadPerMeter;
      const width = radius * smoke.sizePerMeter;
      s.x = x + (Math.random() - 0.5) * spread * 2; s.y = y + size * 0.4; s.z = z + (Math.random() - 0.5) * spread * 2;
      // Later puffs start lower in the column and rise slower, so the column stands rather than all leaving at once.
      s.vy = smoke.riseSpeed * (1 - (i / Math.max(1, puffs)) * 0.5); s.drag = smoke.drag;
      s.age = -fireball.seconds * smoke.afterFireShare - i * smoke.delaySeconds;
      s.life = smoke.seconds * (0.8 + Math.random() * 0.4);
      s.size0 = width; s.size1 = width * smoke.growth;
      s.frame0 = FRAMES.smoke.first + (i % FRAMES.smoke.count);
      s.shade0 = smoke.startShade; s.shade1 = smoke.endShade;
      s.fadeShare = smoke.fadeShare;
      s.spin = Math.random() * Math.PI * 2; s.spinRate = (Math.random() - 0.5) * 0.6;
    }

    this.fling(x, y + 0.3, z, floor, level.blastDebris ?? 0, radius * debris.speedPerMeter);

    if ((level.blastScorch ?? 0) > 0) {
      const s = this.sprites.scorch.spawn();
      if (s) {
        s.mode = FLAT;
        s.x = x; s.y = floor + scorch.lift; s.z = z;
        groundTilt(this.terrain, x, z, floor, this.tilt, this.normal);
        s.tiltX = this.tilt.x; s.tiltZ = this.tilt.z;
        s.life = scorch.seconds;
        s.size0 = s.size1 = radius * scorch.sizePerMeter * 2;
        s.frame0 = FRAMES.scorch.first + Math.floor(Math.random() * FRAMES.scorch.count);
        s.spin = Math.random() * Math.PI * 2;
        s.fadeShare = scorch.fadeShare;
      }
    }

    this.light.position.set(x, y + 2, z);
    this.lightAge = 0;
  }

  // Chunks of scrap thrown out of a point at about `speed` metres a second.
  fling(x: number, y: number, z: number, floor: number, count: number, speed: number): void {
    const { debris } = this.config;
    if (count > 0) this.debris.throw(x, y, z, floor, count, speed, debris.lift, debris.size, debris.seconds, this.chunkColors);
  }

  // A shockwave ring on the ground, as wide as `radius` reaches: for blasts, and alone for a pounce slam.
  ring(x: number, floor: number, z: number, radius: number, seconds = this.config.ring.seconds): void {
    const { ring } = this.config;
    if (radius <= 0) return;
    const s = this.sprites.dust.spawn();
    if (!s) return;
    s.mode = FLAT;
    s.x = x; s.y = floor + ring.lift; s.z = z;
    groundTilt(this.terrain, x, z, floor, this.tilt, this.normal);
    s.tiltX = this.tilt.x; s.tiltZ = this.tilt.z;
    s.life = seconds;
    const width = radius * ring.radiusPerMeter * 2;
    s.size0 = width * ring.startShare; s.size1 = width;
    s.frame0 = FRAMES.ring.first; s.frames = FRAMES.ring.count;
    s.spin = Math.random() * Math.PI * 2;
  }

  // A small hot burst with a spray of sparks: something hit hard (a ram or a slam connecting).
  pop(x: number, y: number, z: number, size: number, seconds: number, sparks: number): void {
    const s = this.sprites.fire.spawn();
    if (s) {
      s.x = x; s.y = y; s.z = z;
      s.life = seconds;
      s.size0 = size * 0.5; s.size1 = size;
      s.frame0 = FRAMES.fireball.first; s.frames = FRAMES.fireball.count;
      s.spin = Math.random() * Math.PI * 2;
    }
    const k = this.config.sparks;
    for (let i = 0; i < sparks; i++) {
      const p = this.sprites.sparks.spawn();
      if (!p) break;
      const angle = Math.random() * Math.PI * 2, out = k.speed * (0.6 + Math.random() * 0.6);
      p.mode = AXIS; p.streak = k.streakSeconds;
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(angle) * out; p.vy = Math.random() * k.lift; p.vz = Math.sin(angle) * out;
      p.gravity = k.gravity;
      p.life = k.seconds * (0.7 + Math.random() * 0.5);
      p.size0 = p.size1 = k.size; p.aspect = 2;
      p.frame0 = FRAMES.spark.first;
      p.fadeShare = k.fadeShare;
    }
  }

  update(dt: number): void {
    const { intensity, seconds } = this.config.flash;
    this.lightAge += dt;
    this.light.intensity = this.lightAge < seconds ? intensity * (1 - this.lightAge / seconds) : 0;
  }
}
