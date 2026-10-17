import * as THREE from "three";

// A fixed set of short lived glowing blobs (muzzle flash, impacts). Nothing is created after startup.
// Art hook: swap `mesh` for a real effect later, the pool logic stays the same.
export class TimedEffects {
  private meshes: THREE.Mesh[] = [];
  private timeLeft: number[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, count: number, size: number, material: THREE.Material) {
    const geometry = new THREE.SphereGeometry(size, 8, 6);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.timeLeft.push(0);
    }
  }

  // Reuses the oldest slot when every effect is busy.
  spawn(x: number, y: number, z: number, lifetime: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.meshes.length;
    this.meshes[i]!.position.set(x, y, z);
    this.meshes[i]!.visible = true;
    this.timeLeft[i] = lifetime;
  }

  update(dt: number): void {
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.timeLeft[i]! <= 0) continue;
      this.timeLeft[i]! -= dt;
      if (this.timeLeft[i]! <= 0) this.meshes[i]!.visible = false;
    }
  }
}
