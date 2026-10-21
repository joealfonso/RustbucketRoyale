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

// The flaming scrap ball every mech drops in (gates 16b and 16c), in the toon look: a lumpy inked ball of rust plates
// round the mech with stepped toon fire streaming behind it, and the ball bursting into plates that peel off and
// tumble away when the retro-jets light. Every ball in the sky is one instanced mesh and its outline (two draw calls);
// flames and plates come from the shared inked pools and the debris pool. Smoke trails are diveTrails.ts; sounds and
// camera shake are the caller's (main.ts).

const PANELS = 1; // icosahedron detail: 80 faces, enough lumps to read as hammered-together scrap

// A lumpy ball of scrap plates, each face one of the ball's colours, a little taller than wide to fit round a mech.
// Built once. Corners are pushed in or out by a hash of where they are, so faces that share a corner stay joined.
function ballGeometry(colors: readonly THREE.Color[]): THREE.BufferGeometry {
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

export class ScrapBalls {
  private body: THREE.InstancedMesh;
  private outline: THREE.InstancedMesh;
  private count = 0;
  private clock = 0;
  private matrix = new THREE.Matrix4();
  private turn = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, "YXZ");
  private at = new THREE.Vector3();
  private size = new THREE.Vector3();
  private plateColors: THREE.Color[];

  constructor(scene: THREE.Scene, toon: Toon, private sprites: DropSprites, private chunks: Debris, private config: Pick<DiveConfig, "ball" | "burst">) {
    const geometry = ballGeometry(config.ball.colors.map((c) => new THREE.Color(toon.color(c))));
    const paint = toon.ownMaterial("#ffffff"); // a material of its own, so it can read the ball's face colours
    paint.vertexColors = true;
    this.body = new THREE.InstancedMesh(geometry, paint, config.ball.capacity);
    this.outline = new THREE.InstancedMesh(geometry, toon.instanced(toon.shellOutline(config.ball.colors[0]!)), config.ball.capacity);
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

  // Once a frame, before the balls are added.
  begin(dt: number): void {
    this.count = 0;
    this.clock += dt;
  }

  // One mech in its ball this frame: where its feet are, how it moves, and a number of its own for its roll. Hanging
  // still, the flame licks straight up and shorter; falling, it streams out behind.
  ball(x: number, y: number, z: number, vx: number, vy: number, vz: number, seed: number): void {
    const c = this.config.ball;
    const speed = Math.hypot(vx, vy, vz);
    const still = speed < 1;
    const dx = still ? 0 : vx / speed, dy = still ? -1 : vy / speed, dz = still ? 0 : vz / speed;
    const cy = y + c.centerMeters;
    if (this.count < c.capacity) {
      // Nose along the fall, with a slow roll so it reads as a lump of junk, not a missile.
      this.euler.set(Math.asin(Math.max(-1, Math.min(1, dy))) - Math.PI / 2, still ? 0 : Math.atan2(-vx, -vz), this.clock * c.rollPerSecond + seed);
      this.turn.setFromEuler(this.euler);
      this.matrix.compose(this.at.set(x, cy, z), this.turn, this.size.setScalar(c.radiusMeters));
      this.body.setMatrixAt(this.count, this.matrix);
      this.count++;
    }
    const f = this.sprites.fire.draw();
    if (!f) return;
    const back = c.radiusMeters * 0.6;
    f.mode = AXIS;
    f.x = x - dx * back; f.y = cy - dy * back; f.z = z - dz * back;
    f.ax = -dx; f.ay = -dy; f.az = -dz;
    const flicker = 0.8 + 0.4 * hash01(Math.floor(this.clock * c.framesPerSecond) * 13 + seed);
    f.size0 = f.size1 = c.flameWidth;
    f.aspect = (c.flameLength * (still ? c.hangFlameShare : 1) * flicker) / c.flameWidth;
    f.frame0 = FRAMES.flame.first; f.frames = FRAMES.flame.count; f.fps = c.framesPerSecond;
    f.age = this.clock + seed;
  }

  // After every ball this frame has been added.
  end(): void {
    this.body.count = this.count; this.outline.count = this.count;
    if (this.count > 0) this.body.instanceMatrix.needsUpdate = true;
  }
  // The ball bursting round a mech whose feet are at (x, y, z) as its retro-jets light: rust plates peel away and
  // tumble, and a few puffs of toon fire pop where it was. `floor` is the ground far below, where any plate that
  // lasts that long comes to rest.
  burst(x: number, y: number, z: number, floor: number): void {
    const c = this.config.burst;
    const cy = y + this.config.ball.centerMeters;
    this.chunks.throw(x, cy, z, floor, c.plates, c.plateSpeed, c.plateLift, c.plateSize, c.plateSeconds, this.plateColors);
    for (let i = 0; i < c.fireballs; i++) {
      const s = this.sprites.fire.spawn();
      if (!s) break;
      const a = (i / c.fireballs) * Math.PI * 2;
      const r = this.config.ball.radiusMeters * 0.7;
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
