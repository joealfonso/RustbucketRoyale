import * as THREE from "three";
import { createRayHit, type World } from "@rustbucket/shared";

// What the Longshot's Rail Shot looks like (gate 15b). While it charges, a thin laser runs from its gun to the first
// thing in the way, with a glint at the lens, so the mech being aimed at sees it coming and can get behind a rock.
// When it fires, a white-hot beam flashes along the same line for a moment. Everything is made at start and reused:
// a few lasers and beams, placed each frame, nothing allocated while playing.

const LASERS = 6;
const BEAM_SECONDS = 0.25;
const GUN_HEIGHT = 2.5; // metres above the feet: the stand-in's gun arm; the real model's muzzle replaces it in 15c
const GUN_SIDE = 1.2; // metres right of the middle

interface Laser { mesh: THREE.Mesh; glint: THREE.Mesh; ownerId: number; until: number }
interface Beam { mesh: THREE.Mesh; until: number }

const unitLine = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5); // one metre long, from its origin forward (-z)
const glintShape = new THREE.OctahedronGeometry(0.25);

export interface RailPose { x: number; y: number; z: number; yaw: number; pitch: number }

export class RailFx {
  readonly group = new THREE.Group();
  private lasers: Laser[] = [];
  private beams: Beam[] = [];
  private hit = createRayHit();
  private from = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(laserColor: string, beamColor: string, private range: number) {
    const laserMaterial = new THREE.MeshBasicMaterial({ color: laserColor, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    for (let i = 0; i < LASERS; i++) {
      const mesh = new THREE.Mesh(unitLine, laserMaterial);
      const glint = new THREE.Mesh(glintShape, laserMaterial);
      mesh.visible = glint.visible = false;
      this.group.add(mesh, glint);
      this.lasers.push({ mesh, glint, ownerId: -1, until: 0 });
      const beam = new THREE.Mesh(unitLine, new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, depthWrite: false, fog: false }));
      beam.visible = false;
      this.group.add(beam);
      this.beams.push({ mesh: beam, until: 0 });
    }
  }

  // Someone started charging: their laser shows until the charge is over (or they are no longer seen).
  charge(ownerId: number, seconds: number, nowMs: number): void {
    const laser = this.lasers.find((l) => l.ownerId === ownerId) ?? this.lasers.find((l) => l.until <= nowMs) ?? this.lasers[0]!;
    laser.ownerId = ownerId;
    laser.until = nowMs + seconds * 1000;
  }

  // The shot went off from someone's gun to (x, y, z): their laser goes and a beam flashes along the line.
  fire(ownerId: number, from: { x: number; y: number; z: number }, toX: number, toY: number, toZ: number, nowMs: number): void {
    for (const l of this.lasers) if (l.ownerId === ownerId) { l.until = 0; l.mesh.visible = l.glint.visible = false; }
    const beam = this.beams.find((b) => b.until <= nowMs) ?? this.beams[0]!;
    beam.until = nowMs + BEAM_SECONDS * 1000;
    this.place(beam.mesh, from.x, from.y + GUN_HEIGHT, from.z, toX, toY, toZ, 0.18);
    beam.mesh.visible = true;
  }

  // Each frame. `pose` finds where a mech is and which way it aims (false if it cannot be seen).
  update(nowMs: number, world: World, pose: (id: number, out: RailPose) => boolean, out: RailPose): void {
    for (const l of this.lasers) {
      const live = l.until > nowMs && pose(l.ownerId, out);
      l.mesh.visible = l.glint.visible = live;
      if (!live) continue;
      const cos = Math.cos(out.pitch);
      this.dir.set(-Math.sin(out.yaw) * cos, Math.sin(out.pitch), -Math.cos(out.yaw) * cos);
      // The gun sits to the right of the middle: right is forward turned a quarter clockwise, seen from above.
      this.from.set(out.x - Math.cos(out.yaw) * GUN_SIDE, out.y + GUN_HEIGHT, out.z + Math.sin(out.yaw) * GUN_SIDE);
      const length = world.raycast(this.from.x, this.from.y, this.from.z, this.dir.x, this.dir.y, this.dir.z, this.range, this.hit) ? this.hit.distance : this.range;
      this.place(l.mesh, this.from.x, this.from.y, this.from.z, this.from.x + this.dir.x * length, this.from.y + this.dir.y * length, this.from.z + this.dir.z * length, 0.05);
      // The glint throbs in two hard steps, so it reads as a lens catching the light, not as a lamp.
      l.glint.position.copy(this.from);
      l.glint.scale.setScalar(Math.floor(nowMs / 120) % 2 ? 1.6 : 1);
    }
    for (const b of this.beams) {
      if (!b.mesh.visible) continue;
      const left = (b.until - nowMs) / (BEAM_SECONDS * 1000);
      if (left <= 0) { b.mesh.visible = false; continue; }
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = left;
    }
  }

  // Stretches the unit line from one point to another, `width` metres thick.
  private place(mesh: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number): void {
    mesh.position.set(ax, ay, az);
    mesh.lookAt(bx, by, bz);
    mesh.rotateY(Math.PI); // lookAt points +z at the target; the line runs along -z
    mesh.scale.set(width, width, Math.hypot(bx - ax, by - ay, bz - az));
  }
}
