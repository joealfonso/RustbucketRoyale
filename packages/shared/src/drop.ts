import type { MechInput } from "./MechInput";
import type { MechState } from "./mechStep";
import type { MechStats } from "./stats";

// The drop-in at the start of a match (gate 16a). A mech rides above the map, then dives: look down to fall fast
// and steep, look ahead to fall slower and cover more ground; W and S lean forward or hold back, A and D slide
// sideways. Near the ground the retro-jets fire on their own and brake the fall, and a heavy landing leaves the mech
// stunned for a moment. No weapons, jets, dash or ability until it is down. The same code runs on the client and the
// server, so a dive is predicted like walking.

export const DROP_NONE = 0;
export const DROP_RIDING = 1; // aboard the Rustbucket, moving with it, until fired out of its cannon
export const DROP_DIVING = 2;
export const DROP_BURNING = 3; // retro-jets braking the last stretch
export const DROP_SHELL = 4; // just fired: a short unsteered arc in a scrap shell, then the dive

// The Rustbucket's straight line across the map (gate 16b). The cannon point flies from (x0, z0) to (x1, z1) at
// `speed`, at height `y`, starting at match-clock second `startAt` (negative: it is already flying through the
// countdown). (x1, z1) is the end of the line, where everyone still aboard is thrown out. The server picks it from the
// match seed and sends it in the room message, so the client draws the ship from the same numbers.
export interface ShipPath {
  x0: number; z0: number; x1: number; z1: number;
  y: number;
  speed: number;
  startAt: number;
}

// Where the cannon point is at a match-clock second. Past the end it keeps going, so the ship can fly away.
export function shipAt(path: ShipPath, seconds: number, out: { x: number; z: number }): void {
  const length = Math.hypot(path.x1 - path.x0, path.z1 - path.z0);
  const along = length > 0 ? (path.speed * (seconds - path.startAt)) / length : 0;
  out.x = path.x0 + (path.x1 - path.x0) * along;
  out.z = path.z0 + (path.z1 - path.z0) * along;
}

// The match-clock second the ship reaches the end of its line.
export function shipEndsAt(path: ShipPath): number {
  return path.startAt + Math.hypot(path.x1 - path.x0, path.z1 - path.z0) / Math.max(1e-6, path.speed);
}

// The velocity a mech is fired out of the cannon with, looking along `yaw` and `pitch`. The pitch is held between
// the launch pitches so a shot always goes down and forward. The ship's own speed is not added: the shot goes where
// the pilot looks, whichever way the ship is flying.
export function launchVelocity(yaw: number, pitch: number, stats: MechStats, out: { vx: number; vy: number; vz: number }): void {
  const p = Math.min(stats.launchLevelPitch * DEG, Math.max(stats.launchSteepPitch * DEG, pitch));
  const flat = Math.cos(p) * stats.launchSpeed;
  out.vx = -Math.sin(yaw) * flat;
  out.vz = -Math.cos(yaw) * flat;
  out.vy = Math.sin(p) * stats.launchSpeed;
}

// Out of the cannon: the shell flies for shellSeconds, timed by dropTime, which otherwise holds the landing stun.
export function launchDrop(s: MechState, yaw: number, pitch: number, stats: MechStats): void {
  launchVelocity(yaw, pitch, stats, s);
  s.dropPhase = DROP_SHELL;
  s.dropTime = stats.shellSeconds;
}

// Where the shell arc ends, from a launch at (x, y, z): the horizontal distance and the height lost. Exact for the
// shared step (gravity only, steps of dt), so bots and the landing marker agree with the real flight.
export function shellArc(yaw: number, pitch: number, stats: MechStats, dt: number, out: { dx: number; dz: number; drop: number; vx: number; vy: number; vz: number }): void {
  launchVelocity(yaw, pitch, stats, out);
  let x = 0, y = 0, z = 0, time = stats.shellSeconds;
  while (time >= dt * 0.5) {
    out.vy -= stats.gravity * dt;
    x += out.vx * dt; y += out.vy * dt; z += out.vz * dt;
    time -= dt;
  }
  out.dx = x; out.dz = z; out.drop = -y;
}

const DEG = Math.PI / 180;
const HOLD_BACK = 0.3; // share of the glide kept while S holds back
const SIDEWAYS = 0.6; // share of the glide A and D give sideways

export function dropping(s: MechState): boolean {
  return s.dropPhase !== DROP_NONE;
}

// Sets the mech's speed for this step of the drop and moves it from diving to braking. `groundY` is the ground under it.
export function steerDrop(s: MechState, input: MechInput, stats: MechStats, dt: number, groundY: number): void {
  if (s.dropPhase === DROP_RIDING) {
    // Space fires the pilot out. The server keeps it from happening in the countdown, as it does every jet.
    if (input.jet) launchDrop(s, input.aimYaw, input.aimPitch, stats);
    else { s.vy = 0; return; } // vx and vz are the ship's speed, set by the server when it boards
  }
  if (s.dropPhase === DROP_SHELL) {
    // No steering in the shell, only gravity, until it bursts and the dive takes over.
    s.vy -= stats.gravity * dt;
    s.dropTime -= dt;
    if (s.dropTime < dt * 0.5) { s.dropTime = 0; s.dropPhase = DROP_DIVING; }
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
