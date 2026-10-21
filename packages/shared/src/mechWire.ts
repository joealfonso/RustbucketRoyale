import type { AltFireState } from "./altFire";
import type { MechState } from "./mechStep";
import type { SelfState } from "./protocol";

// `alt` is the player's secondary fire, left out (all 0) for callers without one.
export function writeSelf(s: MechState, alt?: AltFireState): SelfState {
  return {
    x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz, vy: s.vy, bodyYaw: s.bodyYaw,
    grounded: s.grounded, running: s.running, jetting: s.jetting, crawling: s.crawling,
    dashTime: s.dashTime, dashCooldown: s.dashCooldown, dashX: s.dashX, dashZ: s.dashZ,
    abilityTime: s.abilityTime, abilityCooldown: s.abilityCooldown, abilityX: s.abilityX, abilityZ: s.abilityZ,
    fuel: s.fuel.value, fuelLocked: s.fuel.locked, fuelTimer: s.fuel.regenTimer,
    stamina: s.stamina.value, staminaLocked: s.stamina.locked, staminaTimer: s.stamina.regenTimer,
    fuelScale: s.fuelScale, speedScale: s.speedScale, dropPhase: s.dropPhase, dropTime: s.dropTime, mech: s.mech,
    heat: alt?.heat ?? 0, overheat: alt?.overheat ?? 0, windup: alt?.windup ?? 0, charge: alt?.charge ?? 0,
    pinTime: s.pinTime, pinSpeed: s.pinSpeed,
  };
}

export function readSelf(s: MechState, from: SelfState): void {
  s.x = from.x; s.y = from.y; s.z = from.z;
  s.vx = from.vx; s.vz = from.vz; s.vy = from.vy;
  s.bodyYaw = from.bodyYaw;
  s.grounded = from.grounded; s.running = from.running; s.jetting = from.jetting; s.crawling = from.crawling;
  s.dashTime = from.dashTime; s.dashCooldown = from.dashCooldown; s.dashX = from.dashX; s.dashZ = from.dashZ;
  s.abilityTime = from.abilityTime; s.abilityCooldown = from.abilityCooldown; s.abilityX = from.abilityX; s.abilityZ = from.abilityZ;
  s.fuel.value = from.fuel; s.fuel.locked = from.fuelLocked; s.fuel.regenTimer = from.fuelTimer;
  s.fuelScale = from.fuelScale;
  s.speedScale = from.speedScale;
  s.dropPhase = from.dropPhase; s.dropTime = from.dropTime;
  s.pinTime = from.pinTime; s.pinSpeed = from.pinSpeed;
  s.mech = from.mech;
  s.stamina.value = from.stamina; s.stamina.locked = from.staminaLocked; s.stamina.regenTimer = from.staminaTimer;
}

// Your secondary fire as the server has it, for the HUD and for firing on from the same heat and charge.
export function readAltFire(alt: AltFireState, from: SelfState): void {
  alt.heat = from.heat; alt.overheat = from.overheat; alt.windup = from.windup; alt.charge = from.charge;
}
