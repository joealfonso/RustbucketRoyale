import * as THREE from "three";
import { createRayHit, raycastBoxes, type Box, type CameraStats } from "@rustbucket/shared";

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

  constructor(private stats: CameraStats, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(stats.fov, aspect, stats.near, 3000);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // Screen shake strength, added by each shot. Decays on its own.
  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(px: number, py: number, pz: number, yaw: number, pitch: number, boxes: readonly Box[], dt: number): void {
    const s = this.stats;
    euler.set(pitch, yaw, 0);
    quaternion.setFromEuler(euler);
    right.set(1, 0, 0).applyQuaternion(quaternion);
    up.set(0, 1, 0).applyQuaternion(quaternion);
    // Local +Z points back from where the camera looks.
    offset.set(s.shoulderX, 0, s.distance).applyQuaternion(quaternion);

    const length = offset.length();
    const dirX = offset.x / length, dirY = offset.y / length, dirZ = offset.z / length;

    // Stay a lens radius short of anything we hit; with no hit the camera sits at full distance.
    let nearest = length + s.radius;
    for (let i = 0; i < 5; i++) {
      const sx = i === 1 ? s.radius : i === 2 ? -s.radius : 0;
      const sy = i === 3 ? s.radius : i === 4 ? -s.radius : 0;
      sample.set(px, py, pz).addScaledVector(right, sx).addScaledVector(up, sy);
      if (raycastBoxes(sample.x, sample.y, sample.z, dirX, dirY, dirZ, length, boxes, hit)) {
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
