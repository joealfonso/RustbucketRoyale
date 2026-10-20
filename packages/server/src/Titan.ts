import {
  STEP, aimCar, createGrenade, createRingNow, raycastMech, ringAt, stepGrenade,
  type BotPathStats, type GrenadeState, type NavGrid, type NoiseKind, type RingNow, type RingSchedule, type ServerMessage, type TitanAction, type TitanConfig, type TitanState, type World, type ZoneHit, type ZoneSet,
} from "@rustbucket/shared";
import { CAUSE_TITAN_CAR, CAUSE_TITAN_STOMP } from "./knockout";
import type { Pathfinder } from "./Pathfinder";
import type { Player } from "./Player";
import { openGround } from "./supplyDrops";

const DEG = Math.PI / 180;
const PLACE_TRIES = 200;
const NEAR_GOAL = 6; // metres: close enough to where it is walking to stop
const CAR_LIFT = 0.1; // a car aims this far above the ground under its target, so it is not in the ground on landing

// Stands for the Titan wherever an id is needed: bot targets, hit messages (targetId 0) and the snapshot interest list.
// Player and decoy ids start at 1, so it is never anyone's.
export const TITAN_ID = 0;

// What the Titan does to the room, which the room carries out with its own rules (damage, knockouts, props, loot).
export interface TitanHost {
  mechs(): Iterable<Player>;
  hurt(target: Player, zoneDamage: readonly number[], cause: number): void;
  smashProps(x: number, y: number, z: number, radius: number, height: number): void;
  blast(x: number, y: number, z: number, damage: number, radius: number, cause: number): void;
  spill(x: number, y: number, z: number, contents: readonly string[], spillMeters: number): void;
  sendNear(x: number, z: number, message: ServerMessage): void;
  sendNearEither(x1: number, z1: number, x2: number, z2: number, message: ServerMessage): void;
  tellEveryone(message: ServerMessage): void;
  noise(kind: NoiseKind, x: number, z: number): void;
}

// The Junk Titan: a slow giant that walks to the nearest mech, stomps whoever is at its feet, throws cars at whoever is
// further off, and goes for whoever hurt it last, which is what makes luring it into someone else work. With nobody
// near it heads for the middle of the ring and waits there. It never leaves the ring on purpose. It walks straight
// through props, smashing them. When it falls it spills a pile of loot. Every number is in data/titan.json, read live.
export class Titan {
  x: number;
  y: number;
  z: number;
  yaw = 0;
  hp: number;
  action: TitanAction = "roar"; // it wakes up roaring
  actionSeconds = 0;
  private struck = false; // the current stomp or throw has happened
  private stompReady = 0; // seconds until each move can be used again
  private throwReady = 0;
  private roarReady = 0;
  private targetId = -1; // who it went for last tick, -1 for nobody
  private grudgeId = -1; // who hurt it last
  private grudgeFor = 0;
  private aimX = 0; private aimY = 0; private aimZ = 0; // where the car being thrown will land
  private cars: GrenadeState[] = [];
  private fallen = false; // the body has hit the ground after the fall
  private noiseIn = 0;
  private path: number[] = [];
  private pathIndex = 0;
  private pathGoalX = 0;
  private pathGoalZ = 0;
  private replanIn = 0;
  private pathWhole = false;
  private wayX = 0; // the spot it heads for this tick, from nextWaypoint
  private wayZ = 0;

  constructor(
    private config: TitanConfig,
    private world: World,
    private finder: Pathfinder,
    private pathStats: BotPathStats, // the bots' route rules, which suit it too
    private meters: number,
    private host: TitanHost,
    private hitBoxes: Pick<ZoneSet, "boxes" | "boxZone">, // titanHitBoxes: measured from its model when there is one
    x: number, z: number,
  ) {
    this.x = x;
    this.z = z;
    this.y = this.groundAt(x, z);
    this.hp = config.hp;
    this.roarReady = config.roar.cooldownSeconds;
  }

