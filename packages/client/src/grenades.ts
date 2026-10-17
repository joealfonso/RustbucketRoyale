import * as THREE from "three";
import { createGrenade, stepGrenade, type Box, type GrenadeState, type GrenadeStats } from "@rustbucket/shared";

interface Live {
  state: GrenadeState;
  mesh: THREE.Mesh;
  active: boolean;
  settled: boolean;
}

// Grenades in flight on this client. They fly the same arc the server computes, so only the throw
// and the blast need to be sent over the network.
export class ClientGrenades {
  private pool: Live[] = [];

  constructor(scene: THREE.Scene, count: number, private stats: GrenadeStats) {
    const geometry = new THREE.SphereGeometry(stats.radius, 10, 8);
    const material = new THREE.MeshStandardMaterial({ color: "#3a3f2a", roughness: 0.8 });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ state: createGrenade(), mesh, active: false, settled: false });
    }
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const slot = this.pool.find((g) => !g.active) ?? this.pool[0]!;
    Object.assign(slot.state, { x, y, z, vx, vy, vz, timeLeft: this.stats.fuseSeconds });
    slot.active = true;
    slot.settled = false;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, y, z);
  }

  // `onFuse` fires when a grenade's fuse runs out on this client. Online the server's blast message is the real signal.
  update(dt: number, boxes: readonly Box[], onFuse?: (x: number, y: number, z: number) => void): void {
    for (const g of this.pool) {
      if (!g.active || g.settled) continue;
      // Hold still at fuse end and wait for the server's blast message, which removes it.
      if (stepGrenade(g.state, this.stats, dt, boxes)) {
        g.settled = true;
        onFuse?.(g.state.x, g.state.y, g.state.z);
      }
      g.mesh.position.set(g.state.x, g.state.y, g.state.z);
    }
  }

  // The server says one went off here: take away the nearest grenade so it does not hang around.
  removeNear(x: number, y: number, z: number): void {
    let best: Live | null = null;
    let bestDistance = 6;
    for (const g of this.pool) {
      if (!g.active) continue;
      const d = Math.hypot(g.state.x - x, g.state.y - y, g.state.z - z);
      if (d < bestDistance) { best = g; bestDistance = d; }
    }
    if (best) { best.active = false; best.mesh.visible = false; }
  }
}
