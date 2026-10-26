import * as THREE from "three";
import { mostOf, onVfxQuality, vfxConfig, vfxLevel } from "./quality";
import { FRAMES } from "./spriteArt";
import { SpritePool, type SpriteLook } from "./sprites";

// The sprite pools every effect shares, one per palette in data/vfx.json, so the whole game's fire, smoke, dust,
// sparks and splashes cost about eight draw calls. Each pool is made at the largest size any quality level allows;
// the active level caps how many are in use.
export class FxSprites {
  readonly fire: SpritePool; // fireballs, jet flames, dash bursts
  readonly smoke: SpritePool; // thick black smoke: broken parts and blast columns
  readonly thinSmoke: SpritePool; // light grey smoke from damaged parts
  readonly dust: SpritePool; // footfalls, landings, ability dust, shockwave rings
  readonly sparks: SpritePool;
  readonly scorch: SpritePool;
  readonly teal: SpritePool; // decoys bursting, in the Arbiter's own colour
  readonly water: SpritePool; // splashes and ripples where mechs wade, land in water, or shots hit it
  private pools: SpritePool[];

  // `sun` is the world's light (Toon.toSun and look.json bandEdges), for the pools data/vfx.json lights by it.
  constructor(scene: THREE.Scene, color: (name: string) => string, scorchFade: { fadeFromMeters: number; fadeToMeters: number }, sun: SpriteLook["sun"]) {
    const { growSteps, palettes, clearFromMeters, clearToMeters, rim, rimmed, sunLit } = vfxConfig.sprites;
    const look = (palette: string, extra: Partial<SpriteLook> = {}): SpriteLook => {
      const colors = palettes[palette];
      if (!colors) throw new Error(`vfx.json: sprites.palettes needs ${palette}`);
      return {
        colors: colors as [string, string, string], growSteps, clearFromMeters, clearToMeters,
        rim: rimmed.includes(palette) ? rim : undefined, sun: sunLit.includes(palette) ? sun : undefined, ...extra,
      };
    };
    const cap = (key: string) => () => vfxLevel()[key] ?? 0;
    this.fire = new SpritePool(scene, look("fire"), color, mostOf(vfxConfig, "fire"), cap("fire"), mostOf(vfxConfig, "flames"), cap("flames"));
    this.smoke = new SpritePool(scene, look("smoke"), color, mostOf(vfxConfig, "smoke"), cap("smoke"));
    this.thinSmoke = new SpritePool(scene, look("thinSmoke"), color, mostOf(vfxConfig, "smoke"), cap("smoke"));
    this.dust = new SpritePool(scene, look("dust"), color, mostOf(vfxConfig, "dust"), cap("dust"));
    this.sparks = new SpritePool(scene, look("sparks"), color, mostOf(vfxConfig, "sparks"), cap("sparks"));
    this.scorch = new SpritePool(scene, look("scorch", { layer: "ground", ...scorchFade }), color, mostOf(vfxConfig, "scorches"), cap("scorches"));
    this.teal = new SpritePool(scene, look("teal"), color, 48, cap("sparks"));
    this.water = new SpritePool(scene, look("water"), color, mostOf(vfxConfig, "splashes"), cap("splashes"));
    this.pools = [this.fire, this.smoke, this.thinSmoke, this.dust, this.sparks, this.scorch, this.teal, this.water];
    onVfxQuality(() => { for (const p of this.pools) p.trim(); });
  }

  update(dt: number, camera: THREE.Vector3): void {
    for (const p of this.pools) p.update(dt, camera);
  }

  // A puff of dust kicked up from the ground: grows in steps, drifts up a little, dissolves.
  dustPuff(x: number, y: number, z: number, size: number, seconds: number, rise = 0.6): void {
    const s = this.dust.spawn();
    if (!s) return;
    s.x = x; s.y = y + size * 0.3; s.z = z;
    s.vy = rise; s.drag = 1.5;
    s.life = seconds;
    s.size0 = size * 0.6; s.size1 = size * 1.2;
    s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
    s.spin = Math.random() * Math.PI * 2;
    s.fadeShare = 0.6;
  }
}
