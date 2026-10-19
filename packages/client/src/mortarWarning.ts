import * as THREE from "three";
import type { BarrageStats } from "@rustbucket/shared";
import type { AbilityFxConfig } from "./abilityFx";

// How long the warning stays down: from the strike being called in until after the last shell, so the ground
// stays marked for as long as anything can still land in it.
export function warningSeconds(b: BarrageStats): number {
  return b.delaySeconds + b.shells * b.shellSeconds;
}

// Every shell lands within spreadMeters of the target and hurts blastRadius round where it lands, so this is the
// whole area that can be hit. Standing outside the ring is safe.
export function warningRadius(b: BarrageStats): number {
  return b.spreadMeters + b.blastRadius;
}

// Seconds after the strike is called in that the falling whistle starts, so it ends as the first shell lands.
export function whistleSeconds(b: BarrageStats, leadSeconds: number): number {
  return Math.max(0, b.delaySeconds - leadSeconds);
}

const POOL = 4;
const LIFT = 0.1; // just above the ground so the ring does not flicker into it

interface Warning {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  whistleAt: number; // -1 once it has whistled
}

// The pulsing red rings where mortar strikes are about to land. A small fixed pool made at startup; with every ring
// busy the oldest is reused. `onWhistle` is called at a ring's centre when its first shell is about to come down.
// Art hook: the colour, opacities and pulse are in data/abilityFx.json "warning".
export class MortarWarnings {
  private warnings: Warning[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, private config: AbilityFxConfig["warning"], color: (name: string) => string, private onWhistle: (x: number, y: number, z: number) => void) {
    const geometry = new THREE.RingGeometry(1 - config.ringWidth, 1, 56);
    geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < POOL; i++) {
      const material = new THREE.MeshBasicMaterial({ color: color(config.ringColor), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.warnings.push({ mesh, material, age: 0, life: 0, whistleAt: -1 });
    }
  }

  show(x: number, y: number, z: number, stats: BarrageStats): void {
    const w = this.warnings[this.next]!;
    this.next = (this.next + 1) % this.warnings.length;
    w.mesh.position.set(x, y + LIFT, z);
    w.mesh.scale.setScalar(warningRadius(stats));
    w.mesh.visible = true;
    w.age = 0;
    w.life = warningSeconds(stats);
    w.whistleAt = whistleSeconds(stats, this.config.whistleLeadSeconds);
  }

  update(dt: number): void {
    const { opacity, minOpacity, pulsesPerSecond } = this.config;
    for (const w of this.warnings) {
      if (!w.mesh.visible) continue;
      w.age += dt;
      if (w.whistleAt >= 0 && w.age >= w.whistleAt) {
        w.whistleAt = -1;
        const p = w.mesh.position;
        this.onWhistle(p.x, p.y, p.z);
      }
      if (w.age >= w.life) { w.mesh.visible = false; continue; }
      // Starts bright, so the ring is seen the moment it goes down.
      const beat = 0.5 + 0.5 * Math.cos(w.age * pulsesPerSecond * Math.PI * 2);
      w.material.opacity = minOpacity + (opacity - minOpacity) * beat;
    }
  }
}
