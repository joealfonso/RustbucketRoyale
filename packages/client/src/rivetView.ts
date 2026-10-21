import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { vfxConfig } from "./fx/quality";
import { FRAMES } from "./fx/spriteArt";
import { BILLBOARD, SpritePool } from "./fx/sprites";
import type { MechModel } from "./mechModel";
import { fuseBlink, type RivetLook } from "./weaponFxData";

// The rivet gun's rivets (gate 18b): each one drawn stuck where it hit, in a wall, the ground or riding on a mech at
// its spot on the body, with a fuse light blinking faster in steps until it pops. Online the server pops them (its
// explode messages are matched to the rivet they came from, so the pop is drawn rivet sized); offline there is no
// server, so this pops them itself when the fuse runs out. Detonating them all pops them one after another, a ripple.
// Everything is pooled: a rivet is a slot, drawn as one instance of one mesh.

export interface StuckRivet {
  owner: number; // who fired it
  id: number; // the server's id for it, or a local one offline
  x: number; y: number; z: number; // where it is in the world (on a mech: where it was when it stuck)
  outX: number; outY: number; outZ: number; // the way its head faces, out of what it hit
  mech: number; // the mech it rides on, or -1 for the map
  // On a mech, its spot in that mech's own frame when the server says it (more exact than the mech as drawn here).
  local?: { x: number; y: number; z: number };
  fuseSeconds: number;
}

interface Slot {
  live: boolean;
  owner: number; id: number;
  x: number; y: number; z: number;
  outX: number; outY: number; outZ: number;
  mech: number;
  // On a mech: where it sits and faces in the mech's own frame (turned by its body yaw), so it rides along.
  lx: number; ly: number; lz: number; lox: number; loy: number; loz: number;
  age: number; fuse: number;
  popIn: number; // -1, or seconds until this rivet's pop is drawn (a detonation's ripple, or the server's blast waiting its turn)
  ghost: number; // seconds a popped rivet's spot is still remembered, so the server's blast for it is not drawn twice
}

const UP = new THREE.Vector3(0, 1, 0);
// A rivet whose pop never came (the blast was out of range, or the message lost) is cleared this long after its fuse.
const FORGET_AFTER_SECONDS = 1.5;
// A rivet popped here (from a detonation drawn at once) swallows the server's blast for it for this long: a round trip
// and then some.
const GHOST_SECONDS = 1.2;

export class RivetView {
  private slots: Slot[] = [];
  private next = 0;
  private mesh: THREE.InstancedMesh;
  private glow: SpritePool;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private dir = new THREE.Vector3();
  private at = new THREE.Vector3();
  private scale = new THREE.Vector3(1, 1, 1);
  // Draws a pop: the explosion look at the rivet's spot, `radius` metres.
  onPop?: (x: number, y: number, z: number, radius: number) => void;
  // Offline only: pops when the fuse runs out, as the server would.
  popOwnFuses = false;

  // `radius` is a pop's size (weapons.json blastRadius, read live so tuning shows); `modelOf` finds a mech as drawn.
  constructor(
    scene: THREE.Scene, private look: RivetLook, material: THREE.Material, color: (name: string) => string,
    private modelOf: (mech: number) => MechModel | null, private radius: () => number,
  ) {
    for (let i = 0; i < look.pool; i++) {
      this.slots.push({ live: false, owner: 0, id: 0, x: 0, y: 0, z: 0, outX: 0, outY: 1, outZ: 0, mech: -1, lx: 0, ly: 0, lz: 0, lox: 0, loy: 0, loz: 0, age: 0, fuse: 0, popIn: -1, ghost: 0 });
    }
    // The shank stands out of the surface along +Y and the head caps it: a fat, stubby hex rivet that reads at range.
    const r = look.headMeters / 2;
    const shank = new THREE.CylinderGeometry(r * 0.45, r * 0.45, look.shankMeters, 6);
    shank.translate(0, look.shankMeters / 2, 0);
    const head = new THREE.CylinderGeometry(r * 0.75, r, r * 0.7, 6);
    head.translate(0, look.shankMeters + r * 0.35, 0);
    this.mesh = new THREE.InstancedMesh(mergeGeometries([shank, head])!, material, look.pool);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    const { growSteps, palettes } = vfxConfig.sprites;
    this.glow = new SpritePool(scene, { colors: palettes.fire as [string, string, string], growSteps }, color, 0, () => 0, look.pool);
  }

  // A rivet stuck. On a mech its spot is kept in that mech's frame from where the mech is drawn now.
  stick(r: StuckRivet): void {
    const s = this.take();
    s.live = true; s.owner = r.owner; s.id = r.id;
    s.x = r.x; s.y = r.y; s.z = r.z;
    const l = Math.hypot(r.outX, r.outY, r.outZ) || 1;
    s.outX = r.outX / l; s.outY = r.outY / l; s.outZ = r.outZ / l;
    s.mech = r.mech; s.age = 0; s.fuse = r.fuseSeconds; s.popIn = -1; s.ghost = 0;
    const model = r.mech >= 0 ? this.modelOf(r.mech) : null;
    if (model) {
      const p = model.group.position, yaw = model.group.rotation.y;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      // The inverse of the muzzle turn (computeShot): world offset back into the mech's own frame.
      const dx = r.x - p.x, dz = r.z - p.z;
      if (r.local) { s.lx = r.local.x; s.ly = r.local.y; s.lz = r.local.z; }
      else { s.lx = cos * dx - sin * dz; s.ly = r.y - p.y; s.lz = sin * dx + cos * dz; }
      s.lox = cos * s.outX - sin * s.outZ; s.loy = s.outY; s.loz = sin * s.outX + cos * s.outZ;
    } else {
      s.mech = -1;
    }
  }

