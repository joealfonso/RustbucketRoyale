import * as THREE from "three";
import type { Debris } from "../fx/debris";
import type { FxSprites } from "../fx/fxSprites";
import { vfxShare } from "../fx/quality";

export interface PropFxConfig {
  chunks: number; // pieces thrown when a prop breaks, on the most generous quality level
  speed: number; // metres a second, roughly, they leave at
  lift: number; // how much of that speed goes upwards
  lifeSeconds: number;
  size: number; // metres
  dust: { puffs: number; meters: number; seconds: number; spreadMeters: number };
  colors: Record<string, string[]>; // per prop type: palette names the pieces are painted in
}

export function parsePropFx(raw: unknown): PropFxConfig {
  const d = raw as PropFxConfig;
  for (const k of ["chunks", "speed", "lift", "lifeSeconds", "size"] as const) if (typeof d?.[k] !== "number" || d[k] < 0) throw new Error(`propFx.json: ${k} must be a number, 0 or more`);
  for (const k of ["puffs", "meters", "seconds", "spreadMeters"] as const) if (typeof d.dust?.[k] !== "number" || d.dust[k] < 0) throw new Error(`propFx.json: dust.${k} must be a number, 0 or more`);
  return d;
}

// A prop breaking: chunks of it flung out in its own colours, bouncing once and lying a moment (a crate bursts into
// planks, a barrel into yellow shards), and a ring of dust where it stood. From the shared chunk and sprite pools,
// so nothing is made per break; the quality level thins the chunks.
export class BreakFx {
  private colors = new Map<string, THREE.Color[]>();
  private fallback: THREE.Color[];

  constructor(private debris: Debris, private sprites: FxSprites, private config: PropFxConfig, color: (name: string) => string) {
    for (const [type, names] of Object.entries(config.colors)) this.colors.set(type, names.map((n) => new THREE.Color(color(n))));
    this.fallback = [new THREE.Color(color("scrapSteel"))];
  }

  // A prop of this type broke at this spot (its middle), standing on ground at height `floor`.
  burst(type: string, x: number, y: number, z: number, floor: number): void {
    const { chunks, speed, lift, lifeSeconds, size, dust } = this.config;
    this.debris.throw(x, y, z, floor, Math.round(chunks * vfxShare("blastDebris")), speed, lift, size, lifeSeconds, this.colors.get(type) ?? this.fallback);
    for (let i = 0; i < dust.puffs; i++) {
      const angle = (i / dust.puffs) * Math.PI * 2 + Math.random() * 0.5;
      this.sprites.dustPuff(x + Math.cos(angle) * dust.spreadMeters, floor, z + Math.sin(angle) * dust.spreadMeters, dust.meters, dust.seconds);
    }
  }
}
