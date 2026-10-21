import * as THREE from "three";
import { CardBatch } from "./fx/cards";
import { FRAMES } from "./fx/spriteArt";
import { AXIS, type SpritePool } from "./fx/sprites";
import type { MechModel } from "./mechModel";
import type { HarpoonLook } from "./weaponFxData";

// The magnet harpoon (gate 18b): a barbed head on a thin inked cable that flies out of the muzzle, latches onto what
// it hit (a mech, a pickup, a crate, the map), holds taut while the pull happens, then winds back in. The cable always
// runs from the shooter's muzzle as drawn to the head, so a reel shortens it as the shooter is dragged along it and a
// yank shortens it as the target comes in. The pull itself is the server's (and your own prediction's); this only
// draws it. One harpoon per shooter at a time, all pooled.

export const ANCHOR_WORLD = 0;
export const ANCHOR_MECH = 1;
export const ANCHOR_PICKUP = 2;

const FLYING = 0, LATCHED = 1, RETRACTING = 2;

interface Harpoon {
  live: boolean;
  shooter: number;
  reel: boolean;
  state: number;
  x: number; y: number; z: number; // the head
  dx: number; dy: number; dz: number; // its flight
  left: number; // metres still to fly
  waiting: number; // arrived with nothing latched yet: seconds left before it gives up and winds in
  anchored: boolean; // a latch is due where this flight ends
  kind: number; target: number;
  lx: number; ly: number; lz: number; // on a mech: the latch spot in its own frame
  hold: number; // seconds left latched
  tug: number; // seconds to the next spit of tug sparks
  ox: number; oy: number; oz: number; // the muzzle when it fired: the cable's end if the shooter is not drawn
}

