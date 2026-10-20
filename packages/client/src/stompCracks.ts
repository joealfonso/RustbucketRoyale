import * as THREE from "three";
import type { Terrain } from "@rustbucket/shared";
import { groundTilt } from "./groundTilt";

// Cracks split across the ground where the Titan stomps, out to the edge of what the stomp hits, so the danger zone
// is drawn on the ground where it happened. A few pooled flat meshes sharing one crack shape (made once, the same
// every time: it is a mark, not a map feature), each turned at random, fading out in hard steps.

const ARMS = 11;
const BENDS = 6;
const UP = new THREE.Vector3(0, 1, 0);

// A splash of jagged cracks one unit across in every direction, as flat strips on the ground (y = 0). Fixed numbers
// stand in for randomness so every stomp leaves the same shape, only turned.
export function crackShape(): THREE.BufferGeometry {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const positions: number[] = [];
  const strip = (x0: number, z0: number, x1: number, z1: number, w0: number, w1: number) => {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const a = [x0 + nx * w0, z0 + nz * w0], b = [x0 - nx * w0, z0 - nz * w0], c = [x1 - nx * w1, z1 - nz * w1], d = [x1 + nx * w1, z1 + nz * w1];
    for (const p of [a, b, c, a, c, d]) positions.push(p[0]!, 0, p[1]!);
  };
  const crack = (angle: number, from: number, to: number, width: number, branches: boolean) => {
    let x = Math.cos(angle) * from, z = Math.sin(angle) * from, heading = angle;
    for (let i = 0; i < BENDS; i++) {
      heading += (rnd() - 0.5) * 0.7;
      const r = from + ((to - from) * (i + 1)) / BENDS;
      const nx = Math.cos(heading) * r, nz = Math.sin(heading) * r;
      const w0 = width * (1 - i / BENDS), w1 = width * (1 - (i + 1) / BENDS) + 0.004;
      strip(x, z, nx, nz, w0, w1);
      if (branches && i === 2 && rnd() < 0.7) crack(heading + (rnd() < 0.5 ? -0.6 : 0.6), r, r + (to - r) * 0.6, w1, false);
      x = nx; z = nz;
    }
  };
  for (let i = 0; i < ARMS; i++) crack((i / ARMS) * Math.PI * 2 + rnd() * 0.4, 0.08, 0.7 + rnd() * 0.3, 0.035, true);
  // A crushed ring in the middle where the foot came down.
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2, r = 0.12 + rnd() * 0.03;
    strip(Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r, 0.025, 0.025);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

interface Crack { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; age: number; life: number }

export class StompCracks {
  readonly group = new THREE.Group();
  private cracks: Crack[] = [];
  private next = 0;
  private terrain: Terrain | null = null;
  private tilt = { x: 0, z: 0 };
  private normal = [0, 1, 0];
  private v = new THREE.Vector3();

  constructor(count: number, color: string, private fadeSeconds: number, private lift: number) {
    const shape = crackShape();
    for (let i = 0; i < count; i++) {
      // Its own material, so each fades on its own; drawn over the ground without fighting it.
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(shape, material);
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.cracks.push({ mesh, material, age: 0, life: 0 });
    }
  }

  setTerrain(terrain: Terrain | null): void {
    this.terrain = terrain;
  }

  // Cracks `radius` metres out round (x, z) on ground at height `floor`, lasting `seconds`.
  show(x: number, floor: number, z: number, radius: number, seconds: number): void {
    const c = this.cracks[this.next]!;
    this.next = (this.next + 1) % this.cracks.length;
    c.age = 0;
    c.life = seconds;
    c.material.opacity = 1;
    c.mesh.visible = true;
    c.mesh.position.set(x, floor + this.lift, z);
    c.mesh.scale.set(radius, 1, radius);
    groundTilt(this.terrain, x, z, floor, this.tilt, this.normal);
    this.v.set(-this.tilt.x, 1, -this.tilt.z).normalize();
    c.mesh.quaternion.setFromUnitVectors(UP, this.v);
    c.mesh.rotateY(Math.random() * Math.PI * 2);
  }

  update(dt: number): void {
    for (const c of this.cracks) {
      if (!c.mesh.visible) continue;
      c.age += dt;
      const left = c.life - c.age;
      if (left <= 0) { c.mesh.visible = false; continue; }
      // Fades in four hard steps, like the sprites dissolve, not a smooth video fade.
      c.material.opacity = left >= this.fadeSeconds ? 1 : Math.ceil((left / this.fadeSeconds) * 4) / 4;
    }
  }

  clear(): void {
    for (const c of this.cracks) c.mesh.visible = false;
  }
}
