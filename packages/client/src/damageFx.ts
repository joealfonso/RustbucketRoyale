import * as THREE from "three";
import { ZONE_BROKEN, ZONE_COUNT, ZONE_INTACT, partToRepair, zoneState, type ZoneSet } from "@rustbucket/shared";
import type { FxSprites } from "./fx/fxSprites";
import { AXIS } from "./fx/sprites";
import { FRAMES } from "./fx/spriteArt";
import type { CrawlLook, MechModel } from "./mechModel";

export interface DamageFxConfig {
  crawl: CrawlLook;
  sparks: {
    damagedEverySeconds: number; brokenEverySeconds: number; repairEverySeconds: number; count: number; speed: number; lifeSeconds: number; size: number;
    gravity: number; streakSeconds: number; model: string | null;
  };
  // Broken parts give thick black puffs; damaged ones thin grey wisps, `thinShare` the size, `thinLifeShare` the
  // life, and starting `thinDissolve` eaten away so they look thin rather than small.
  smoke: {
    damagedEverySeconds: number; brokenEverySeconds: number; riseSpeed: number; lifeSeconds: number; startSize: number; endSize: number;
    thinShare: number; thinLifeShare: number; thinDissolve: number; brokenShade: number; model: string | null;
  };
}

export function parseDamageFx(raw: unknown): DamageFxConfig {
  const d = raw as DamageFxConfig;
  const numbers = (obj: Record<string, unknown> | undefined, keys: string[], what: string) => {
    for (const k of keys) if (typeof obj?.[k] !== "number" || !Number.isFinite(obj[k])) throw new Error(`damageFx.json: ${what}.${k} must be a number`);
  };
  numbers(d?.crawl as unknown as Record<string, unknown>, ["dropMeters", "tiltDegrees", "legStubScale"], "crawl");
  numbers(d?.sparks as unknown as Record<string, unknown>, ["damagedEverySeconds", "brokenEverySeconds", "repairEverySeconds", "count", "speed", "lifeSeconds", "size", "gravity", "streakSeconds"], "sparks");
  numbers(d?.smoke as unknown as Record<string, unknown>, ["damagedEverySeconds", "brokenEverySeconds", "riseSpeed", "lifeSeconds", "startSize", "endSize", "thinShare", "thinLifeShare", "thinDissolve", "brokenShade"], "smoke");
  return d;
}

// Where each zone's sparks and smoke come from, in the mech's body frame: hips, gun arm, top of the torso.
const ANCHORS = [[0, 1.4, 0], [1.2, 2.4, -0.6], [0, 3.1, 0]] as const;

// Damage told by sparks and smoke, so a mech's state reads from across the map (DESIGN.md, "Mech anatomy and damage"):
// a damaged part spits a few spark streaks now and then and trails thin grey smoke; a broken one sparks more and
// pours thick black toon puffs that darken as they rise. Welding sparks shower off a part being repaired.
// Everything comes from the shared sprite pools (fx/fxSprites.ts), capped by the quality level.
// Art hook: `model` in data/damageFx.json for real spark and smoke effects.
export class DamageFx {
  private at = new THREE.Vector3();

  constructor(private sprites: FxSprites, private config: DamageFxConfig, private zones: ZoneSet) {}

  // Counts down this mech's timers and lets off sparks and smoke for each part that is not intact.
  emitFrom(model: MechModel, dt: number): void {
    const { sparks, smoke } = this.config;
    // Repairing: a steady shower of welding sparks off the part being fixed, so everyone can see who is busy.
    const welding = model.repairing && !model.dead ? partToRepair(model.hp, this.zones) : -1;
    if (welding >= 0 && (model.fxTimers[6] = model.fxTimers[6]! - dt) <= 0) {
      model.fxTimers[6] = sparks.repairEverySeconds;
      this.anchor(model, welding);
      for (let i = 0; i < sparks.count; i++) this.spark();
    }
    for (let zone = 0; zone < ZONE_COUNT; zone++) {
      const state = zoneState(model.hp, this.zones, zone);
      if (state === ZONE_INTACT) continue;
      const broken = state === ZONE_BROKEN;
      this.anchor(model, zone);

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

  // Where a zone's effects start: the model's own effect point when it has one (a kit), otherwise a fixed spot.
  private anchor(model: MechModel, zone: number): void {
    const own = model.fxAnchors[zone];
    if (own) { own.getWorldPosition(this.at); return; }
    const a = ANCHORS[zone]!;
    this.at.set(a[0], a[1], a[2]);
    model.body.localToWorld(this.at);
  }

  private spark(): void {
    const p = this.sprites.sparks.spawn();
    if (!p) return;
    const { speed, lifeSeconds, size, gravity, streakSeconds } = this.config.sparks;
    p.mode = AXIS; p.streak = streakSeconds;
    p.x = this.at.x; p.y = this.at.y; p.z = this.at.z;
    p.vx = (Math.random() - 0.5) * speed; p.vy = Math.random() * speed * 0.8; p.vz = (Math.random() - 0.5) * speed;
    p.gravity = gravity;
    p.life = lifeSeconds * (0.6 + Math.random() * 0.8);
    p.size0 = p.size1 = size; p.aspect = 2;
    p.frame0 = FRAMES.spark.first;
    p.fadeShare = 0.3;
  }

  private puff(heavy: boolean): void {
    const p = (heavy ? this.sprites.smoke : this.sprites.thinSmoke).spawn();
    if (!p) return;
    const { smoke } = this.config;
    const share = heavy ? 1 : smoke.thinShare;
    p.x = this.at.x; p.y = this.at.y; p.z = this.at.z;
    p.vx = (Math.random() - 0.5) * 0.8; p.vy = smoke.riseSpeed * (0.8 + Math.random() * 0.4); p.vz = (Math.random() - 0.5) * 0.8;
    p.life = smoke.lifeSeconds * (heavy ? 1 : smoke.thinLifeShare);
    p.size0 = smoke.startSize * share; p.size1 = smoke.endSize * share;
    p.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
    p.spin = Math.random() * Math.PI * 2; p.spinRate = (Math.random() - 0.5) * 0.8;
    p.shade1 = heavy ? smoke.brokenShade : 0;
    p.dissolve0 = heavy ? 0 : smoke.thinDissolve;
    p.fadeShare = heavy ? 0.4 : 0.5;
  }
}