  get alive(): boolean {
    return this.action !== "down";
  }

  state(out: TitanState): TitanState {
    out.x = this.x; out.y = this.y; out.z = this.z; out.yaw = this.yaw;
    out.hp = Math.max(0, Math.min(1, this.hp / this.config.hp));
    out.action = this.action;
    out.actionSeconds = this.actionSeconds;
    return out;
  }

  // One tick. `ring` is the live circle, or null outside a match.
  step(dt: number, ring: RingNow | null): void {
    this.flyCars(dt);
    this.actionSeconds += dt;
    if (!this.alive) {
      if (!this.fallen && this.actionSeconds >= this.config.fall.seconds) this.land();
      return;
    }
    this.stompReady -= dt; this.throwReady -= dt; this.roarReady -= dt;
    this.grudgeFor -= dt; this.noiseIn -= dt; this.replanIn -= dt;

    const c = this.config;
    const target = this.pickTarget(ring);
    if (this.action === "stomp") {
      if (!this.struck && this.actionSeconds >= c.stomp.windupSeconds) { this.struck = true; this.stomp(); }
      if (this.actionSeconds >= c.stomp.windupSeconds + c.stomp.recoverSeconds) this.begin("walk");
    } else if (this.action === "throw") {
      // It keeps its eye on the target while it winds up, so the car goes where the target is at the release.
      if (!this.struck && target) { this.aimX = target.state.x; this.aimY = target.state.y; this.aimZ = target.state.z; }
      if (!this.struck) this.turnToward(this.aimX, this.aimZ, dt);
      if (!this.struck && this.actionSeconds >= c.throw.windupSeconds) { this.struck = true; this.release(); }
      if (this.actionSeconds >= c.throw.windupSeconds + c.throw.recoverSeconds) this.begin("walk");
    } else if (this.action === "roar") {
      if (target) this.turnToward(target.state.x, target.state.z, dt);
      if (this.actionSeconds >= c.roar.seconds) this.begin("walk");
    } else {
      this.decide(target, ring, dt);
    }
    this.targetId = target?.id ?? -1;
    this.pushMechsOut();
  }

  // Walking: roar at someone new, stomp whoever is at its feet, throw at whoever is in range, or keep walking.
  private decide(target: Player | null, ring: RingNow | null, dt: number): void {
    const c = this.config;
    if (target && this.targetId === -1 && this.roarReady <= 0) {
      this.begin("roar");
      this.roarReady = c.roar.cooldownSeconds;
      this.host.noise("explosion", this.x, this.z);
      return;
    }
    if (this.stompReady <= 0 && this.mechAtFeet()) {
      this.begin("stomp");
      this.stompReady = c.stomp.windupSeconds + c.stomp.recoverSeconds + c.stomp.cooldownSeconds;
      return;
    }
    if (target && this.throwReady <= 0) {
      const distance = Math.hypot(target.state.x - this.x, target.state.z - this.z);
      if (distance >= c.throw.minRange && distance <= c.throw.range) {
        this.begin("throw");
        this.throwReady = c.throw.windupSeconds + c.throw.recoverSeconds + c.throw.cooldownSeconds;
        this.aimX = target.state.x; this.aimY = target.state.y; this.aimZ = target.state.z;
        return;
      }
    }
    let goalX = this.x, goalZ = this.z;
    if (target) { goalX = target.state.x; goalZ = target.state.z; }
    else if (ring) { goalX = ring.cx; goalZ = ring.cz; }
    // Never out of the ring: a goal past its margin is pulled back in, onto the line to the middle.
    if (ring) {
      const limit = Math.max(0, ring.radius - c.ringMargin);
      const fromCentre = Math.hypot(goalX - ring.cx, goalZ - ring.cz);
      if (fromCentre > limit) {
        goalX = ring.cx + ((goalX - ring.cx) / fromCentre) * limit;
        goalZ = ring.cz + ((goalZ - ring.cz) / fromCentre) * limit;
      }
    }
    this.walkTo(goalX, goalZ, target ? c.stomp.triggerRadius * 0.5 : NEAR_GOAL, dt);
  }

