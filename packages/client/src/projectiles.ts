import * as THREE from "three";
import { createRayHit, raycastBoxes, type Box, type RayHit } from "@rustbucket/shared";
import type { TimedEffects } from "./effects";

// Pooled bullets. Each step sweeps a ray from the old position to the new one, so fast shots cannot tunnel through thin walls.
export class Projectiles {
  private meshes: THREE.Mesh[] = [];
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private impactAtEnd: Uint8Array;
  private next = 0;
  private hit: RayHit = createRayHit();

  constructor(scene: THREE.Scene, private count: number, material: THREE.Material, private impacts: TimedEffects) {
    const geometry = new THREE.SphereGeometry(0.15, 8, 6);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.vz = new Float32Array(count);
    this.life = new Float32Array(count);
    this.impactAtEnd = new Uint8Array(count);
  }

  spawn(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, lifetime: number, impactAtEnd: boolean): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.meshes[i]!.position.set(x, y, z);
    this.meshes[i]!.visible = true;
    this.vx[i] = dx * speed;
    this.vy[i] = dy * speed;
    this.vz[i] = dz * speed;
    this.life[i] = lifetime;
    this.impactAtEnd[i] = impactAtEnd ? 1 : 0;
  }

  update(dt: number, boxes: readonly Box[]): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i]! <= 0) continue;
      const mesh = this.meshes[i]!;
      const sx = this.vx[i]! * dt, sy = this.vy[i]! * dt, sz = this.vz[i]! * dt;
      const length = Math.hypot(sx, sy, sz);
      const p = mesh.position;

      if (raycastBoxes(p.x, p.y, p.z, sx / length, sy / length, sz / length, length, boxes, this.hit)) {
        const h = this.hit;
        this.impacts.spawn(
          p.x + (sx / length) * h.distance + h.normalX * 0.1,
          p.y + (sy / length) * h.distance + h.normalY * 0.1,
          p.z + (sz / length) * h.distance + h.normalZ * 0.1,
          0.15,
        );
        this.kill(i);
        continue;
      }

      p.x += sx; p.y += sy; p.z += sz;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        // A tracer that ended on a mech: flash there, since no map box was hit.
        if (this.impactAtEnd[i]) this.impacts.spawn(p.x, p.y, p.z, 0.15);
        this.kill(i);
      }
    }
  }

  private kill(i: number): void {
    this.life[i] = 0;
    this.meshes[i]!.visible = false;
  }
}
