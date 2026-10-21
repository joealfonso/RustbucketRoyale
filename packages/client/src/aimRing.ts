import type * as THREE from "three";
import type { DiveConfig } from "./dive";
import { groundRing } from "./landingMarker";

// While you drop in, a ring on the ground where your crosshair points: the spot your ball is steering for. Aim is
// looking where you want to land, so this is the crosshair for the drop (the gun crosshair is hidden then).
export class AimRing {
  readonly group: THREE.Group;

  constructor(private config: DiveConfig["aim"], color: string) {
    this.group = groundRing(color, config.opacity, 0.8);
  }

  // Each frame. `onGround` false (dropped in, or the crosshair on the sky) hides it.
  update(onGround: boolean, x: number, y: number, z: number, camera: THREE.Vector3): void {
    this.group.visible = onGround;
    if (!onGround) return;
    const c = this.config;
    const distance = Math.hypot(camera.x - x, camera.y - y, camera.z - z);
    this.group.scale.setScalar(Math.max(c.radiusMeters, distance * c.sizePerMeter));
    this.group.position.set(x, y + 0.1, z);
  }
}