  private begin(action: TitanAction): void {
    this.action = action;
    this.actionSeconds = 0;
    this.struck = false;
  }

  // The mech it goes for: whoever hurt it last, while the grudge lasts and they are in reach, or else the nearest
  // within its aggro range. Only mechs inside the ring count, so nothing leads it out.
  private pickTarget(ring: RingNow | null): Player | null {
    const c = this.config;
    let best: Player | null = null;
    let bestDistance = c.aggroRange;
    for (const m of this.host.mechs()) {
      if (!m.participant || m.dead) continue;
      const s = m.state;
      if (ring && Math.hypot(s.x - ring.cx, s.z - ring.cz) > ring.radius) continue;
      const distance = Math.hypot(s.x - this.x, s.z - this.z);
      if (m.id === this.grudgeId && this.grudgeFor > 0 && distance <= c.grudgeRange) return m;
      if (distance < bestDistance) { best = m; bestDistance = distance; }
    }
    return best;
  }

  private mechAtFeet(): boolean {
    const { triggerRadius, reachHeight } = this.config.stomp;
    for (const m of this.host.mechs()) {
      if (!m.participant || m.dead || m.state.y - this.y > reachHeight) continue;
      if (Math.hypot(m.state.x - this.x, m.state.z - this.z) <= triggerRadius) return true;
    }
    return false;
  }

  // Turns on the spot, slowly, and only steps forward once it roughly faces the way it is going: a giant, not a mech.
  // Routes come from the bots' pathfinder, so it goes round buildings; props in its way are simply smashed.
  private walkTo(goalX: number, goalZ: number, stopWithin: number, dt: number): void {
    const c = this.config;
    if (Math.hypot(goalX - this.x, goalZ - this.z) <= stopWithin) return;
    this.nextWaypoint(goalX, goalZ);
    const facing = this.turnToward(this.wayX, this.wayZ, dt);
    if (facing > c.walkingAngleDegrees * DEG) return;
    const half = this.meters / 2 - c.radius;
    const nx = Math.max(-half, Math.min(half, this.x - Math.sin(this.yaw) * c.walkSpeed * dt));
    const nz = Math.max(-half, Math.min(half, this.z - Math.cos(this.yaw) * c.walkSpeed * dt));
    const terrain = this.world.terrain;
    if (terrain && !terrain.mayMove(this.x, this.z, nx, nz)) { this.replanIn = 0; return; }
    this.x = nx;
    this.z = nz;
    this.y = this.groundAt(nx, nz);
    this.host.smashProps(this.x, this.y, this.z, c.radius, c.height);
    if (this.noiseIn <= 0) {
      this.noiseIn = c.walkNoiseSeconds;
      this.host.noise("smash", this.x, this.z);
    }
  }

  // The spot to head for now on the way to the goal, into wayX and wayZ: the next point of a route for far goals, the
  // goal itself near. Routes are planned within the room's per-tick search allowance, like a bot's.
  private nextWaypoint(goalX: number, goalZ: number): void {
    const p = this.pathStats;
    this.wayX = goalX; this.wayZ = goalZ;
    if (Math.hypot(goalX - this.x, goalZ - this.z) < p.minPathDistance) { this.path.length = 0; return; }
    const moved = Math.hypot(goalX - this.pathGoalX, goalZ - this.pathGoalZ) > p.goalMoveReplan;
    if ((this.path.length === 0 || this.replanIn <= 0 || moved) && this.finder.canSearch()) {
      this.replanIn = p.replanSeconds;
      this.pathGoalX = goalX; this.pathGoalZ = goalZ;
      this.pathIndex = 0;
      if (!this.finder.findPath(this.x, this.z, goalX, goalZ, this.path)) this.path.length = 0;
      this.pathWhole = this.path.length > 0 && this.finder.reachedGoal;
    }
    const last = this.pathWhole ? this.path.length - 2 : this.path.length;
    while (this.pathIndex * 2 < last && Math.hypot(this.path[this.pathIndex * 2]! - this.x, this.path[this.pathIndex * 2 + 1]! - this.z) < p.waypointReach) this.pathIndex++;
    if (this.pathIndex * 2 < this.path.length) { this.wayX = this.path[this.pathIndex * 2]!; this.wayZ = this.path[this.pathIndex * 2 + 1]!; }
  }

