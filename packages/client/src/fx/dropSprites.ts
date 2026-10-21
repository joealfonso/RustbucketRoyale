import type * as THREE from "three";
import { vfxConfig, vfxShare } from "./quality";
import { SpritePool } from "./sprites";

// The inked sprite pools of the drop-in (gate 16b, data/dive.json "toon"): chunky smoke puffs, toon fire, dust and
// comic speed streaks, each with a hand-drawn outline so the whole drop reads like a cel-shaded cartoon. They are
// pools of their own rather than ink on the shared ones, so explosions and damage smoke keep their look; each costs
// one draw call while anything in it is alive and none otherwise.

export interface InkedPoolConfig {
  colors: [string, string, string]; // light, mid, dark band
  ink: string;
  inkWidth: number; // 0 to 1 of the sheet's INK_SPAN
  holeWidth: number; // 0 to 1: the inked rim round holes as a puff dissolves
  capacity: number; // at the most generous effects quality; a lower level scales it down like the shared smoke
  immediate: number; // one-frame sprites (flames, streaks), placed afresh every frame
}

export interface DropSpritesConfig {
  growSteps: number;
  smoke: InkedPoolConfig;
  fire: InkedPoolConfig;
  dust: InkedPoolConfig;
  streaks: InkedPoolConfig;
}

const POOLS = ["smoke", "fire", "dust", "streaks"] as const;

export function parseDropSprites(raw: unknown): DropSpritesConfig {
  const d = raw as Record<string, Record<string, unknown> | undefined> | undefined;
  if (typeof d?.growSteps !== "number" || d.growSteps < 0) throw new Error("dive.json: toon.growSteps must be a number, 0 or more");
  for (const name of POOLS) {
    const p = d[name];
    const colors = p?.colors;
    if (!Array.isArray(colors) || colors.length !== 3 || !colors.every((c) => typeof c === "string")) throw new Error(`dive.json: toon.${name}.colors must be three colour names`);
    if (typeof p!.ink !== "string") throw new Error(`dive.json: toon.${name}.ink must be a colour name`);
    for (const key of ["inkWidth", "holeWidth"]) {
      const v = p![key];
      if (typeof v !== "number" || !(v >= 0 && v <= 1)) throw new Error(`dive.json: toon.${name}.${key} must be 0 to 1`);
    }
    for (const key of ["capacity", "immediate"]) {
      const v = p![key];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`dive.json: toon.${name}.${key} must be a whole number, 0 or more`);
    }
  }
  return raw as DropSpritesConfig;
}

export class DropSprites {
  readonly smoke: SpritePool; // trail puffs, engine exhaust, cannon smoke
  readonly fire: SpritePool; // retro-jet and shell flames, the cannon flash, the shell bursting
  readonly dust: SpritePool; // landing dust, its ring and shockwave
  readonly streaks: SpritePool; // speed lines, one frame at a time
  private pools: SpritePool[];

  constructor(scene: THREE.Scene, color: (name: string) => string, config: DropSpritesConfig) {
    // Streaks fly past close to the camera on purpose; everything else dissolves near it like the shared smoke.
    const make = (p: InkedPoolConfig, share: string, clear = true) => new SpritePool(
      scene,
      { colors: p.colors, growSteps: config.growSteps, clearFromMeters: clear ? vfxConfig.sprites.clearFromMeters : 0, clearToMeters: clear ? vfxConfig.sprites.clearToMeters : 0, ink: { color: p.ink, width: p.inkWidth, holeWidth: p.holeWidth } },
      color, p.capacity, () => Math.round(p.capacity * vfxShare(share)), p.immediate,
    );
    this.smoke = make(config.smoke, "smoke");
    this.fire = make(config.fire, "fire");
    this.dust = make(config.dust, "dust");
    this.streaks = make(config.streaks, "smoke", false);
    this.pools = [this.smoke, this.fire, this.dust, this.streaks];
  }

  update(dt: number, camera: THREE.Vector3): void {
    for (const p of this.pools) p.update(dt, camera);
  }
}
