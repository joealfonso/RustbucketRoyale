import {
  NOISE_KINDS, createMechInput, createMechState, raycastMech, stepMech,
  type DecoyStats, type MechInput, type MechState, type MechStats, type World, type ZoneHit, type ZoneSet,
} from "@rustbucket/shared";

const DEG = Math.PI / 180;
const FALLEN_HEIGHT = -50; // the same fall the room knocks a mech out at

// One of an Arbiter's Decoy Drones: a mech with nobody driving it, that runs straight ahead until it is shot, caught
// in a blast or runs out of time. It moves with the real mech step, so walls stop it like they stop anyone.
export interface Decoy {
  id: number; // from the room's player ids, so it never clashes with a mech
  ownerId: number;
  stats: DecoyStats; // the live ability numbers, so tuning reaches decoys already out
  state: MechState;
  input: MechInput; // always run forward; only the aim turns, when it turns off a wall
  secondsLeft: number;
  blockedSeconds: number;
  quietUntil: Int32Array; // per noise kind, like a player's, so its footsteps pulse like a running mech's
}

// Sends out an Arbiter's decoys from where it stands, fanned evenly across the spread either side of the way it
// aimed (one decoy goes straight ahead). Each starts with the Arbiter's own speed, so it peels off it smoothly
// instead of starting from a standstill, which would give it away.
export function spawnDecoys(owner: MechState, ownerId: number, stats: MechStats, decoy: DecoyStats, nextId: () => number): Decoy[] {
  const baseYaw = Math.atan2(-owner.abilityX, -owner.abilityZ);
  const out: Decoy[] = [];
  for (let i = 0; i < decoy.count; i++) {
    const offset = decoy.count === 1 ? 0 : (-1 + (2 * i) / (decoy.count - 1)) * decoy.spreadDegrees * DEG;
    const state = createMechState(stats, owner.x, owner.y, owner.z, owner.bodyYaw, owner.mech);
    state.vx = owner.vx; state.vy = owner.vy; state.vz = owner.vz; state.grounded = owner.grounded;
    const input = { ...createMechInput(), moveY: 1, run: true, aimYaw: baseYaw + offset };
    out.push({ id: nextId(), ownerId, stats: decoy, state, input, secondsLeft: decoy.lifeSeconds, blockedSeconds: 0, quietUntil: new Int32Array(NOISE_KINDS.length) });
  }
  return out;
}

// One step. Returns false once the decoy is done: out of time or off the map. `awayX, awayZ` is where its owner
// is, so a decoy that runs into a wall turns the way that takes it further from the Arbiter, not back to it.
export function stepDecoy(d: Decoy, stats: MechStats, world: World, dt: number, awayX: number, awayZ: number): boolean {
  d.secondsLeft -= dt;
  if (d.secondsLeft <= 0) return false;
  const s = d.state;
  const x = s.x, z = s.z;
  stepMech(s, d.input, stats, dt, world, null);
  if (s.y < FALLEN_HEIGHT) return false;

  d.blockedSeconds = Math.hypot(s.x - x, s.z - z) < d.stats.stuckSpeed * dt ? d.blockedSeconds + dt : 0;
  if (d.blockedSeconds >= d.stats.stuckSeconds) {
    d.blockedSeconds = 0;
    // Left or right a quarter turn, whichever points more away from the owner.
    const yaw = d.input.aimYaw;
    const leftX = -Math.sin(yaw + Math.PI / 2), leftZ = -Math.cos(yaw + Math.PI / 2);
    const left = leftX * (s.x - awayX) + leftZ * (s.z - awayZ) >= 0;
    d.input.aimYaw = yaw + (left ? Math.PI / 2 : -Math.PI / 2);
  }
  return true;
}

// The nearest decoy along a shot within `reach`, or null. Its distance is left in `hit`. Checked where decoys are
// now: they run straight, so there is little to gain from rewinding them for the shooter's lag. The shooter's own
// decoys are skipped: they start inside the Arbiter, and its first shots after dropping them would burst them.
export function decoyAlong(
  decoys: readonly Decoy[], shooterId: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number,
  zonesFor: (mech: number) => ZoneSet, hit: ZoneHit,
): Decoy | null {
  let best: Decoy | null = null;
  let bestDistance = reach;
  for (const d of decoys) {
    if (d.ownerId === shooterId) continue;
    const s = d.state;
    if (!raycastMech(ox, oy, oz, dx, dy, dz, bestDistance, s.x, s.y, s.z, s.bodyYaw, zonesFor(s.mech), hit)) continue;
    best = d;
    bestDistance = hit.distance;
  }
  hit.distance = bestDistance;
  return best;
}
