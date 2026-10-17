import * as THREE from "three";

const GROW_SECONDS = 0.08;
const LIFE_SECONDS = 0.45;
const FLASH_SECONDS = 0.15;

interface Ball {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  size: number;
}

// Explosions that read as fast and violent: a fireball that bursts to full size almost at once, then fades, and a
// short flash of light on everything nearby. Art hook: replace with a real explosion effect at V5.
export class Fireballs {
  private balls: Ball[] = [];
  private next = 0;
  private flash = new THREE.PointLight("#ffb060", 0, 40, 1.5);
  private flashAge = FLASH_SECONDS;

  constructor(scene: THREE.Scene, count: number) {
    const geometry = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.balls.push({ mesh, material, age: LIFE_SECONDS, size: 1 });
    }
    scene.add(this.flash);
  }

  spawn(x: number, y: number, z: number, size: number): void {
    const ball = this.balls[this.next]!;
    this.next = (this.next + 1) % this.balls.length;
    ball.mesh.position.set(x, y, z);
    ball.size = size;
    ball.age = 0;
    ball.mesh.visible = true;
    this.flash.position.set(x, y + 2, z);
    this.flashAge = 0;
  }

  update(dt: number): void {
    for (const ball of this.balls) {
      if (ball.age >= LIFE_SECONDS) continue;
      ball.age += dt;
      const grow = Math.min(1, ball.age / GROW_SECONDS);
      const scale = ball.size * (0.35 + 0.65 * (1 - (1 - grow) * (1 - grow)));
      ball.mesh.scale.setScalar(scale);
      ball.material.opacity = Math.max(0, 1 - ball.age / LIFE_SECONDS) * 0.9;
      if (ball.age >= LIFE_SECONDS) ball.mesh.visible = false;
    }
    this.flashAge += dt;
    this.flash.intensity = this.flashAge < FLASH_SECONDS ? 60 * (1 - this.flashAge / FLASH_SECONDS) : 0;
  }
}
