import * as THREE from "three";
import { DROP_DIVING, DROP_NONE, DROP_RIDING, createMechInput, createMechState, stepMech, type AbilityStats, type MechInput, type MechState, type MechStats, type World } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";

// Where you would come down if you held what you are holding now: a copy of your mech is stepped through the rest
// of the dive with the shared stepMech, the same rules the server runs, at a coarse step and a few times a second.
// The answer is drawn as a ring on the ground. While still riding up top it predicts the dive about to start.
export class LandingMarker {
  readonly group = new THREE.Group();
  private ghost: MechState;
  private input: MechInput = createMechInput();
  private wait = 0;
  private clock = 0;
  private found = false;
  readonly at = { x: 0, y: 0, z: 0 };

  constructor(private config: DiveConfig["marker"], color: string, stats: MechStats) {
    this.ghost = createMechState(stats, 0, 0, 0, 0);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: config.opacity, depthWrite: false, fog: false, side: THREE.DoubleSide });
    // Drawn over the ground it lies on, so a slope or a box edge never hides half of it.
    material.depthTest = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 40), material);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), material);
    for (const m of [ring, dot]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 10;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  // Each frame. `s` is your predicted mech and `input` what you are holding; hidden once you are down.
  update(s: MechState, input: MechInput, stats: MechStats, world: World, ability: AbilityStats | null, camera: THREE.Vector3, dt: number): void {
    const c = this.config;
    this.clock += dt;
    if (s.dropPhase === DROP_NONE) { this.group.visible = false; this.wait = 0; return; }
    this.wait -= dt;
    if (this.wait <= 0) {
      this.wait = c.everySeconds;
      this.found = this.predict(s, input, stats, world, ability);
    }
    this.group.visible = this.found;
    if (!this.found) return;
    // As big on screen from high up as from low down, never smaller than its real size; a slow pulse.
    const distance = Math.hypot(camera.x - this.at.x, camera.y - this.at.y, camera.z - this.at.z);
    const pulse = 1 + 0.08 * Math.sin(this.clock * c.pulsePerSecond * Math.PI * 2);
    this.group.scale.setScalar(Math.max(c.radiusMeters, distance * c.sizePerMeter) * pulse);
    this.group.position.set(this.at.x, this.at.y + 0.1, this.at.z);
  }

  // Steps the copy down to the ground. False if it never got there within maxSteps (it cannot land, or is far too high).
  private predict(s: MechState, input: MechInput, stats: MechStats, world: World, ability: AbilityStats | null): boolean {
    const g = this.ghost;
    g.x = s.x; g.y = s.y; g.z = s.z; g.vx = s.vx; g.vy = s.vy; g.vz = s.vz;
    g.bodyYaw = s.bodyYaw; g.mech = s.mech; g.grounded = false;
    g.fuelScale = s.fuelScale; g.speedScale = s.speedScale;
    g.dropTime = 0;
    g.dropPhase = s.dropPhase === DROP_RIDING ? DROP_DIVING : s.dropPhase;
    const i = this.input;
    i.aimYaw = input.aimYaw; i.aimPitch = input.aimPitch; i.moveX = input.moveX; i.moveY = input.moveY;
    for (let n = 0; n < this.config.maxSteps && g.dropPhase !== DROP_NONE; n++) stepMech(g, i, stats, this.config.stepSeconds, world, ability);
    if (g.dropPhase !== DROP_NONE) return false;
    this.at.x = g.x; this.at.y = g.y; this.at.z = g.z;
    return true;
  }
}
