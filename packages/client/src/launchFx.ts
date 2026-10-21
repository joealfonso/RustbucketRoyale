import * as THREE from "three";
import type { DiveConfig } from "./dive";
import type { Debris } from "./fx/debris";
import type { DropSprites } from "./fx/dropSprites";
import { hash01 } from "./fx/flipbook";
import { AXIS } from "./fx/sprites";
import { FRAMES } from "./fx/spriteArt";
import { freeze } from "./freeze";
import { addOutlineNormals } from "./outlineNormals";
import type { Toon } from "./toonMaterial";

// Being fired out of the Rustbucket (gate 16b), in the toon look: the cannon's blast at its muzzle (a flat inked
// flash, a ring of smoke and puffs thrown out along the barrel), the mech flying in a rough scrap shell with toon fire
// streaming behind it, and the shell bursting into rust plates that peel off and tumble away when the dive starts.
// Every shell in the sky is one instanced mesh and its outline (two draw calls); flames, smoke and plates come from
// the shared inked pools and the debris pool. The sounds and camera kick are the caller's (main.ts).

const PANELS = 1; // icosahedron detail: 80 faces, enough lumps to read as hammered-together scrap

// A lumpy ball of scrap plates, each face one of the shell's colours, a little taller than wide to fit round a mech.
// Built once. Corners are pushed in or out by a hash of where they are, so faces that share a corner stay joined.
function shellGeometry(colors: readonly THREE.Color[]): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, PANELS); // already one corner per face corner
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.82 + 0.3 * hash01(Math.round(x * 97) * 7919 + Math.round(y * 97) * 131 + Math.round(z * 97));
    p.setXYZ(i, x * k, y * k * 1.25, z * k);
  }
  g.computeVertexNormals(); // non-indexed: every face flat, like bent plate
  const color = new Float32Array(p.count * 3);
  for (let f = 0; f < p.count / 3; f++) {
    const c = colors[Math.floor(hash01(f * 31 + 5) * colors.length)]!;
    for (let v = 0; v < 3; v++) color.set([c.r, c.g, c.b], (f * 3 + v) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(color, 3));
  return addOutlineNormals(g);
}

