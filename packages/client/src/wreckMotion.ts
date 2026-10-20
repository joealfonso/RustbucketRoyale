import * as THREE from "three";

// How a knocked-out mech comes apart (deathFx.ts), as plain numbers so it can be tested without drawing anything.

// A part blown off (data/deathFx.json "pieces"): it flies tumbling, bounces a couple of times losing speed, then
// lies still and rolls onto its flattest side, so it never ends up balanced on a corner.
export interface PieceMotion {
  gravity: number; bounce: number; friction: number; spinKeep: number; maxBounces: number; settleSpeed: number; layFlatSeconds: number;
}

export interface FlyingPiece {
  x: number; y: number; z: number; // its middle, in the world
  vx: number; vy: number; vz: number;
  angle: number; spin: number; // turned about its own tumble axis: radians, and radians a second
  restAngle: number; // the angle it rolls to once down
  bounces: number;
  down: boolean; // done bouncing: it only rolls flat from here
}

export const IN_AIR = 0;
export const BOUNCED = 1;
export const LANDED = 2;

// One step. `floor` is as low as its middle may go: the ground plus how far its lowest corner hangs below its middle
// at its current angle. Returns BOUNCED or LANDED on the step it hits the ground, for a puff of dust; on LANDED the
// caller picks its restAngle.
export function stepPiece(p: FlyingPiece, dt: number, floor: number, m: PieceMotion): number {
  if (p.down) {
    const turn = m.layFlatSeconds > 0 ? (Math.PI / 2 / m.layFlatSeconds) * dt : Infinity;
    const left = p.restAngle - p.angle;
    p.angle = Math.abs(left) <= turn ? p.restAngle : p.angle + Math.sign(left) * turn;
    p.y = floor;
    return IN_AIR;
  }
  p.vy -= m.gravity * dt;
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  p.angle += p.spin * dt;
  if (p.y > floor) return IN_AIR;
  p.y = floor;
  if (p.bounces >= m.maxBounces || -p.vy < m.settleSpeed) {
    p.down = true;
    p.vx = 0; p.vy = 0; p.vz = 0; p.spin = 0;
    return LANDED;
  }
  p.bounces++;
  p.vy = -p.vy * m.bounce;
  p.vx *= m.friction; p.vz *= m.friction;
  p.spin *= m.spinKeep;
  return BOUNCED;
}

// The quarter turn either side of `angle` that leaves the piece's middle lowest: an arm lies along the ground
// rather than standing on its end.
export function flattestAngle(angle: number, heightAt: (angle: number) => number): number {
  const quarter = Math.PI / 2;
  const below = Math.floor(angle / quarter) * quarter;
  const above = below + quarter;
  return heightAt(below) <= heightAt(above) + 1e-6 ? below : above;
}

const corner = new THREE.Vector3();

// How far the lowest corner of a box (round its middle) sits below the middle once turned by `turn`: the height its
// middle rests at on flat ground.
export function restHeight(min: THREE.Vector3, max: THREE.Vector3, turn: THREE.Quaternion): number {
  let lowest = Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyQuaternion(turn);
    if (corner.y < lowest) lowest = corner.y;
  }
  return -lowest;
}

// The torso's fall (data/deathFx.json "torso"): pushed `meters` along the blow, it hops and turns over `degrees` about
// the axis across the blow with a little sway, fast at first and easing to a stop where it lies.
export interface TorsoTumble { seconds: number; meters: number; degrees: number; rollDegrees: number; hopMeters: number; hopShare: number }

export interface TumblePose {
  along: number; // metres along the blow
  tip: number; roll: number; // radians
  hop: number; // metres above resting on the ground
  fall: number; // 0 to 1: how far from the height it was knocked out at down to the ground
  done: boolean;
}

export function tumbleAt(t: number, c: TorsoTumble, out: TumblePose): TumblePose {
  const u = c.seconds > 0 ? Math.min(1, Math.max(0, t / c.seconds)) : 1;
  const left = 1 - u;
  out.along = c.meters * (1 - left * left);
  out.tip = ((c.degrees * Math.PI) / 180) * (1 - left * left * left);
  // The roll swings out and back, so the torso still comes to rest flat on its front or back, not on an edge.
  out.roll = ((c.rollDegrees * Math.PI) / 180) * Math.sin(Math.PI * u);
  out.hop = c.hopShare > 0 && u < c.hopShare ? c.hopMeters * Math.sin((Math.PI * u) / c.hopShare) : 0;
  out.fall = u * u; // falling picks up speed
  out.done = u >= 1;
  return out;
}

// A small seeded random (mulberry32) from 0 up to 1. Seeded by the mech, so a wreck that leaves view and comes back
// lies the same way.
export function seededRandom(state: { seed: number }): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
