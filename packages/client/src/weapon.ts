import * as THREE from "three";
import type { WeaponStats } from "@rustbucket/shared";
import { createRayHit, raycastBoxes, type Box, type MechState } from "@rustbucket/shared";
import type { TimedEffects } from "./effects";
import type { Projectiles } from "./projectiles";
import type { ThirdPersonCamera } from "./thirdPersonCamera";

const hit = createRayHit();
const camPos = new THREE.Vector3();
const camDir = new THREE.Vector3();

// Where the gun barrel sits relative to the mech, in the mech's own frame (right, up, forward).
const MUZZLE_RIGHT = 1.2;
const MUZZLE_UP = 2.4;
const MUZZLE_FORWARD = 1.4;

// Fires pooled projectiles at whatever the crosshair points at.
// GUESS: shots aim from the muzzle to the camera ray's hit point. The rule for when the camera ray
// and the barrel disagree is still open in docs/DECISIONS.md (decide at M3).
export class Weapon {
  private nextShotTime = 0;

  constructor(
    private stats: WeaponStats,
    private projectiles: Projectiles,
    private flashes: TimedEffects,
    private cameraRig: ThirdPersonCamera,
  ) {}

  update(simTime: number, wantsFire: boolean, mech: MechState, boxes: readonly Box[]): void {
    if (!wantsFire || simTime < this.nextShotTime) return;
    this.nextShotTime = simTime + 1 / this.stats.shotsPerSecond;
    this.fire(mech, boxes);
  }

  private fire(mech: MechState, boxes: readonly Box[]): void {
    const camera = this.cameraRig.camera;
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    const range = this.stats.maxAimDistance;

    // Aim point is where the camera's centre ray lands.
    let tx = camPos.x + camDir.x * range;
    let ty = camPos.y + camDir.y * range;
    let tz = camPos.z + camDir.z * range;
    if (raycastBoxes(camPos.x, camPos.y, camPos.z, camDir.x, camDir.y, camDir.z, range, boxes, hit)) {
      tx = camPos.x + camDir.x * hit.distance;
      ty = camPos.y + camDir.y * hit.distance;
      tz = camPos.z + camDir.z * hit.distance;
    }

    const sin = Math.sin(mech.bodyYaw), cos = Math.cos(mech.bodyYaw);
    const mx = mech.x + cos * MUZZLE_RIGHT - sin * MUZZLE_FORWARD;
    const my = mech.y + MUZZLE_UP;
    const mz = mech.z - sin * MUZZLE_RIGHT - cos * MUZZLE_FORWARD;

    let dx = tx - mx, dy = ty - my, dz = tz - mz;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length; dy /= length; dz /= length;

    // Random cone: nudge the direction sideways and up by a small angle.
    const spread = (this.stats.spreadDegrees * Math.PI) / 180;
    dx += (Math.random() - 0.5) * 2 * spread;
    dy += (Math.random() - 0.5) * 2 * spread;
    dz += (Math.random() - 0.5) * 2 * spread;
    const n = Math.hypot(dx, dy, dz);
    dx /= n; dy /= n; dz /= n;

    this.projectiles.spawn(mx, my, mz, dx, dy, dz, this.stats.projectileSpeed, this.stats.projectileLifetime);
    this.flashes.spawn(mx + dx, my + dy, mz + dz, 0.05);
    this.cameraRig.addShake(this.stats.shakeForce);
  }
}
