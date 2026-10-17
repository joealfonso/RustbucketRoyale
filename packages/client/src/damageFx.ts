import * as THREE from "three";
import { ZONE_BROKEN, ZONE_COUNT, ZONE_INTACT, partToRepair, zoneState, type ZoneSet } from "@rustbucket/shared";
import type { CrawlLook, MechModel } from "./mechModel";

export interface DamageFxConfig {
  crawl: CrawlLook;
  sparks: { damagedEverySeconds: number; brokenEverySeconds: number; repairEverySeconds: number; count: number; speed: number; lifeSeconds: number; size: number; color: string; model: string | null };
  smoke: {
    damagedEverySeconds: number; brokenEverySeconds: number; riseSpeed: number; lifeSeconds: number; startSize: number; endSize: number;
    damagedColor: string; brokenColor: string; model: string | null;
  };
}

export function parseDamageFx(raw: unknown): DamageFxConfig {
  const d = raw as DamageFxConfig;
  const numbers = (obj: Record<string, unknown> | undefined, keys: string[], what: string) => {
    for (const k of keys) if (typeof obj?.[k] !== "number" || !Number.isFinite(obj[k])) throw new Error(`damageFx.json: ${what}.${k} must be a number`);
  };
  numbers(d?.crawl as unknown as Record<string, unknown>, ["dropMeters", "tiltDegrees", "legStubScale"], "crawl");
  numbers(d?.sparks as unknown as Record<string, unknown>, ["damagedEverySeconds", "brokenEverySeconds", "repairEverySeconds", "count", "speed", "lifeSeconds", "size"], "sparks");
  numbers(d?.smoke as unknown as Record<string, unknown>, ["damagedEverySeconds", "brokenEverySeconds", "riseSpeed", "lifeSeconds", "startSize", "endSize"], "smoke");
  return d;
}

// Where each zone's sparks and smoke come from, in the mech's body frame: hips, gun arm, top of the torso.
const ANCHORS = [[0, 1.4, 0], [1.2, 2.4, -0.6], [0, 3.1, 0]] as const;
const SPARK_POOL = 120;
const SMOKE_POOL = 200;
const GRAVITY = 20;

interface Particle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
}

// Sparks from damaged and broken parts, a little light smoke from damaged ones and heavy black smoke from broken
// ones, so a mech's state reads from across the map. Fixed pools: nothing is created after startup, and when every
// particle is busy the oldest is reused. Art hook: `model` in data/damageFx.json for real spark and smoke effects.
export class DamageFx {
  private sparks: Particle[] = [];
  private smoke: Particle[] = [];
  private nextSpark = 0;
  private nextSmoke = 0;
  private at = new THREE.Vector3();
  private lightSmoke: THREE.Material;
  private heavySmoke: THREE.Material;