export class LaunchFx {
  private body: THREE.InstancedMesh;
  private outline: THREE.InstancedMesh;
  private count = 0;
  private clock = 0;
  private smokeIn = 0;
  private smokeNow = false;
  private matrix = new THREE.Matrix4();
  private turn = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, "YXZ");
  private at = new THREE.Vector3();
  private size = new THREE.Vector3();
  private plateColors: THREE.Color[];

  constructor(scene: THREE.Scene, toon: Toon, private sprites: DropSprites, private chunks: Debris, private config: Pick<DiveConfig, "cannon" | "shell" | "burst">) {
    const geometry = shellGeometry(config.shell.colors.map((c) => new THREE.Color(toon.color(c))));
    const paint = toon.ownMaterial("#ffffff"); // a material of its own, so it can read the shell's face colours
    paint.vertexColors = true;
    this.body = new THREE.InstancedMesh(geometry, paint, config.shell.capacity);
    this.outline = new THREE.InstancedMesh(geometry, toon.instanced(toon.shellOutline(config.shell.colors[0]!)), config.shell.capacity);
    this.outline.instanceMatrix = this.body.instanceMatrix;
    for (const m of [this.body, this.outline]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      freeze(m);
      scene.add(m);
    }
    this.plateColors = config.burst.plateColors.map((c) => new THREE.Color(toon.color(c)));
  }

  // Once a frame, before the shells are added.
  begin(dt: number): void {
    this.count = 0;
    this.clock += dt;
    this.smokeIn -= dt;
    this.smokeNow = this.smokeIn <= 0;
    if (this.smokeNow) this.smokeIn = this.config.shell.smokeEvery;
  }

  // One mech in its shell this frame: where its feet are, how it moves, and a number of its own for its tumble.
  // `smoke` false for your own, whose smoke would hang between the camera and the shell (as with the dive's trail).
  shell(x: number, y: number, z: number, vx: number, vy: number, vz: number, seed: number, smoke = true): void {
    const c = this.config.shell;
    const speed = Math.hypot(vx, vy, vz) || 1;
    const cy = y + c.centerMeters;
    if (this.count < c.capacity) {
      // Nose along the flight, with a slow roll so it reads as a lump of junk thrown, not a missile.
      this.euler.set(Math.asin(Math.max(-1, Math.min(1, vy / speed))) - Math.PI / 2, Math.atan2(-vx, -vz), this.clock * 2 + seed);
      this.turn.setFromEuler(this.euler);
      this.matrix.compose(this.at.set(x, cy, z), this.turn, this.size.setScalar(c.radiusMeters));
      this.body.setMatrixAt(this.count, this.matrix);
      this.count++;
    }
    // Toon fire streaming out behind, flickering in steps.
    const f = this.sprites.fire.draw();
    if (f) {
      const back = c.radiusMeters * 0.6;
      f.mode = AXIS;
      f.x = x - (vx / speed) * back; f.y = cy - (vy / speed) * back; f.z = z - (vz / speed) * back;
      f.ax = -vx / speed; f.ay = -vy / speed; f.az = -vz / speed;
      const flicker = 0.8 + 0.4 * hash01(Math.floor(this.clock * c.framesPerSecond) * 13 + seed);
      f.size0 = f.size1 = c.flameWidth;
      f.aspect = (c.flameLength * flicker) / c.flameWidth;
      f.frame0 = FRAMES.flame.first; f.frames = FRAMES.flame.count; f.fps = c.framesPerSecond;
      f.age = this.clock + seed;
    }
    if (smoke && this.smokeNow) {
      const s = this.sprites.smoke.spawn();
      if (s) {
        s.x = x - (vx / speed) * c.radiusMeters * 1.5; s.y = cy - (vy / speed) * c.radiusMeters * 1.5; s.z = z - (vz / speed) * c.radiusMeters * 1.5;
        s.vy = 0.5; s.drag = 0.6; s.life = 1.8;
        s.size0 = c.radiusMeters * 1.1; s.size1 = c.radiusMeters * 2;
        s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
        s.shade0 = 1; s.shade1 = 2; s.fadeShare = 0.5;
      }
    }
  }

  // After every shell this frame has been added.
  end(): void {
    this.body.count = this.count; this.outline.count = this.count;
    if (this.count > 0) this.body.instanceMatrix.needsUpdate = true;
  }

  // The cannon going off at its muzzle, pointing `(dx, dy, dz)`.
  cannon(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const c = this.config.cannon;
    for (let i = 0; i < c.flashPuffs; i++) {
      const s = this.sprites.fire.spawn();
      if (!s) break;
      const out = i * c.flashSize * 0.35;
      s.x = x + dx * out; s.y = y + dy * out; s.z = z + dz * out;
      s.vx = dx * 10; s.vy = dy * 10; s.vz = dz * 10; s.drag = 4;
      s.age = -i * 0.03;
      s.life = c.flashSeconds;
      s.size0 = c.flashSize * (1 - i * 0.15); s.size1 = s.size0 * 1.3;
      s.frame0 = FRAMES.fireball.first; s.frames = FRAMES.fireball.count;
      s.spin = Math.random() * Math.PI * 2;
    }
    // A ring of smoke blown off the muzzle, facing the camera like the cartoon's "BOOM" ring.
    const ring = this.sprites.smoke.spawn();
    if (ring) {
      ring.x = x + dx * 2; ring.y = y + dy * 2; ring.z = z + dz * 2;
      ring.vx = dx * 6; ring.vy = dy * 6; ring.vz = dz * 6; ring.drag = 2;
      ring.life = c.smokeSeconds * 0.6;
      ring.size0 = c.smokeSize * 1.5; ring.size1 = c.smokeSize * 4;
      ring.frame0 = FRAMES.ring.first; ring.frames = FRAMES.ring.count;
      ring.fadeShare = 0.4;
    }
    for (let i = 0; i < c.smokePuffs; i++) {
      const s = this.sprites.smoke.spawn();
      if (!s) break;
      const spread = c.smokeSpeed * 0.5;
      const out = c.smokeSpeed * (0.4 + Math.random() * 0.8);
      s.x = x; s.y = y; s.z = z;
      s.vx = dx * out + (Math.random() - 0.5) * spread; s.vy = dy * out + (Math.random() - 0.5) * spread; s.vz = dz * out + (Math.random() - 0.5) * spread;
      s.drag = 1.8;
      s.life = c.smokeSeconds * (0.8 + Math.random() * 0.4);
      s.size0 = c.smokeSize * 0.6; s.size1 = c.smokeSize * 1.4;
      s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
      s.spin = (Math.random() - 0.5) * 0.6;
      s.shade0 = 0; s.shade1 = 1; s.fadeShare = 0.5;
    }
  }

  // The shell bursting round a mech whose feet are at (x, y, z), moving at (vx, vy, vz): rust plates peel away and
  // tumble, and a few puffs of toon fire pop where it was. `floor` is the ground far below, where any plate that
  // lasts that long comes to rest.
  burst(x: number, y: number, z: number, floor: number): void {
    const c = this.config.burst;
    const cy = y + this.config.shell.centerMeters;
    this.chunks.throw(x, cy, z, floor, c.plates, c.plateSpeed, c.plateLift, c.plateSize, c.plateSeconds, this.plateColors);
    for (let i = 0; i < c.fireballs; i++) {
      const s = this.sprites.fire.spawn();
      if (!s) break;
      const a = (i / c.fireballs) * Math.PI * 2;
      const r = this.config.shell.radiusMeters * 0.7;
      s.x = x + Math.cos(a) * r; s.y = cy + (Math.random() - 0.5) * r; s.z = z + Math.sin(a) * r;
      s.vx = Math.cos(a) * 6; s.vz = Math.sin(a) * 6; s.vy = 2; s.drag = 3;
      s.age = -i * 0.02;
      s.life = c.fireballSeconds;
      s.size0 = c.fireballSize * 0.6; s.size1 = c.fireballSize;
      s.frame0 = FRAMES.fireball.first; s.frames = FRAMES.fireball.count;
      s.spin = Math.random() * Math.PI * 2;
    }
  }
}
