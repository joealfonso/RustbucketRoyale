import type { MechInput } from "./MechInput";
import type { MechState } from "./mechStep";
import type { MechStats } from "./stats";

// The drop-in at the start of a match (gate 16a). A mech rides above the map, then dives: look down to fall fast
// and steep, look ahead to fall slower and cover more ground; W and S lean forward or hold back, A and D slide
// sideways. Near the ground the retro-jets fire on their own and brake the fall, and a heavy landing leaves the mech
// stunned for a moment. No weapons, jets, dash or ability until it is down. The same code runs on the client and the
// server, so a dive is predicted like walking.

export const DROP_NONE = 0;
export const DROP_RIDING = 1; // held up top until launched (the server moves it there)
export const DROP_DIVING = 2;
export const DROP_BURNING = 3; // retro-jets braking the last stretch

const DEG = Math.PI / 180;
const HOLD_BACK = 0.3; // share of the glide kept while S holds back
const SIDEWAYS = 0.6; // share of the glide A and D give sideways

export function dropping(s: MechState): boolean {
  return s.dropPhase !== DROP_NONE;
}

// Sets the mech's speed for this step of the drop and moves it from diving to braking. `groundY` is the ground under it.
export function steerDrop(s: MechState, input: MechInput, stats: MechStats, dt: number, groundY: number): void {
  if (s.dropPhase === DROP_RIDING) {
    s.vx = 0; s.vy = 0; s.vz = 0;
    return;
  }
  if (s.dropPhase === DROP_DIVING && s.y - groundY <= stats.burnMeters) s.dropPhase = DROP_BURNING;
  const burning = s.dropPhase === DROP_BURNING;

  // How steep the dive is, from the pitch: 0 at the level pitch or above, 1 at the steep pitch or below.
  const span = stats.diveLevelPitch - stats.diveSteepPitch;
  const steep = Math.min(1, Math.max(0, (stats.diveLevelPitch - input.aimPitch / DEG) / span));
  const glide = burning ? stats.burnGlide : stats.diveLevelGlide + (stats.diveSteepGlide - stats.diveLevelGlide) * steep;

  const yaw = input.aimYaw;
  const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  const ahead = input.moveY < 0 ? HOLD_BACK : 1;
  let wishX = forwardX * ahead + rightX * input.moveX * SIDEWAYS;
  let wishZ = forwardZ * ahead + rightZ * input.moveX * SIDEWAYS;
  const length = Math.hypot(wishX, wishZ);
  if (length > 1) { wishX /= length; wishZ /= length; }
  approach2(s, wishX * glide, wishZ * glide, stats.diveAcceleration * dt);

  if (burning) {
    // Braking: the fall slows to the landing speed and no slower, so it never hangs in the air.
    s.vy = Math.min(-stats.landingFall, s.vy + stats.burnDeceleration * dt);
  } else {
    const fall = stats.diveLevelFall + (stats.diveSteepFall - stats.diveLevelFall) * steep;
    s.vy = approach(s.vy, -fall, stats.diveAcceleration * dt);
  }
}

// Down: the drop is over and the mech is stunned for a moment by the impact.
export function landDrop(s: MechState, stats: MechStats): void {
  s.dropPhase = DROP_NONE;
  s.dropTime = stats.landingStunSeconds;
  s.vx = 0; s.vz = 0;
}

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

function approach2(s: MechState, tx: number, tz: number, step: number): void {
  const dx = tx - s.vx, dz = tz - s.vz;
  const d = Math.hypot(dx, dz);
  if (d <= step) { s.vx = tx; s.vz = tz; return; }
  s.vx += (dx / d) * step;
  s.vz += (dz / d) * step;
}
