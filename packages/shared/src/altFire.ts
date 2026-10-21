import type { MechInput } from "./MechInput";
import type { WeaponStats } from "./stats";
import type { FireGate } from "./weapon";

// Both triggers of the gun in hand (gate 18a). The client's own firing and the server's check run this same step on
// the shooter's step clock, so they agree on every shot, every bit of heat and every charge.
export const FIRE_NONE = 0;
export const FIRE_PRIMARY = 1;
export const FIRE_SECONDARY = 2;

export interface AltFireState {
  heat: number; // 0 to 1, windup guns only
  overheat: number; // seconds of lockout left after reaching full heat
  windup: number; // 0 to 1, how far the spin up has got
  charge: number; // seconds the charge has been held
  weaponId: string; // the gun these belong to: changing gun drops the spin and the charge
  held: boolean; // right-click was down last step, so a detonate goes off on the press only. Not sent: both sides see the same inputs
}

export function createAltFireState(): AltFireState {
  return { heat: 0, overheat: 0, windup: 0, charge: 0, weaponId: "", held: false };
}

// What fired this step. `weapon` is a scratch copy of the gun with the secondary's numbers laid over it (damage
// already scaled by `share`), ready to hand to computeShot and to the hit code.
export interface AltShot {
  mode: number; // FIRE_NONE, FIRE_PRIMARY or FIRE_SECONDARY
  share: number; // share of full damage: 1 for a primary shot, a slug or a full charge
  pierce: number; // extra mechs the shot passes through
  pinSeconds: number; // 0 for no pin
  pinSpeedShare: number;
  detonate: boolean; // a rivet gun's right-click press: pop your stuck rivets. No shot (pellets 0)
  reel: boolean; // a harpoon fired with right-click: it pulls the shooter to where it lands
  weapon: WeaponStats;
}

export function createAltShot(): AltShot {
  return {
    mode: FIRE_NONE, share: 1, pierce: 0, pinSeconds: 0, pinSpeedShare: 1, detonate: false, reel: false,
    weapon: {
      id: "", name: "", color: "", pellets: 1, shotsPerSecond: 1, projectileSpeed: 0, projectileLifetime: 0, spreadDegrees: 0,
      maxAimDistance: 0, shakeForce: 0, damage: 0, projectile: { kind: "hitscan" }, secondary: { kind: "slug", shotsPerSecond: 1, damage: 0, spreadDegrees: 0, maxAimDistance: 0, shakeForce: 0 },
    },
  };
}

// How far the gun is wound up, 0 to 1, for drawing and hearing it on other mechs: the spin of a windup gun, the charge
// of a charge gun, 0 for any other.
export function altSpin(state: AltFireState, weapon: WeaponStats): number {
  if (state.weaponId !== weapon.id) return 0;
  return weapon.secondary.kind === "windup" ? state.windup : chargeShare(state, weapon);
}

// How full the charge is, 0 to 1, for the HUD.
export function chargeShare(state: AltFireState, weapon: WeaponStats): number {
  return weapon.secondary.kind === "charge" ? Math.min(1, state.charge / weapon.secondary.chargeSeconds) : 0;
}

function shoot(out: AltShot, weapon: WeaponStats, mode: number): true {
  out.mode = mode;
  out.share = 1; out.pierce = 0; out.pinSeconds = 0; out.pinSpeedShare = 1; out.detonate = false; out.reel = false;
  Object.assign(out.weapon, weapon);
  return true;
}

// One step of both triggers. Returns true when a shot fires, with `out` saying which and how.
// Right-click wins over left-click while held. `rateScale` is the fire rate upgrade.
export function stepAltFire(state: AltFireState, gate: FireGate, input: MechInput, weapon: WeaponStats, time: number, dt: number, rateScale: number, out: AltShot): boolean {
  out.mode = FIRE_NONE;
  const pressed = input.altFire && !state.held;
  state.held = input.altFire;
  if (state.weaponId !== weapon.id) { state.weaponId = weapon.id; state.windup = 0; state.charge = 0; }
  // A vent runs out whatever is in hand, and clears the heat when it ends. The same half-step end as the ram: the
  // time crosses the wire as a float32.
  if (state.overheat > 0) {
    state.overheat = state.overheat - dt < dt * 0.5 ? 0 : state.overheat - dt;
    if (state.overheat === 0) state.heat = 0;
  }
  const sec = weapon.secondary;
  const primaryRate = weapon.shotsPerSecond * rateScale;

  if (sec.kind === "windup") {
    if (state.overheat > 0) {
      state.windup = Math.max(0, state.windup - dt / sec.windupSeconds);
      return false;
    }
    if (input.altFire) {
      state.windup = Math.min(1, state.windup + dt / sec.windupSeconds);
      if (!gate.tryFire(time, primaryRate * (1 + (sec.maxRateMultiplier - 1) * state.windup))) return false;
      shoot(out, weapon, FIRE_SECONDARY);
      out.weapon.spreadDegrees = sec.spreadDegrees;
      state.heat = Math.min(1, state.heat + sec.heatPerShot);
      if (state.heat >= 1) { state.overheat = sec.overheatSeconds; state.windup = 0; }
      return true;
    }
    state.windup = Math.max(0, state.windup - dt / sec.windupSeconds);
    state.heat = Math.max(0, state.heat - sec.coolPerSecond * dt);
  } else if (sec.kind === "slug") {
    if (input.altFire) {
      if (!gate.tryFire(time, sec.shotsPerSecond * rateScale)) return false;
      shoot(out, weapon, FIRE_SECONDARY);
      const w = out.weapon;
      w.pellets = 1; w.damage = sec.damage; w.spreadDegrees = sec.spreadDegrees; w.maxAimDistance = sec.maxAimDistance; w.shakeForce = sec.shakeForce;
      return true;
    }
  } else if (sec.kind === "detonate") {
    if (pressed) {
      shoot(out, weapon, FIRE_SECONDARY);
      out.detonate = true;
      out.weapon.pellets = 0;
      return true;
    }
    if (input.altFire) return false; // still held: right-click wins over left
  } else if (sec.kind === "reel") {
    if (input.altFire) {
      // The same gate as the left button, so a reel and a harpoon never go one straight after the other.
      if (!gate.tryFire(time, sec.shotsPerSecond * rateScale)) return false;
      shoot(out, weapon, FIRE_SECONDARY);
      out.reel = true;
      out.weapon.pellets = 1; out.weapon.spreadDegrees = 0;
      return true;
    }
  } else {
    if (input.altFire) {
      // The charge only builds once the last shot has cycled, so a release always fires.
      if (gate.ready(time)) state.charge = Math.min(sec.chargeSeconds, state.charge + dt);
      return false;
    }
    if (state.charge > 0) {
      const held = state.charge;
      state.charge = 0;
      if (!gate.tryFire(time, primaryRate)) return false;
      shoot(out, weapon, FIRE_SECONDARY);
      // Full within half a step, for the same float32 reason as the vent.
      const full = held >= sec.chargeSeconds - dt * 0.5;
      out.share = full ? 1 : sec.minDamageShare + (1 - sec.minDamageShare) * (held / sec.chargeSeconds);
      out.weapon.damage = weapon.damage * out.share;
      out.weapon.pellets = 1;
      out.weapon.shakeForce = sec.shakeForce * out.share;
      if (full) { out.pierce = sec.pierceMechs; out.pinSeconds = sec.pinSeconds; out.pinSpeedShare = sec.pinSpeedShare; }
      return true;
    }
  }
  if (input.fire && gate.tryFire(time, primaryRate)) return shoot(out, weapon, FIRE_PRIMARY);
  return false;
}
