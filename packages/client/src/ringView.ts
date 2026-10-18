import * as THREE from "three";
import { createRingNow, ringAt, type RingNow, type RingSchedule } from "@rustbucket/shared";

// The edge of the safe zone: a tall see-through wall. Position and size come from the schedule and the match clock,
// the same numbers the server uses for damage.
export class RingView {
  private wall: THREE.Mesh;
  private schedule: RingSchedule | null = null;
  readonly now: RingNow = createRingNow();

  // `color` is the zone magenta: the only magenta in the world, so the ring can never be mistaken for anything else.
  constructor(scene: THREE.Scene, color: string) {
    const geometry = new THREE.CylinderGeometry(1, 1, 400, 96, 1, true);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    this.wall = new THREE.Mesh(geometry, material);
    this.wall.visible = false;
    this.wall.position.y = 150;
    scene.add(this.wall);
  }

  setSchedule(schedule: RingSchedule | null): void {
    this.schedule = schedule;
    this.wall.visible = schedule !== null;
  }

  // `matchSeconds` is how far into the match we are. Returns the ring so the caller can use it too.
  update(matchSeconds: number): RingNow | null {
    if (!this.schedule) return null;
    ringAt(this.schedule, matchSeconds, this.now);
    this.wall.position.x = this.now.cx;
    this.wall.position.z = this.now.cz;
    this.wall.scale.set(this.now.radius, 1, this.now.radius);
    return this.now;
  }
}
