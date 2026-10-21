import * as THREE from "three";
import { createRayHit, type CameraStats, type World } from "@rustbucket/shared";

const euler = new THREE.Euler(0, 0, 0, "YXZ");
const quaternion = new THREE.Quaternion();
const offset = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const sample = new THREE.Vector3();
const hit = createRayHit();

// Over the shoulder camera that never goes through walls: it casts five rays from the pivot
// (a small cross) toward the wanted position and sits in front of the nearest hit.
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  private currentDistanceFraction = 1;
  private trauma = 0;
  private fovKick = 0;
  private zoomTo: number | null = null;
  private zoom: number;
  private pullBack = 0; // extra metres back and up while dropping in (diveCamera.ts)
  private lift = 0;
  private fovExtra = 0; // extra degrees, set each frame by the dive

  constructor(private stats: CameraStats, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(stats.fov, aspect, stats.near, 3000);
    this.zoom = stats.fov;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // Narrows the view to this many degrees while a scope is up (the Longshot's Rail Shot charging), or back with null.
  setZoom(fov: number | null): void {
    this.zoomTo = fov;
  }

  // How much narrower than normal the view is now: 1 normally, less while zoomed. Aim turns this much slower, so the
  // crosshair moves across the screen at the same speed zoomed or not.
  get zoomShare(): number {
    return this.camera.fov / this.stats.fov;
  }

  // Pushes the field of view out while dashing and eases it back. Uses the camera's own fov as the base.
  setFovKick(target: number, dt: number): void {
    this.fovKick += (target - this.fovKick) * Math.min(1, dt * 14);
    this.zoom += ((this.zoomTo ?? this.stats.fov) - this.zoom) * Math.min(1, dt * 12);
    const fov = this.zoom + this.fovKick * this.stats.dashFovKick + this.fovExtra;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // Sits the camera this many metres further back and higher than camera.json says, for this frame on.
  setPull(back: number, lift: number): void {
    this.pullBack = back;
    this.lift = lift;
  }

  // Widens the view by this many degrees on top of everything else, applied with the next setFovKick.
  setFovExtra(degrees: number): void {
    this.fovExtra = degrees;
  }

  // Screen shake strength, added by each shot. Decays on its own.
  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(px: number, py: number, pz: number, yaw: number, pitch: number, world: World, dt: number): void {
    const s = this.stats;
    py += this.lift;
    euler.set(pitch, yaw, 0);
    quaternion.setFromEuler(euler);
    right.set(1, 0, 0).applyQuaternion(quaternion);
    up.set(0, 1, 0).applyQuaternion(quaternion);
    // Local +Z points back from where the camera looks.
    offset.set(s.shoulderX, 0, s.distance + this.pullBack).applyQuaternion(quaternion);

    const length = offset.length();
    const dirX = offset.x / length, dirY = offset.y / length, dirZ = offset.z / length;

    // Stay a lens radius short of anything we hit; with no hit the camera sits at full distance.
    let nearest = length + s.radius;
    for (let i = 0; i < 5; i++) {
      const sx = i === 1 ? s.radius : i === 2 ? -s.radius : 0;
      const sy = i === 3 ? s.radius : i === 4 ? -s.radius : 0;
      sample.set(px, py, pz).addScaledVector(right, sx).addScaledVector(up, sy);
      if (world.raycast(sample.x, sample.y, sample.z, dirX, dirY, dirZ, length, hit)) {
        nearest = Math.min(nearest, hit.distance);
      }
    }

    // Snap in at once so the lens never sees inside a wall, ease back out so it does not pop.
    const wanted = Math.min(length, Math.max(0.2, nearest - s.radius)) / length;
    if (wanted < this.currentDistanceFraction) this.currentDistanceFraction = wanted;
    else this.currentDistanceFraction = Math.min(wanted, this.currentDistanceFraction + (s.pullOutSpeed * dt) / length);

    const f = this.currentDistanceFraction;
    this.camera.position.set(px + offset.x * f, py + offset.y * f, pz + offset.z * f);
    this.camera.quaternion.copy(quaternion);

    if (this.trauma > 0) {
      const shake = this.trauma * this.trauma * 0.3;
      this.camera.position.addScaledVector(right, (Math.random() - 0.5) * shake);
      this.camera.position.addScaledVector(up, (Math.random() - 0.5) * shake);
      this.trauma = Math.max(0, this.trauma - dt * 3);
    }
  }
}
