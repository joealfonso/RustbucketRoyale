import * as THREE from "three";
import { freeze } from "../freeze";
import { addOutlineNormals } from "../outlineNormals";
import type { Toon } from "../toonMaterial";
import { SlotRing, stepped } from "./flipbook";

// How thrown chunks move (data/explosionFx.json "chunks"): they fall, bounce once off the ground losing most of
// their speed, then lie still and sink away at the end of their life.
export interface ChunkPhysics { gravity: number; bounce: number; friction: number; spin: number; sinkShare: number }

export interface Chunk {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; rz: number; spin: number;
  floor: number; // the ground height under where it was thrown
  age: number; life: number;
  size: number;
  bounced: boolean;
}

// One step of a chunk's flight. The first time it reaches the ground it bounces; the second time it stops.
export function stepChunk(c: Chunk, dt: number, physics: ChunkPhysics): void {
  c.age += dt;
  if (c.vx === 0 && c.vy === 0 && c.vz === 0 && c.y <= c.floor) return; // lying still
  c.vy -= physics.gravity * dt;
  c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
  c.rx += c.spin * dt; c.rz += c.spin * 0.7 * dt;
  if (c.y > c.floor) return;
  c.y = c.floor;
  if (!c.bounced) {
    c.bounced = true;
    c.vy = -c.vy * physics.bounce;
    c.vx *= physics.friction; c.vz *= physics.friction;
    c.spin *= 0.5;
  } else {
    c.vx = 0; c.vy = 0; c.vz = 0; c.spin = 0;
  }
}

// How big a chunk is drawn: full size until the last `sinkShare` of its life, then shrinking away in steps.
export function chunkScale(c: Chunk, sinkShare: number): number {
  const t = c.life > 0 ? c.age / c.life : 1;
  if (t >= 1) return 0;
  if (sinkShare <= 0 || t < 1 - sinkShare) return c.size;
  return c.size * (1 - stepped((t - (1 - sinkShare)) / sinkShare, 3));
}

const PIECE = addOutlineNormals(new THREE.BoxGeometry(1, 0.5, 0.7)); // a flat chunk of plate, so it tumbles visibly

// Flung chunks of scrap in the toon look, drawn as one instanced mesh with its outline: explosions, prop breaks,
// slams. A fixed pool made at startup; the quality level caps how many are in use, reusing the oldest.
export class Debris {
  private chunks: Chunk[] = [];
  private colors: THREE.Color[] = [];
  private ring = new SlotRing();
  private mesh: THREE.InstancedMesh;
  private outline: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private turn = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private at = new THREE.Vector3();
  private scale = new THREE.Vector3();

  constructor(scene: THREE.Scene, toon: Toon, capacity: number, private limit: () => number, private physics: ChunkPhysics) {
    // White paint, so each chunk's own instance colour is its colour.
    this.mesh = new THREE.InstancedMesh(PIECE, toon.ownMaterial("#ffffff"), capacity);
    this.outline = new THREE.InstancedMesh(PIECE, toon.instanced(toon.shellOutline("soot")), capacity);
    this.outline.instanceMatrix = this.mesh.instanceMatrix; // one set of matrices drives both
    for (const m of [this.mesh, this.outline]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      freeze(m); // the chunks are instances; the mesh holding them never moves
      scene.add(m);
    }
    for (let i = 0; i < capacity; i++) {
      this.chunks.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, spin: 0, floor: 0, age: 0, life: 0, size: 1, bounced: false });
      this.colors.push(new THREE.Color());
      this.mesh.setColorAt(i, this.colors[i]!);
    }
  }

  // `count` chunks out of a point, `speed` metres a second outwards and `lift` times that upwards, painted from
  // `colors` in turn.
  throw(x: number, y: number, z: number, floor: number, count: number, speed: number, lift: number, size: number, life: number, colors: readonly THREE.Color[]): void {
    for (let i = 0; i < count; i++) {
      const slot = this.ring.take(Math.min(this.limit(), this.chunks.length));
      if (slot < 0) return;
      const c = this.chunks[slot]!;
      const angle = Math.random() * Math.PI * 2, out = speed * (0.4 + Math.random() * 0.6);
      c.x = x + Math.cos(angle) * 0.3; c.y = Math.max(y, floor + 0.1); c.z = z + Math.sin(angle) * 0.3;
      c.vx = Math.cos(angle) * out; c.vz = Math.sin(angle) * out; c.vy = speed * lift * (0.5 + Math.random() * 0.6);
      c.rx = Math.random() * 6; c.rz = Math.random() * 6;
      c.spin = (Math.random() - 0.5) * 2 * this.physics.spin;
      c.floor = floor + size * 0.2;
      c.age = 0; c.life = life * (0.7 + Math.random() * 0.6);
      c.size = size * (0.6 + Math.random() * 0.8);
      c.bounced = false;
      this.colors[slot]!.copy(colors[i % colors.length]!);
    }
  }

  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i]!;
      if (c.age >= c.life) continue;
      stepChunk(c, dt, this.physics);
      const s = chunkScale(c, this.physics.sinkShare);
      if (s <= 0) continue;
      this.turn.setFromEuler(this.euler.set(c.rx, c.rx * 0.5, c.rz));
      this.matrix.compose(this.at.set(c.x, c.y, c.z), this.turn, this.scale.setScalar(s));
      this.mesh.setMatrixAt(n, this.matrix);
      this.mesh.setColorAt(n, this.colors[i]!);
      n++;
    }
    this.mesh.count = n; this.outline.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
