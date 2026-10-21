import * as THREE from "three";
import { DROP_BALL, DROP_HANGING, DROP_NONE, createMechInput, createMechState, stepMech, type AbilityStats, type MechInput, type MechState, type MechStats, type World } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";

// A flat ring with a dot in the middle, lying on the ground and drawn over it, so a slope or a box edge never hides
// half of it. Unit size: scale it to the radius wanted. Shared by the landing marker and the aim ring.
export function groundRing(color: string, opacity: number, inner: number): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, side: THREE.DoubleSide });
  material.depthTest = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(inner, 1, 40), material);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), material);
  for (const m of [ring, dot]) {
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 10;
    group.add(m);
  }
  group.visible = false;
  return group;
}

// Where your ball will really come down if you keep aiming where you aim now: a copy of your mech is stepped
// through the rest of the drop with the shared stepMech, the same rules the server runs, at a coarse step and a few
// times a second. The ball's steering is limited, so this can sit short of the aim ring; the gap is how far out of
// reach that spot is. Hanging in the countdown, it predicts the fall as if it started now.
export class LandingMarker {
  readonly group: THREE.Group;
  private ghost: MechState;
  private input: MechInput = createMechInput();
  private wait = 0;
  private clock = 0;
  private found = false;
  readonly at = { x: 0, y: 0, z: 0 };

  constructor(private config: DiveConfig["marker"], color: string, stats: MechStats) {
    this.ghost = createMechState(stats, 0, 0, 0, 0);
    this.group = groundRing(color, config.opacity, 0.78);
  }

  // Each frame. `s` is your predicted mech and `input` what you are sending; hidden once you are down.
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
    g.dropTime = s.dropTime;
    g.dropPhase = s.dropPhase === DROP_HANGING ? DROP_BALL : s.dropPhase;
    const i = this.input;
    i.aimYaw = input.aimYaw; i.aimPitch = input.aimPitch;
    i.targetX = input.targetX; i.targetY = input.targetY; i.targetZ = input.targetZ;
    for (let n = 0; n < this.config.maxSteps && g.dropPhase !== DROP_NONE; n++) stepMech(g, i, stats, this.config.stepSeconds, world, ability);
    if (g.dropPhase !== DROP_NONE) return false;
    this.at.x = g.x; this.at.y = g.y; this.at.z = g.z;
    return true;
  }
}
