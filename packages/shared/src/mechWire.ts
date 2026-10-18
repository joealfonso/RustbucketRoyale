import type { MechState } from "./mechStep";
import type { SelfState } from "./protocol";

export function writeSelf(s: MechState): SelfState {
  return {
    x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz, vy: s.vy, bodyYaw: s.bodyYaw,
    grounded: s.grounded, running: s.running, jetting: s.jetting, crawling: s.crawling,
    dashTime: s.dashTime, dashCooldown: s.dashCooldown, dashX: s.dashX, dashZ: s.dashZ,
    fuel: s.fuel.value, fuelLocked: s.fuel.locked, fuelTimer: s.fuel.regenTimer,
    stamina: s.stamina.value, staminaLocked: s.stamina.locked, staminaTimer: s.stamina.regenTimer,
    fuelScale: s.fuelScale,
  };
}

export function readSelf(s: MechState, from: SelfState): void {
  s.x = from.x; s.y = from.y; s.z = from.z;
  s.vx = from.vx; s.vz = from.vz; s.vy = from.vy;
  s.bodyYaw = from.bodyYaw;
  s.grounded = from.grounded; s.running = from.running; s.jetting = from.jetting; s.crawling = from.crawling;
  s.dashTime = from.dashTime; s.dashCooldown = from.dashCooldown; s.dashX = from.dashX; s.dashZ = from.dashZ;
  s.fuel.value = from.fuel; s.fuel.locked = from.fuelLocked; s.fuel.regenTimer = from.fuelTimer;
  s.fuelScale = from.fuelScale;
  s.stamina.value = from.stamina; s.stamina.locked = from.staminaLocked; s.stamina.regenTimer = from.staminaTimer;
}