  constructor(scene: THREE.Scene, private config: DamageFxConfig, private zones: ZoneSet) {
    const sparkMaterial = new THREE.MeshBasicMaterial({ color: config.sparks.color });
    const sparkGeometry = new THREE.BoxGeometry(config.sparks.size, config.sparks.size, config.sparks.size);
    this.lightSmoke = new THREE.MeshBasicMaterial({ color: config.smoke.damagedColor, transparent: true, opacity: 0.45, depthWrite: false });
    this.heavySmoke = new THREE.MeshBasicMaterial({ color: config.smoke.brokenColor, transparent: true, opacity: 0.6, depthWrite: false });
    const smokeGeometry = new THREE.SphereGeometry(0.5, 7, 5);
    const make = (geometry: THREE.BufferGeometry, material: THREE.Material): Particle => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, vx: 0, vy: 0, vz: 0, age: 0, life: 0 };
    };
    for (let i = 0; i < SPARK_POOL; i++) this.sparks.push(make(sparkGeometry, sparkMaterial));
    for (let i = 0; i < SMOKE_POOL; i++) this.smoke.push(make(smokeGeometry, this.lightSmoke));
  }

  // Counts down this mech's timers and lets off sparks and smoke for each part that is not intact.
  emitFrom(model: MechModel, dt: number): void {
    const { sparks, smoke } = this.config;
    // Repairing: a steady shower of welding sparks off the part being fixed, so everyone can see who is busy.
    const welding = model.repairing && !model.dead ? partToRepair(model.hp, this.zones) : -1;
    if (welding >= 0 && (model.fxTimers[6] = model.fxTimers[6]! - dt) <= 0) {
      model.fxTimers[6] = sparks.repairEverySeconds;
      const anchor = ANCHORS[welding]!;
      this.at.set(anchor[0], anchor[1], anchor[2]);
      model.body.localToWorld(this.at);
      for (let i = 0; i < sparks.count; i++) this.spark();
    }
    for (let zone = 0; zone < ZONE_COUNT; zone++) {
      const state = zoneState(model.hp, this.zones, zone);
      if (state === ZONE_INTACT) continue;
      const broken = state === ZONE_BROKEN;
      const anchor = ANCHORS[zone]!;
      this.at.set(anchor[0], anchor[1], anchor[2]);
      model.body.localToWorld(this.at);

      // Dead mechs only smoke: sparks are for something still running.
      if (!model.dead && (model.fxTimers[zone * 2] = model.fxTimers[zone * 2]! - dt) <= 0) {
        model.fxTimers[zone * 2] = (broken ? sparks.brokenEverySeconds : sparks.damagedEverySeconds) * (0.6 + Math.random() * 0.8);
        for (let i = 0; i < sparks.count; i++) this.spark();
      }
      if ((model.fxTimers[zone * 2 + 1] = model.fxTimers[zone * 2 + 1]! - dt) <= 0) {
        model.fxTimers[zone * 2 + 1] = (broken ? smoke.brokenEverySeconds : smoke.damagedEverySeconds) * (0.7 + Math.random() * 0.6);
        this.puff(broken);
      }
    }
  }

  update(dt: number): void {
    const { smoke } = this.config;
    for (const p of this.sparks) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      if (p.age >= p.life) { p.mesh.visible = false; continue; }
      p.vy -= GRAVITY * dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
    }
    for (const p of this.smoke) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      if (p.age >= p.life) { p.mesh.visible = false; continue; }
      const t = p.age / p.life;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      // Grows as it rises, then thins away in the last fifth of its life.
      const size = smoke.startSize + (smoke.endSize - smoke.startSize) * t;
      p.mesh.scale.setScalar(t > 0.8 ? size * (1 - t) * 5 : size);
    }
  }

  private spark(): void {
    const p = this.sparks[this.nextSpark]!;
    this.nextSpark = (this.nextSpark + 1) % this.sparks.length;
    const s = this.config.sparks.speed;
    p.mesh.position.copy(this.at);
    p.vx = (Math.random() - 0.5) * s; p.vy = Math.random() * s * 0.8; p.vz = (Math.random() - 0.5) * s;
    p.age = 0;
    p.life = this.config.sparks.lifeSeconds * (0.6 + Math.random() * 0.8);
    p.mesh.visible = true;
  }

  private puff(heavy: boolean): void {
    const p = this.smoke[this.nextSmoke]!;
    this.nextSmoke = (this.nextSmoke + 1) % this.smoke.length;
    const { smoke } = this.config;
    p.mesh.material = heavy ? this.heavySmoke : this.lightSmoke;
    p.mesh.position.copy(this.at);
    p.vx = (Math.random() - 0.5) * 0.8; p.vy = smoke.riseSpeed * (0.8 + Math.random() * 0.4); p.vz = (Math.random() - 0.5) * 0.8;
    p.age = 0;
    p.life = smoke.lifeSeconds * (heavy ? 1 : 0.6);
    p.mesh.scale.setScalar(smoke.startSize);
    p.mesh.visible = true;
  }
}