  // Swings its facing towards a spot at its turn speed. Returns how far off it still is, in radians.
  private turnToward(x: number, z: number, dt: number): number {
    const want = Math.atan2(-(x - this.x), -(z - this.z));
    const diff = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
    const most = this.config.turnDegreesPerSecond * DEG * dt;
    this.yaw += Math.max(-most, Math.min(most, diff));
    return Math.abs(diff) - Math.min(most, Math.abs(diff));
  }

  // The foot comes down: everyone near it on the ground is hurt and thrown outwards, and every prop round it breaks
  // (so crates burst and barrels go off all round it). A mech jetting high enough over it is missed.
  private stomp(): void {
    const s = this.config.stomp;
    this.host.sendNear(this.x, this.z, { t: "titan", event: "stomp", x: this.x, y: this.y, z: this.z, radius: s.radius });
    this.host.noise("explosion", this.x, this.z);
    for (const m of this.host.mechs()) {
      if (!m.participant || m.dead) continue;
      const t = m.state;
      const dx = t.x - this.x, dz = t.z - this.z;
      const distance = Math.hypot(dx, dz);
      if (distance > s.radius || t.y - this.y > s.reachHeight) continue;
      const nx = distance > 1e-3 ? dx / distance : -Math.sin(this.yaw), nz = distance > 1e-3 ? dz / distance : -Math.cos(this.yaw);
      // Topped up to the shove rather than added, as a ram does, so a mech already flying away is not sent twice as far.
      const along = t.vx * nx + t.vz * nz;
      if (along < s.knockback) { t.vx += nx * (s.knockback - along); t.vz += nz * (s.knockback - along); }
      t.vy = Math.max(t.vy, s.pop);
      this.host.hurt(m, s.zoneDamage, CAUSE_TITAN_STOMP);
    }
    this.host.smashProps(this.x, this.y, this.z, s.radius, s.propHeight);
  }

  // The car leaves its hand on a lob that lands on the aim point after flightSeconds, flown by the shared grenade step
  // so every client that is told the throw flies it the same way.
  private release(): void {
    const t = this.config.throw;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const car = createGrenade();
    aimCar(this.x + fx * t.handForward, this.y + t.handHeight, this.z + fz * t.handForward, this.aimX, this.aimY + this.config.car.radius + CAR_LIFT, this.aimZ, t.flightSeconds, this.config.car, STEP, car);
    this.cars.push(car);
    this.host.sendNearEither(this.x, this.z, this.aimX, this.aimZ, { t: "titan", event: "throw", x: car.x, y: car.y, z: car.z, vx: car.vx, vy: car.vy, vz: car.vz });
    this.host.noise("smash", this.x, this.z);
  }