// A barbed head along -Z in the XZ plane, 1 m long and 1 m wide, the tip at z = 0: the face colour round a darker
// core down the middle, like the needle tracers (cards.ts).
function headCard(outer: string, core: string): THREE.BufferGeometry {
  const c = new THREE.Color();
  const positions: number[] = [], colors: number[] = [];
  const tri = (hex: string, ...p: number[]) => {
    positions.push(p[0]!, 0, p[1]!, p[2]!, 0, p[3]!, p[4]!, 0, p[5]!);
    c.set(hex);
    for (let i = 0; i < 3; i++) colors.push(c.r, c.g, c.b);
  };
  // The tip and its two barbs swept back, then the shaft.
  tri(outer, 0, 0, -0.5, -0.55, -0.16, -0.38);
  tri(outer, 0, 0, 0.16, -0.38, 0.5, -0.55);
  tri(core, 0, 0, -0.16, -0.38, 0.16, -0.38);
  tri(outer, -0.12, -0.38, 0.12, -0.38, 0.12, -1);
  tri(outer, -0.12, -0.38, 0.12, -1, -0.12, -1);
  tri(core, -0.04, -0.38, 0.04, -0.38, 0.04, -1);
  tri(core, -0.04, -0.38, 0.04, -1, -0.04, -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

// A plain strip along -Z, 1 m by 1 m: the ink colour at both edges and a lighter core, so the cable reads as a drawn
// line over any ground.
function cableCard(ink: string, core: string, coreShare: number): THREE.BufferGeometry {
  const c = new THREE.Color();
  const positions: number[] = [], colors: number[] = [];
  const e = coreShare / 2;
  for (const [x0, x1, hex] of [[-0.5, -e, ink], [-e, e, core], [e, 0.5, ink]] as const) {
    positions.push(x0, 0, 0, x1, 0, 0, x1, 0, -1, x0, 0, 0, x1, 0, -1, x0, 0, -1);
    c.set(hex);
    for (let i = 0; i < 6; i++) colors.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

export class HarpoonView {
  private harpoons: Harpoon[] = [];
  private heads: CardBatch;
  private cables: CardBatch;
  private muzzle = { x: 0, y: 0, z: 0 };
  private spot = { x: 0, y: 0, z: 0 };
  // A harpoon latched: what on, where, and whether it is a reel. Sound and the hit flash go here.
  onLatch?: (shooter: number, kind: number, target: number, x: number, y: number, z: number, reel: boolean) => void;

  constructor(
    scene: THREE.Scene, private look: HarpoonLook, color: (name: string) => string, weaponColor: string, private sparks: SpritePool,
    // Where a shooter's barrel ends as drawn now, or false when they are not drawn.
    private muzzleOf: (shooter: number, out: { x: number; y: number; z: number }) => boolean,
    private modelOf: (mech: number) => MechModel | null,
    private pickupAt: (id: number, out: { x: number; y: number; z: number }) => boolean,
  ) {
    for (let i = 0; i < look.pool; i++) {
      this.harpoons.push({ live: false, shooter: 0, reel: false, state: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, left: 0, waiting: 0, anchored: false, kind: 0, target: -1, lx: 0, ly: 0, lz: 0, hold: 0, tug: 0, ox: 0, oy: 0, oz: 0 });
    }
    this.heads = new CardBatch(scene, headCard(weaponColor, color(look.head.core)), look.pool);
    this.cables = new CardBatch(scene, cableCard(color(look.cable.color), color(look.cable.core), look.cable.coreShare), look.pool);
  }

  // A shooter's harpoon, or a fresh one (their last one goes: one harpoon each).
  private of(shooter: number, fresh: boolean): Harpoon | null {
    let free: Harpoon | null = null;
    for (const h of this.harpoons) {
      if (h.live && h.shooter === shooter) return h;
      if (!h.live && !free) free = h;
    }
    return fresh ? free ?? this.harpoons[0]! : null;
  }

  // A harpoon leaves the muzzle at (ox, oy, oz) along (dx, dy, dz) and flies `length` metres, where the shot ends.
  fire(shooter: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number, reel: boolean): void {
    const h = this.of(shooter, true)!;
    h.live = true; h.shooter = shooter; h.reel = reel; h.state = FLYING;
    h.x = ox; h.y = oy; h.z = oz; h.ox = ox; h.oy = oy; h.oz = oz;
    h.dx = dx; h.dy = dy; h.dz = dz; h.left = length;
    h.waiting = this.look.missSeconds; h.anchored = false; h.kind = ANCHOR_WORLD; h.target = -1; h.hold = 0; h.tug = 0;
  }

  // The harpoon caught something at (x, y, z): it flies on to there if it is not there yet, then holds for `holdSeconds`.
  latch(shooter: number, kind: number, target: number, x: number, y: number, z: number, reel: boolean, holdSeconds = this.look.holdSeconds): void {
    let h = this.of(shooter, false);
    if (!h || h.state === RETRACTING) {
      // Its flight was never seen (it came from out of view): it starts at the muzzle now.
      if (!this.muzzleOf(shooter, this.muzzle)) { this.muzzle.x = x; this.muzzle.y = y; this.muzzle.z = z; }
      this.fire(shooter, this.muzzle.x, this.muzzle.y, this.muzzle.z, 0, 0, 1, 0, reel);
      h = this.of(shooter, false)!;
    }
    // Already holding there (your own reel, latched from prediction, then the server's word on it): only the time changes.
    if (h.state === LATCHED && h.kind === kind && h.target === target && Math.hypot(x - h.x, y - h.y, z - h.z) < 2) { h.hold = holdSeconds; return; }
    h.reel = reel; h.kind = kind; h.target = target; h.hold = holdSeconds; h.anchored = true;
    const dx = x - h.x, dy = y - h.y, dz = z - h.z, d = Math.hypot(dx, dy, dz);
    if (d > 1e-3) { h.dx = dx / d; h.dy = dy / d; h.dz = dz / d; }
    h.left = d;
    h.state = FLYING;
  }

  // The pull is over: the head winds back in.
  release(shooter: number): void {
    const h = this.of(shooter, false);
    if (h) h.state = RETRACTING;
  }

  // Whether `shooter` is being reeled toward a latched harpoon right now.
  reeling(shooter: number): boolean {
    const h = this.of(shooter, false);
    return h !== null && h.reel && h.state === LATCHED;
  }

  clear(): void {
    for (const h of this.harpoons) h.live = false;
  }

  private settle(h: Harpoon): void {
    h.state = LATCHED;
    h.tug = 0;
    if (h.kind === ANCHOR_MECH) {
      const model = this.modelOf(h.target);
      if (!model) { h.kind = ANCHOR_WORLD; } else {
        const p = model.group.position, yaw = model.group.rotation.y;
        const sin = Math.sin(yaw), cos = Math.cos(yaw), dx = h.x - p.x, dz = h.z - p.z;
        h.lx = cos * dx - sin * dz; h.ly = h.y - p.y; h.lz = sin * dx + cos * dz;
      }
    }
    this.onLatch?.(h.shooter, h.kind, h.target, h.x, h.y, h.z, h.reel);
  }

  // On the sim clock or once a frame: heads fly, latches follow what they hold, cables wind in.
  update(dt: number): void {
    const look = this.look;
    for (const h of this.harpoons) {
      if (!h.live) continue;
      if (h.state === FLYING) {
        const step = Math.min(h.left, look.speed * dt);
        h.x += h.dx * step; h.y += h.dy * step; h.z += h.dz * step; h.left -= step;
        if (h.left > 0) continue;
        if (h.anchored) this.settle(h);
        else if ((h.waiting -= dt) <= 0) h.state = RETRACTING;
      } else if (h.state === LATCHED) {
        this.follow(h);
        this.tugSparks(h, dt);
        if ((h.hold -= dt) <= 0) h.state = RETRACTING;
      } else {
        const m = this.muzzleOf(h.shooter, this.muzzle) ? this.muzzle : null;
        const tx = m ? m.x : h.ox, ty = m ? m.y : h.oy, tz = m ? m.z : h.oz;
        const dx = tx - h.x, dy = ty - h.y, dz = tz - h.z, d = Math.hypot(dx, dy, dz);
        const step = look.retractSpeed * dt;
        if (d <= step) { h.live = false; continue; }
        h.x += (dx / d) * step; h.y += (dy / d) * step; h.z += (dz / d) * step;
      }
    }
  }

  // The head stays on what it holds: a mech's spot as it is dragged, a pickup as it slides in.
  private follow(h: Harpoon): void {
    if (h.kind === ANCHOR_MECH) {
      const model = this.modelOf(h.target);
      if (!model) return;
      const p = model.group.position, yaw = model.group.rotation.y;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      h.x = p.x + cos * h.lx + sin * h.lz; h.y = p.y + h.ly; h.z = p.z - sin * h.lx + cos * h.lz;
    } else if (h.kind === ANCHOR_PICKUP && this.pickupAt(h.target, this.spot)) {
      h.x = this.spot.x; h.y = this.spot.y; h.z = this.spot.z;
    }
  }

  // Sparks spitting off the latch while the cable is taut: the magnet biting.
  private tugSparks(h: Harpoon, dt: number): void {
    const t = this.look.tug;
    if ((h.tug -= dt) > 0) return;
    h.tug = t.everySeconds;
    for (let i = 0; i < t.sparks; i++) {
      const s = this.sparks.spawn();
      if (!s) return;
      const a = Math.random() * Math.PI * 2;
      s.mode = AXIS; s.streak = 0.05;
      s.x = h.x; s.y = h.y; s.z = h.z;
      // Mostly back along the cable, toward the shooter: the pull throws them that way.
      s.vx = (-h.dx + Math.cos(a) * 0.7) * t.sparkSpeed; s.vy = (0.4 + Math.random() * 0.6) * t.sparkSpeed; s.vz = (-h.dz + Math.sin(a) * 0.7) * t.sparkSpeed;
      s.gravity = 20; s.floor = h.y - 3;
      s.life = 0.2 + Math.random() * 0.15;
      s.size0 = s.size1 = 0.12; s.aspect = 2;
      s.frame0 = FRAMES.spark.first;
      s.fadeShare = 0.3;
    }
  }

  // Once a frame: each cable from its shooter's muzzle to its head, and the head pointing away down the cable.
  draw(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.heads.begin();
    this.cables.begin();
    const look = this.look;
    for (const h of this.harpoons) {
      if (!h.live) continue;
      const m = this.muzzleOf(h.shooter, this.muzzle) ? this.muzzle : null;
      const mx = m ? m.x : h.ox, my = m ? m.y : h.oy, mz = m ? m.z : h.oz;
      let dx = h.x - mx, dy = h.y - my, dz = h.z - mz;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.05) continue;
      dx /= d; dy /= d; dz /= d;
      // The cable stops at the back of the head, so the barbs sit on its end.
      const cable = d - look.head.lengthMeters * 0.8;
      if (cable > 0) this.cables.along(camera, h.x - dx * look.head.lengthMeters * 0.8, h.y - dy * look.head.lengthMeters * 0.8, h.z - dz * look.head.lengthMeters * 0.8, dx, dy, dz, look.cable.widthMeters, cable);
      this.heads.along(camera, h.x, h.y, h.z, dx, dy, dz, look.head.widthMeters, Math.min(d, look.head.lengthMeters));
    }
    this.heads.end();
    this.cables.end();
  }
}
