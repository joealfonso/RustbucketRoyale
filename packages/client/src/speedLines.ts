import * as THREE from "three";
import type { DiveConfig } from "./dive";
import { share } from "./dive";

// Thin streaks of wind rushing past the camera while you dive, more of them showing the faster you fall. One line
// mesh made at the start; each streak is a spot near the camera that drifts against your fall and wraps round when
// it passes, so nothing is made while playing. Kept off the middle of the view, where the ground you aim at is.
export class SpeedLines {
  readonly mesh: THREE.LineSegments;
  private material: THREE.LineBasicMaterial;
  private positions: Float32Array;
  private spots: Float32Array; // x, y, z of each streak, relative to the camera
  private attribute: THREE.BufferAttribute;

  constructor(private config: DiveConfig["speedLines"], color: string) {
    const n = Math.floor(config.count);
    this.positions = new Float32Array(n * 6);
    this.spots = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.place(i, Math.random() * 2 - 1, 0, -1, 0);
    const geometry = new THREE.BufferGeometry();
    this.attribute = new THREE.BufferAttribute(this.positions, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.attribute);
    this.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.mesh = new THREE.LineSegments(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  // Each frame: where the camera is and how you are moving (m/s). Fast enough, the streaks show.
  update(camera: THREE.Vector3, vx: number, vy: number, vz: number, dt: number): void {
    const c = this.config;
    const speed = Math.hypot(vx, vy, vz);
    const strength = share(speed, c.fromSpeed, c.fullSpeed);
    this.mesh.visible = strength > 0;
    if (!this.mesh.visible) return;
    this.material.opacity = strength * c.opacity;
    const dx = vx / speed, dy = vy / speed, dz = vz / speed;
    const n = this.spots.length / 3;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      // The air stands still, so seen from the camera it comes at you against your travel.
      let x = this.spots[o]! - vx * dt, y = this.spots[o + 1]! - vy * dt, z = this.spots[o + 2]! - vz * dt;
      const along = x * dx + y * dy + z * dz;
      if (along < -c.radiusMeters) {
        this.place(i, 1, dx, dy, dz);
        x = this.spots[o]!; y = this.spots[o + 1]!; z = this.spots[o + 2]!;
      } else {
        this.spots[o] = x; this.spots[o + 1] = y; this.spots[o + 2] = z;
      }
      // Each streak runs back from its spot along the way the air goes past.
      const p = i * 6, tail = c.lengthMeters * (0.5 + strength * 0.5);
      this.positions[p] = camera.x + x; this.positions[p + 1] = camera.y + y; this.positions[p + 2] = camera.z + z;
      this.positions[p + 3] = camera.x + x - dx * tail; this.positions[p + 4] = camera.y + y - dy * tail; this.positions[p + 5] = camera.z + z - dz * tail;
    }
    this.attribute.needsUpdate = true;
  }

  // A fresh spot for a streak, `ahead` (-1 to 1) of the camera along the travel (dx, dy, dz), somewhere in a ring round
  // that line between the clear middle and the outer radius.
  private place(i: number, ahead: number, dx: number, dy: number, dz: number): void {
    const c = this.config;
    // Two directions across the travel: crossed with straight up, or with x when the travel is near vertical.
    const helperY = Math.abs(dy) < 0.9 ? 1 : 0, helperX = 1 - helperY;
    let ax = -dz * helperY, ay = dz * helperX, az = dx * helperY - dy * helperX;
    const length = Math.hypot(ax, ay, az) || 1;
    ax /= length; ay /= length; az /= length;
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    const angle = Math.random() * Math.PI * 2;
    const r = c.clearRadiusMeters + Math.random() * (c.radiusMeters - c.clearRadiusMeters);
    const ca = Math.cos(angle) * r, sa = Math.sin(angle) * r;
    const o = i * 3;
    const forward = ahead * c.radiusMeters * (0.6 + Math.random() * 0.4);
    this.spots[o] = dx * forward + ax * ca + bx * sa;
    this.spots[o + 1] = dy * forward + ay * ca + by * sa;
    this.spots[o + 2] = dz * forward + az * ca + bz * sa;
  }
}