  private flyCars(dt: number): void {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i]!;
      if (!stepGrenade(car, this.config.car, dt, this.world)) continue;
      this.cars.splice(i, 1);
      const t = this.config.throw;
      this.host.sendNear(car.x, car.z, { t: "titan", event: "land", x: car.x, y: car.y, z: car.z });
      this.host.blast(car.x, car.y, car.z, t.damage, t.blastRadius, CAUSE_TITAN_CAR);
    }
  }

  // Mechs cannot stand inside it: anyone in its circle is shoved out. Only the server knows the Titan's body, so a
  // client walking into it is corrected by the next snapshot.
  private pushMechsOut(): void {
    const { radius, height, pushSpeed } = this.config;
    for (const m of this.host.mechs()) {
      if (!m.participant || m.dead) continue;
      const t = m.state;
      if (t.y > this.y + height) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= radius) continue;
      const nx = distance > 1e-3 ? dx / distance : -Math.sin(this.yaw), nz = distance > 1e-3 ? dz / distance : -Math.cos(this.yaw);
      const along = t.vx * nx + t.vz * nz;
      if (along < pushSpeed) { t.vx += nx * (pushSpeed - along); t.vz += nz * (pushSpeed - along); }
    }
  }

  // ---- being hurt

  // Hit points off, already scaled for the zone or blast. `byId` is who did it (0 for nobody), the grudge that makes
  // luring work. Returns what it actually took; at 0 it falls.
  damage(amount: number, byId: number): number {
    if (!this.alive || amount <= 0) return 0;
    const taken = Math.min(this.hp, amount);
    this.hp -= taken;
    if (byId > 0) { this.grudgeId = byId; this.grudgeFor = this.config.grudgeSeconds; }
    if (this.hp <= 0) this.fall();
    return taken;
  }

  // A shot along a ray: the zone it hits and how far along, into `out`, like a mech's hit boxes. Nothing once it is down.
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number, out: ZoneHit): boolean {
    if (!this.alive) return false;
    return raycastMech(ox, oy, oz, dx, dy, dz, maxDistance, this.x, this.y, this.z, this.yaw, this.hitBoxes, out);
  }

  zoneMultiplier(zone: number): number {
    return this.config.zoneMultipliers[zone] ?? 1;
  }

  // How much of a blast reaches it: 1 at its body, falling to 0 at `radius` from it, measured to the nearest point of
  // its upright cylinder. 0 once it is down.
  blastShare(x: number, y: number, z: number, radius: number): number {
    if (!this.alive) return 0;
    const sideways = Math.max(0, Math.hypot(x - this.x, z - this.z) - this.config.radius);
    const up = y < this.y ? this.y - y : y > this.y + this.config.height ? y - this.y - this.config.height : 0;
    const distance = Math.hypot(sideways, up);
    return distance >= radius ? 0 : 1 - distance / radius;
  }

  private fall(): void {
    this.hp = 0;
    this.begin("down");
    this.host.sendNear(this.x, this.z, { t: "titan", event: "fall", x: this.x, y: this.y, z: this.z });
    this.host.tellEveryone({ t: "notice", text: this.config.fallNotice });
    this.host.noise("explosion", this.x, this.z);
  }

  // The body hits the ground: a big blast that crushes whoever it lands on, and its loot all round.
  private land(): void {
    const f = this.config.fall;
    this.fallen = true;
    this.host.blast(this.x, this.y, this.z, f.damage, f.radius, CAUSE_TITAN_STOMP);
    this.host.spill(this.x, this.y, this.z, f.contents, f.spillMeters);
  }

  private groundAt(x: number, z: number): number {
    const ground = this.world.groundAt(x, z);
    return Number.isFinite(ground) ? ground : 0;
  }
}

// Where the Titan wakes up: inside the ring as it is then, near its middle, on open dry ground, and well away from every
// mech so nobody is stomped the moment it appears. With no such spot after a few tries, the middle of the ring.
export function placeTitan(
  config: TitanConfig, ring: RingSchedule, at: number, map: { world: World; nav: NavGrid; meters: number }, mechs: Iterable<Player>, random: () => number,
): { x: number; z: number } {
  const circle = createRingNow();
  ringAt(ring, at, circle);
  const standing = [...mechs].filter((m) => m.participant && !m.dead);
  for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * circle.radius * config.placeShareOfRing;
    const x = circle.cx + Math.cos(angle) * distance, z = circle.cz + Math.sin(angle) * distance;
    if (!openGround(map, x, z, config.radius)) continue;
    if (standing.some((m) => Math.hypot(m.state.x - x, m.state.z - z) < config.clearOfMechsMeters)) continue;
    return { x, z };
  }
  return { x: circle.cx, z: circle.cz };
}
