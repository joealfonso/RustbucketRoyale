import * as THREE from "three";
import { rng } from "../dressing/kinds";
import type { HangarConfig } from "./layout";

// Welding sparks from the torch on the bench: short bursts of flat yellow streaks that fly, fall and skip once on
// the floor. A fixed pool in one instanced mesh, so it is one draw call and allocates nothing per frame.

const up = new THREE.Vector3(0, 0, 1);
const dir = new THREE.Vector3();
const at = new THREE.Vector3();
const size = new THREE.Vector3();
const turned = new THREE.Quaternion();
const placed = new THREE.Matrix4();
const gone = new THREE.Matrix4().makeScale(0, 0, 0);

export class WelderSparks {
  readonly mesh: THREE.InstancedMesh;
  readonly tip: THREE.Mesh;
  private position: Float32Array;
  private velocity: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private next = 0; // the pool slot the next spark takes
  private untilBurst = 0;
  private random: () => number;

  constructor(private c: HangarConfig["welder"], color: (name: string) => string) {
    this.random = rng(c.seed);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: color(c.color), fog: false }), c.pool);
    this.mesh.frustumCulled = false; // the sparks move every frame, so its bounds are never right
    this.position = new Float32Array(c.pool * 3);
    this.velocity = new Float32Array(c.pool * 3);
    this.age = new Float32Array(c.pool).fill(1);
    this.life = new Float32Array(c.pool).fill(1);
    for (let i = 0; i < c.pool; i++) this.mesh.setMatrixAt(i, gone);
    // The torch's hot tip, which flickers while it welds.
    this.tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: color(c.tip), fog: false }));
    this.tip.position.set(...c.torch);
  }

  private between([lo, hi]: [number, number]): number {
    return lo + (hi - lo) * this.random();
  }

  update(dt: number): void {
    const c = this.c;
    this.untilBurst -= dt;
    if (this.untilBurst <= 0) {
      this.untilBurst = this.between(c.burstEverySeconds);
      const count = Math.round(this.between(c.sparksPerBurst));
      for (let k = 0; k < count; k++) this.spawn();
      this.tip.scale.setScalar(1.5 + this.random());
    } else {
      this.tip.scale.setScalar(Math.max(0.6, this.tip.scale.x - dt * 6));
    }
    for (let i = 0; i < c.pool; i++) {
      if (this.age[i]! >= this.life[i]!) continue;
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) { this.mesh.setMatrixAt(i, gone); continue; }
      const p = i * 3;
      this.velocity[p + 1]! -= c.gravity * dt;
      this.position[p]! += this.velocity[p]! * dt;
      this.position[p + 1]! += this.velocity[p + 1]! * dt;
      this.position[p + 2]! += this.velocity[p + 2]! * dt;
      // One low skip off the floor, losing most of its speed.
      if (this.position[p + 1]! < 0.02 && this.velocity[p + 1]! < 0) {
        this.position[p + 1] = 0.02;
        this.velocity[p + 1] = -this.velocity[p + 1]! * 0.25;
        this.velocity[p]! *= 0.5;
        this.velocity[p + 2]! *= 0.5;
      }
      // A streak along its flight, shrinking as it cools.
      dir.set(this.velocity[p]!, this.velocity[p + 1]!, this.velocity[p + 2]!);
      const speed = dir.length();
      if (speed > 1e-4) turned.setFromUnitVectors(up, dir.multiplyScalar(1 / speed));
      const cool = 1 - this.age[i]! / this.life[i]!;
      size.set(c.width * cool, c.width * cool, c.length * Math.min(1, speed / 3) + c.width);
      placed.compose(at.set(this.position[p]!, this.position[p + 1]!, this.position[p + 2]!), turned, size);
      this.mesh.setMatrixAt(i, placed);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Out from the torch in a spray that favours away from the plate and upward.
  private spawn(): void {
    const c = this.c;
    const i = this.next;
    this.next = (this.next + 1) % c.pool;
    const p = i * 3;
    const speed = this.between(c.speed);
    const heading = (this.random() - 0.5) * Math.PI * 1.4;
    const rise = 0.2 + this.random() * 0.9;
    this.position.set(c.torch, p);
    this.velocity[p] = Math.sin(heading) * speed;
    this.velocity[p + 1] = rise * speed * 0.6;
    this.velocity[p + 2] = Math.cos(heading) * speed;
    this.age[i] = 0;
    this.life[i] = this.between(c.lifeSeconds);
  }
}