  // A free slot, or the next in turn when all are in use (that rivet simply goes).
  private take(): Slot {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[(this.next + i) % this.slots.length]!;
      if (!s.live) { this.next = (this.next + i + 1) % this.slots.length; return s; }
    }
    const s = this.slots[this.next]!;
    this.next = (this.next + 1) % this.slots.length;
    return s;
  }

  // How many of `owner`'s rivets are stuck and not yet popping, for the HUD.
  countOf(owner: number): number {
    let n = 0;
    for (const s of this.slots) if (s.live && s.owner === owner && s.popIn < 0) n++;
    return n;
  }

  // Every one of `owner`'s rivets goes, one after another, about oldest first. Offline this is
  // the whole detonation; online the server's blasts that follow are matched to rivets already popping and skipped.
  detonate(owner: number): number {
    let order = 0;
    for (const s of this.slots) {
      if (!s.live || s.owner !== owner || s.popIn >= 0) continue;
      s.popIn = order++ * this.look.rippleSeconds;
    }
    return order;
  }

  // The server says this rivet popped (its explode message): it pops now, unless it is already popping in a ripple or
  // was drawn popping already. False when it was never seen here, so the caller draws the blast itself.
  popById(id: number): boolean {
    for (const s of this.slots) {
      if (s.id !== id || (!s.live && s.ghost <= 0)) continue;
      if (!s.live) { s.ghost = 0; return true; }
      if (s.popIn < 0) s.popIn = 0;
      return true;
    }
    return false;
  }

  // Offline, at the cap: the oldest of `owner`'s rivets pops to make room, as the server does.
  popOldest(owner: number): void {
    let oldest: Slot | null = null;
    for (const s of this.slots) if (s.live && s.owner === owner && s.popIn < 0 && (!oldest || s.age > oldest.age)) oldest = s;
    if (oldest) oldest.popIn = 0;
  }

  clear(): void {
    for (const s of this.slots) { s.live = false; s.ghost = 0; }
  }

  private pop(s: Slot, radius: number): void {
    this.place(s);
    s.live = false;
    s.ghost = GHOST_SECONDS;
    this.onPop?.(s.x, s.y, s.z, radius);
  }

  // Each frame, after the mechs are placed: rivets on mechs follow them, fuses burn, pops go off.
  update(dt: number, camera: THREE.Vector3): void {
    const look = this.look;
    let n = 0;
    for (const s of this.slots) {
      if (!s.live) { if (s.ghost > 0) s.ghost -= dt; continue; }
      s.age += dt;
      if (s.popIn >= 0) {
        s.popIn -= dt;
        if (s.popIn <= 0) { this.pop(s, this.radius()); continue; }
      } else if (this.popOwnFuses && s.age >= s.fuse) {
        this.pop(s, this.radius()); continue;
      } else if (s.age >= s.fuse + FORGET_AFTER_SECONDS) {
        s.live = false; continue;
      }
      if (!this.place(s)) continue;
      // The rivet: shank and head along its outward direction.
      this.dir.set(s.outX, s.outY, s.outZ);
      this.quat.setFromUnitVectors(UP, this.dir);
      this.at.set(s.x, s.y, s.z);
      this.matrix.compose(this.at, this.quat, this.scale);
      this.mesh.setMatrixAt(n++, this.matrix);
      // The fuse light on its head, blinking faster in steps. A rivet in a ripple glows full until it goes.
      const step = s.popIn >= 0 ? look.fuse.steps - 1 : fuseBlink(s.age, s.fuse, look.fuse.steps, look.fuse.slowHz, look.fuse.fastHz);
      if (step < 0) continue;
      const g = this.glow.draw();
      if (!g) continue;
      const out = look.shankMeters + look.headMeters * 0.5;
      g.mode = BILLBOARD;
      g.x = s.x + s.outX * out; g.y = s.y + s.outY * out; g.z = s.z + s.outZ * out;
      const share = look.fuse.steps > 1 ? step / (look.fuse.steps - 1) : 1;
      g.size0 = g.size1 = look.fuse.sizes[0] + (look.fuse.sizes[1] - look.fuse.sizes[0]) * share;
      g.frame0 = FRAMES.fireball.first + (step % FRAMES.fireball.count);
      g.spin = (s.id % 7) * 0.9;
      g.fadeShare = 0;
    }
    this.mesh.count = n;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.update(0, camera);
  }

  // Where a rivet is now: on a mech, from where the mech is drawn. False when its mech is not drawn.
  private place(s: Slot): boolean {
    if (s.mech < 0) return true;
    const model = this.modelOf(s.mech);
    if (!model || !model.group.visible) return false;
    const p = model.group.position, yaw = model.group.rotation.y;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    s.x = p.x + cos * s.lx + sin * s.lz;
    s.y = p.y + s.ly;
    s.z = p.z - sin * s.lx + cos * s.lz;
    s.outX = cos * s.lox + sin * s.loz;
    s.outY = s.loy;
    s.outZ = -sin * s.lox + cos * s.loz;
    return true;
  }
}
