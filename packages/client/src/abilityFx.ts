import * as THREE from "three";
import type { AbilityStats } from "@rustbucket/shared";
import { TimedEffects } from "./effects";

export interface AbilityFxConfig {
  // Kicked up round the feet when a ram or leap starts.
  dust: { puffs: number; spreadMeters: number; meters: number; seconds: number; color: string; opacity: number };
  // A pounce landing: a ring on the ground as wide as the slam reaches, and dust thrown out inside it.
  slam: { ringSeconds: number; ringColor: string; ringOpacity: number; puffs: number; puffSpread: number; shakeForce: number; shakeRadius: number };
  // A ram or slam connecting with somebody.
  hit: { flashMeters: number; flashSeconds: number; color: string; shakeForce: number; shakeRadius: number };
  // The ring on the ground where a mortar strike will land (mortarWarning.ts). Opacity pulses between the two.
  warning: { ringColor: string; opacity: number; minOpacity: number; pulsesPerSecond: number; ringWidth: number; whistleLeadSeconds: number };
  // A decoy bursting: sparks round where it stood and a flash in the middle, `heightMeters` up its body.
  fizz: { sparks: number; sparkMeters: number; spreadMeters: number; sparkSeconds: number; flashMeters: number; flashSeconds: number; heightMeters: number; color: string };
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
  check("dust", ["puffs", "spreadMeters", "meters", "seconds", "opacity"], ["color"]);
  check("slam", ["ringSeconds", "ringOpacity", "puffs", "puffSpread", "shakeForce", "shakeRadius"], ["ringColor"]);
  check("hit", ["flashMeters", "flashSeconds", "shakeForce", "shakeRadius"], ["color"]);
  check("warning", ["opacity", "minOpacity", "pulsesPerSecond", "ringWidth", "whistleLeadSeconds"], ["ringColor"]);
  check("fizz", ["sparks", "sparkMeters", "spreadMeters", "sparkSeconds", "flashMeters", "flashSeconds", "heightMeters"], ["color"]);
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

const PUFF_POOL = 48;
const FLASH_POOL = 8;
const RING_POOL = 6;
const SPARK_POOL = 32;
const FIZZ_FLASH_POOL = 4;
const GOLDEN_ANGLE = 2.39996; // spreads the sparks evenly round the burst without a random number
const RING_LIFT = 0.08; // just above the ground so the ring does not flicker into it
const RING_START = 0.2; // share of its full width the ring starts at

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  radius: number;
}

// Dust, slam rings, hit flashes and decoy fizzes for the Q abilities. Fixed pools made at startup; when one is all busy the oldest
// is reused. Art hook: the sizes, colours and lifetimes are in data/abilityFx.json; real effects replace these at V5.
export class AbilityFx {
  private puffs: TimedEffects;
  private flashes: TimedEffects;
  private sparks: TimedEffects;
  private fizzFlashes: TimedEffects;
  private rings: Ring[] = [];
  private nextRing = 0;

  constructor(scene: THREE.Scene, private config: AbilityFxConfig, color: (name: string) => string) {
    this.puffs = new TimedEffects(scene, PUFF_POOL, config.dust.meters, new THREE.MeshBasicMaterial({ color: color(config.dust.color), transparent: true, opacity: config.dust.opacity, depthWrite: false }));
    this.flashes = new TimedEffects(scene, FLASH_POOL, config.hit.flashMeters, new THREE.MeshBasicMaterial({ color: color(config.hit.color) }));
    const fizzMaterial = new THREE.MeshBasicMaterial({ color: color(config.fizz.color) });
    this.sparks = new TimedEffects(scene, SPARK_POOL, config.fizz.sparkMeters, fizzMaterial);
    this.fizzFlashes = new TimedEffects(scene, FIZZ_FLASH_POOL, config.fizz.flashMeters, fizzMaterial);
    const geometry = new THREE.RingGeometry(0.85, 1, 40);
    geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({ color: color(config.slam.ringColor), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, material, age: config.slam.ringSeconds, radius: 1 });
    }
  }

  // A ram or leap pushing off: a ring of dust round the feet.
  start(x: number, y: number, z: number): void {
    const { puffs, spreadMeters, seconds } = this.config.dust;
    this.puffRing(x, y, z, puffs, spreadMeters, seconds);
  }

  // A pounce coming down. `radius` is how far its slam reaches; 0 when that is not known, which leaves out the ring.
  slam(x: number, y: number, z: number, radius: number): void {
    const s = this.config.slam;
    this.puffRing(x, y, z, s.puffs, radius * s.puffSpread, this.config.dust.seconds);
    if (radius <= 0) return;
    const ring = this.rings[this.nextRing]!;
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    ring.mesh.position.set(x, y + RING_LIFT, z);
    ring.radius = radius;
    ring.age = 0;
    ring.mesh.scale.setScalar(radius * RING_START);
    ring.mesh.visible = true;
  }

  hit(x: number, y: number, z: number): void {
    this.flashes.spawn(x, y, z, this.config.hit.flashSeconds);
  }

  // A decoy bursting where it stood (x, y, z at its feet).
  fizz(x: number, y: number, z: number): void {
    const f = this.config.fizz;
    const middle = y + f.heightMeters;
    this.fizzFlashes.spawn(x, middle, z, f.flashSeconds);
    for (let i = 0; i < f.sparks; i++) {
      // Points spread over a ball: heights evenly from bottom to top, turned by the golden angle each time.
      const up = f.sparks > 1 ? (i / (f.sparks - 1)) * 2 - 1 : 0;
      const across = Math.sqrt(1 - up * up) * f.spreadMeters;
      const angle = i * GOLDEN_ANGLE;
      this.sparks.spawn(x + Math.cos(angle) * across, middle + up * f.spreadMeters, z + Math.sin(angle) * across, f.sparkSeconds);
    }
  }

  update(dt: number): void {
    this.puffs.update(dt);
    this.flashes.update(dt);
    this.sparks.update(dt);
    this.fizzFlashes.update(dt);
    const life = this.config.slam.ringSeconds;
    for (const ring of this.rings) {
      if (ring.age >= life) continue;
      ring.age += dt;
      const t = Math.min(1, ring.age / life);
      // Fast out, then easing to its full width, so it reads as a shockwave rather than a growing decal.
      const grow = 1 - (1 - t) * (1 - t);
      ring.mesh.scale.setScalar(ring.radius * (RING_START + (1 - RING_START) * grow));
      ring.material.opacity = this.config.slam.ringOpacity * (1 - t);
      if (ring.age >= life) ring.mesh.visible = false;
    }
  }

  private puffRing(x: number, y: number, z: number, count: number, spread: number, seconds: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      this.puffs.spawn(x + Math.cos(angle) * spread, y + this.config.dust.meters * 0.5, z + Math.sin(angle) * spread, seconds);
    }
  }
}
