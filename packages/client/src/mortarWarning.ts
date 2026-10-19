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
const ON_GROUND_METERS = 0.5; // a target this close to the hills is on them; higher up it is a roof, and level

// Lays a ring of radius `radius` round (x, y, z) over the ground: each point of `unit` (a ring of radius 1, flat, as
// x, y, z triples) is lifted or lowered to the ground under it, relative to y. With no ground there, or a target
// that is not on the ground (a roof), the ring stays level. Writes `out` (the same length as `unit`).
export function drapeRing(unit: Float32Array, out: Float32Array, x: number, y: number, z: number, radius: number, groundAt: (x: number, z: number) => number): void {
  const onGround = Math.abs(groundAt(x, z) - y) < ON_GROUND_METERS;
  for (let i = 0; i < unit.length; i += 3) {
    out[i] = unit[i]!;
    out[i + 2] = unit[i + 2]!;
    const g = onGround ? groundAt(x + unit[i]! * radius, z + unit[i + 2]! * radius) : y;
    out[i + 1] = Number.isFinite(g) ? g - y : 0;
  }
}

interface Warning {
  mesh: THREE.Mesh;
  positions: THREE.BufferAttribute;
  material: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  whistleAt: number; // -1 once it has whistled
}

// The pulsing red rings where mortar strikes are about to land, laid over the hills (`groundAt`, NaN for none).
// A small fixed pool made at startup; with every ring busy the oldest is reused. `onWhistle` is called at a ring's
// centre when its first shell is about to come down.
// Art hook: the colour, opacities and pulse are in data/abilityFx.json "warning".
export class MortarWarnings {
  private warnings: Warning[] = [];
  private next = 0;
  private unit: Float32Array;

  constructor(
    scene: THREE.Scene, private config: AbilityFxConfig["warning"], color: (name: string) => string, private onWhistle: (x: number, y: number, z: number) => void,
    private groundAt: (x: number, z: number) => number = () => Number.NaN,
  ) {
    const shape = new THREE.RingGeometry(1 - config.ringWidth, 1, 56);
    shape.rotateX(-Math.PI / 2);
    this.unit = (shape.getAttribute("position").array as Float32Array).slice();
    for (let i = 0; i < POOL; i++) {
      // Each ring has its own corners, since each lies over its own patch of hillside.
      const geometry = shape.clone();
      const material = new THREE.MeshBasicMaterial({ color: color(config.ringColor), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.warnings.push({ mesh, positions: geometry.getAttribute("position") as THREE.BufferAttribute, material, age: 0, life: 0, whistleAt: -1 });
    }
  }

  show(x: number, y: number, z: number, stats: BarrageStats): void {
    const w = this.warnings[this.next]!;
    this.next = (this.next + 1) % this.warnings.length;
    const radius = warningRadius(stats);
    w.mesh.position.set(x, y + LIFT, z);
    w.mesh.scale.set(radius, 1, radius);
    drapeRing(this.unit, w.positions.array as Float32Array, x, y, z, radius, this.groundAt);
    w.positions.needsUpdate = true;
    w.mesh.geometry.computeBoundingSphere();
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
