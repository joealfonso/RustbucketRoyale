import * as THREE from "three";
import type { Toon } from "../toonMaterial";

export interface PropFxConfig {
  chunks: number; // pieces thrown when a prop breaks
  speed: number; // metres a second, roughly, they leave at
  lifeSeconds: number;
  size: number; // metres
  colors: Record<string, string[]>; // per prop type: palette names the pieces are painted in
}

const POOL = 96;
const GRAVITY = 18;

interface Chunk {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  spin: number;
  age: number;
  life: number;
}

// Chunks of a prop flying out and tumbling down when it breaks, in the prop's own colours, so a crate bursts into
// planks and a barrel into yellow shards. A fixed pool: nothing is created after startup; when all are busy the oldest
// goes. Art hook: a real debris effect per prop type at V5.
export class BreakFx {
  private chunks: Chunk[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, private toon: Toon, private config: PropFxConfig) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(geometry, toon.material("scrapSteel"));
      mesh.visible = false;
      scene.add(mesh);
      this.chunks.push({ mesh, vx: 0, vy: 0, vz: 0, spin: 0, age: 0, life: 0 });
    }
  }

  // A prop of this type broke at this spot (its middle).
  burst(type: string, x: number, y: number, z: number): void {
    const { chunks, speed, lifeSeconds, size } = this.config;
    const colors = this.config.colors[type] ?? ["scrapSteel"];
    for (let i = 0; i < chunks; i++) {
      const c = this.chunks[this.next]!;
      this.next = (this.next + 1) % this.chunks.length;
      const angle = Math.random() * Math.PI * 2, out = speed * (0.4 + Math.random() * 0.6);
      c.vx = Math.cos(angle) * out; c.vz = Math.sin(angle) * out; c.vy = speed * (0.5 + Math.random() * 0.7);
      c.spin = (Math.random() - 0.5) * 12;
      c.age = 0;
      c.life = lifeSeconds * (0.7 + Math.random() * 0.6);
      c.mesh.material = this.toon.material(colors[i % colors.length]!);
      c.mesh.position.set(x + (Math.random() - 0.5), y + Math.random() * 0.5, z + (Math.random() - 0.5));
      const s = size * (0.6 + Math.random() * 0.8);
      c.mesh.scale.set(s * (1 + Math.random()), s * 0.5, s);
      c.mesh.visible = true;
    }
  }

  update(dt: number): void {
    for (const c of this.chunks) {
      if (!c.mesh.visible) continue;
      c.age += dt;
      if (c.age >= c.life) { c.mesh.visible = false; continue; }
      c.vy -= GRAVITY * dt;
      c.mesh.position.x += c.vx * dt; c.mesh.position.y += c.vy * dt; c.mesh.position.z += c.vz * dt;
      // Pieces stop on the ground rather than falling through it.
      if (c.mesh.position.y < 0.1) { c.mesh.position.y = 0.1; c.vy = 0; c.vx *= 0.8; c.vz *= 0.8; c.spin *= 0.8; }
      c.mesh.rotation.x += c.spin * dt; c.mesh.rotation.z += c.spin * 0.7 * dt;
      if (c.age > c.life * 0.8) c.mesh.scale.multiplyScalar(0.92);
    }
  }
}
