import type { AbilityStats } from "@rustbucket/shared";
import type { Explosions } from "./fx/explosion";
import type { FxSprites } from "./fx/fxSprites";
import { vfxShare } from "./fx/quality";
import { AXIS } from "./fx/sprites";
import { FRAMES } from "./fx/spriteArt";

export interface AbilityFxConfig {
  // Kicked up round the feet when a ram or leap starts.
  dust: { puffs: number; spreadMeters: number; meters: number; seconds: number };
  // A pounce landing: a shockwave ring on the ground as wide as the slam reaches, dust thrown out inside it and a few
  // chunks of ground flung up.
  slam: { ringSeconds: number; puffs: number; puffSpread: number; debris: number; debrisSpeed: number; shakeForce: number; shakeRadius: number };
  // A ram or slam connecting with somebody: a hot burst and a spray of sparks.
  hit: { flashMeters: number; flashSeconds: number; sparks: number; shakeForce: number; shakeRadius: number };
  // The ring on the ground where a mortar strike will land (mortarWarning.ts). Opacity pulses between the two.
  warning: { ringColor: string; opacity: number; minOpacity: number; pulsesPerSecond: number; ringWidth: number; whistleLeadSeconds: number };
  // A decoy bursting: sparks round where it stood and a flash in the middle, `heightMeters` up its body, in the
  // teal palette of data/vfx.json.
  fizz: { sparks: number; sparkMeters: number; spreadMeters: number; sparkSeconds: number; flashMeters: number; flashSeconds: number; heightMeters: number };
  // How the Arbiter's own decoys look to the Arbiter (ghostLook.ts): see-through and tinted, so it never loses itself.
  ghost: { opacity: number; tint: string; tintStrength: number };
}

export function parseAbilityFx(raw: unknown): AbilityFxConfig {
  const d = raw as Record<string, Record<string, unknown> | undefined>;
  const check = (group: string, numbers: string[], colors: string[]) => {
    const g = d?.[group];
    for (const k of numbers) if (typeof g?.[k] !== "number" || !Number.isFinite(g[k]) || (g[k] as number) < 0) throw new Error(`abilityFx.json: ${group}.${k} must be a number, 0 or more`);
    for (const k of colors) if (typeof g?.[k] !== "string") throw new Error(`abilityFx.json: ${group}.${k} must be a palette name`);
  };
  check("dust", ["puffs", "spreadMeters", "meters", "seconds"], []);
  check("slam", ["ringSeconds", "puffs", "puffSpread", "debris", "debrisSpeed", "shakeForce", "shakeRadius"], []);
  check("hit", ["flashMeters", "flashSeconds", "sparks", "shakeForce", "shakeRadius"], []);
  check("warning", ["opacity", "minOpacity", "pulsesPerSecond", "ringWidth", "whistleLeadSeconds"], ["ringColor"]);
  check("fizz", ["sparks", "sparkMeters", "spreadMeters", "sparkSeconds", "flashMeters", "flashSeconds", "heightMeters"], []);
  check("ghost", ["opacity", "tintStrength"], ["tint"]);
  if (!((d.warning!.ringWidth as number) > 0 && (d.warning!.ringWidth as number) < 1)) throw new Error("abilityFx.json: warning.ringWidth must be between 0 and 1");
  return raw as AbilityFxConfig;
}

// What happened to a mech's ability over one sim step, from its ability time before and after: it started, or a
// pounce came down. A ram just runs out, which needs nothing shown.
export function abilityMoment(before: number, after: number, kind: AbilityStats["kind"] | undefined): "start" | "land" | null {
  if (before <= 0 && after > 0) return "start";
  if (before > 0 && after <= 0 && kind === "pounce") return "land";
  return null;
}

const GOLDEN_ANGLE = 2.39996; // spreads the sparks evenly round the burst without a random number

// Dust, slam shockwaves, hit bursts and decoy fizzes for the Q abilities, all from the shared sprite pools and the
// explosion's ring and chunks, so nothing is made here. Sizes and lifetimes are in data/abilityFx.json.
export class AbilityFx {
  constructor(private sprites: FxSprites, private explosions: Explosions, private config: AbilityFxConfig) {}

  // A ram or leap pushing off: a ring of dust round the feet.
  start(x: number, y: number, z: number): void {
    const { puffs, spreadMeters, seconds } = this.config.dust;
    this.puffRing(x, y, z, puffs, spreadMeters, seconds);
  }

  // A pounce coming down. `radius` is how far its slam reaches; 0 when that is not known, which leaves out the ring.
  slam(x: number, y: number, z: number, radius: number): void {
    const s = this.config.slam;
    this.puffRing(x, y, z, s.puffs, Math.max(1, radius * s.puffSpread), this.config.dust.seconds);
    this.explosions.ring(x, y, z, radius, s.ringSeconds);
    this.explosions.fling(x, y + 0.2, z, y, Math.round(s.debris * vfxShare("blastDebris")), s.debrisSpeed);
  }

  hit(x: number, y: number, z: number): void {
    const h = this.config.hit;
    this.explosions.pop(x, y, z, h.flashMeters * 2, h.flashSeconds, h.sparks);
  }

  // A decoy bursting where it stood (x, y, z at its feet).
  fizz(x: number, y: number, z: number): void {
    const f = this.config.fizz;
    const middle = y + f.heightMeters;
    const flash = this.sprites.teal.spawn();
    if (flash) {
      flash.x = x; flash.y = middle; flash.z = z;
      flash.life = f.flashSeconds;
      flash.size0 = f.flashMeters; flash.size1 = f.flashMeters * 2;
      flash.frame0 = FRAMES.fireball.first; flash.frames = FRAMES.fireball.count;
    }
    for (let i = 0; i < f.sparks; i++) {
      const s = this.sprites.teal.spawn();
      if (!s) break;
      // Points spread over a ball: heights evenly from bottom to top, turned by the golden angle each time. Each
      // spark flies outwards from the middle, so the decoy reads as popping, not fading.
      const up = f.sparks > 1 ? (i / (f.sparks - 1)) * 2 - 1 : 0;
      const across = Math.sqrt(1 - up * up);
      const angle = i * GOLDEN_ANGLE;
      const speed = f.spreadMeters / f.sparkSeconds;
      s.mode = AXIS; s.streak = f.sparkSeconds * 0.3;
      s.x = x; s.y = middle; s.z = z;
      s.vx = Math.cos(angle) * across * speed; s.vy = up * speed; s.vz = Math.sin(angle) * across * speed;
      s.life = f.sparkSeconds;
      s.size0 = s.size1 = f.sparkMeters; s.aspect = 2;
      s.frame0 = FRAMES.spark.first;
      s.fadeShare = 0.4;
    }
  }

  private puffRing(x: number, y: number, z: number, count: number, spread: number, seconds: number): void {
    const size = this.config.dust.meters;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      this.sprites.dustPuff(x + Math.cos(angle) * spread, y, z + Math.sin(angle) * spread, size, seconds);
    }
  }
}
