import {
  FireGate, STEP, ZONE_COUNT, ZONE_TORSO, applyDamage, computeShot, createGrenade, createHealth, createMechInput,
  createMechState, createRayHit, createShot, createZoneHit, isDestroyed, parseClientMessage, raycastBoxes, raycastMech,
  stepGrenade, stepMech, throwGrenade, toMechInput, writeSelf,
  type Box, type CombatStats, type GrenadeState, type GrenadeStats, type MechInput, type MechState, type MechStats,
  type NetStats, type OtherState, type ServerMessage, type WeaponStats, type ZoneSet,
} from "@rustbucket/shared";

const KILL_HEIGHT = -50;
const CHEST_HEIGHT = 1.7; // where splash damage measures to
const BLAST_LIFT = 0.2; // keeps a grenade resting on the floor from blasting from inside it

interface Player {
  id: number;
  slot: number;
  send: (message: ServerMessage) => void;
  state: MechState;
  gate: FireGate;
  grenadeGate: FireGate;
  queue: { seq: number; input: MechInput }[];
  lastSeq: number; // highest input processed, sent back as the ack
  steps: number; // the player's own clock: one step per input processed
  budget: number; // message allowance, refills every tick
  hp: number[];
  dead: boolean;
  respawnTick: number;
  // Recent positions, one per tick, so shots can be checked against where a target was a moment ago.
  historyTick: Int32Array;
  history: Float32Array; // x, y, z, yaw per entry
}

interface LiveGrenade {
  ownerId: number;
  state: GrenadeState;
}

export interface RoomConfig {
  mech: MechStats;
  weapon: WeaponStats;
  grenade: GrenadeStats;
  combat: CombatStats;
  net: NetStats;
  zones: ZoneSet;
  boxes: readonly Box[];
  spawn: [number, number, number];
  random?: () => number;
}

// One match. Transport free: it only sees parsed messages and a send function, so it is easy to test.
// Every input is processed exactly once, in order, so the client's prediction and the server never disagree on history.
export class Room {
  private players = new Map<number, Player>();
  private grenades: LiveGrenade[] = [];
  private nextId = 1;
  private tickCount = 0;
  private shot = createShot();
  private newGrenade = createGrenade();
  private worldHit = createRayHit();
  private zoneHit = createZoneHit();
  private random: () => number;
  private historyLength: number;

  constructor(private config: RoomConfig) {
    this.random = config.random ?? Math.random;
    this.historyLength = Math.ceil(config.combat.historyMs / (STEP * 1000));
  }

  get playerCount(): number {
    return this.players.size;
  }

  // Returns the new player's id, or null if the room is full.
  join(send: (message: ServerMessage) => void): number | null {
    const { net, mech } = this.config;
    if (this.players.size >= net.maxPlayers) {
      send({ t: "full" });
      return null;
    }
    const taken = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;

    const id = this.nextId++;
    const state = createMechState(mech, ...this.spawnFor(slot), Math.PI);
    this.players.set(id, {
      id, slot, send, state, gate: new FireGate(), grenadeGate: new FireGate(), queue: [], lastSeq: 0, steps: 0,
      budget: net.maxMessagesPerSecond, hp: createHealth(this.config.zones), dead: false, respawnTick: 0,
      historyTick: new Int32Array(this.historyLength).fill(-1), history: new Float32Array(this.historyLength * 4),
    });
    send({ t: "welcome", id });
    return id;
  }

  leave(id: number): void {
    this.players.delete(id);
  }

  // Returns false when the client is flooding and should be disconnected.
  receive(id: number, raw: string): boolean {
    const player = this.players.get(id);
    if (!player) return false;

    player.budget -= 1;
    if (player.budget < this.config.net.floodKickBudget) return false;
    if (player.budget < 0) return true; // over the rate: ignore this message

    const message = parseClientMessage(raw);
    if (!message) return true;
    if (message.seq <= (player.queue.at(-1)?.seq ?? player.lastSeq)) return true; // replayed or out of order
    if (player.queue.length >= this.config.net.maxQueuedInputs) return true; // client is far ahead, drop the extra

    const input = createMechInput();
    toMechInput(message, input);
    player.queue.push({ seq: message.seq, input });
    return true;
  }

  // One server tick. The caller runs this 60 times a second.
  tick(): void {
    const { net } = this.config;
    this.tickCount++;

    for (const player of this.players.values()) {
      player.budget = Math.min(net.maxMessagesPerSecond, player.budget + net.maxMessagesPerSecond * STEP);
      if (player.dead && this.tickCount >= player.respawnTick) this.respawn(player);

      for (let i = 0; i < net.maxInputsPerTick; i++) {
        const next = player.queue.shift();
        if (!next) break;
        this.processInput(player, next.input);
        player.lastSeq = next.seq;
      }
      this.recordHistory(player);
    }

    this.stepGrenades();
    if (this.tickCount % net.snapshotEvery === 0) this.broadcastSnapshots();
  }

  private processInput(player: Player, input: MechInput): void {
    // A destroyed mech can look around but not move, jet, or fire.
    if (player.dead) {
      input.moveX = 0; input.moveY = 0; input.run = false; input.jet = false; input.fire = false; input.grenade = false;
    }
    stepMech(player.state, input, this.config.mech, STEP, this.config.boxes);
    player.steps++;

    if (input.fire) this.tryShoot(player, input);
    if (input.grenade) this.tryThrow(player, input);
    if (player.state.y < KILL_HEIGHT && !player.dead) this.kill(player);
  }

  private tryShoot(player: Player, input: MechInput): void {
    const { weapon } = this.config;
    if (!player.gate.tryFire(player.steps * STEP, weapon.shotsPerSecond)) return;

    // The aim point is only a direction hint, so it cannot send a shot faster or from anywhere but the barrel.
    computeShot(player.state, input.targetX, input.targetY, input.targetZ, weapon, this.random, this.shot);
    const s = this.shot;

    // How far the shot goes: the nearest wall, unless a mech is in the way.
    let reach = weapon.maxAimDistance;
    if (raycastBoxes(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.config.boxes, this.worldHit)) reach = this.worldHit.distance;

    const target = this.findTarget(player, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach);
    if (target) {
      reach = this.zoneHit.distance;
      const taken = applyDamage(target.hp, this.config.zones, this.zoneHit.zone, weapon.damage);
      const killed = !target.dead && isDestroyed(target.hp);
      player.send({
        t: "hit", targetId: target.id, zone: this.zoneHit.zone, damage: taken, killed,
        x: s.ox + s.dx * reach, y: s.oy + s.dy * reach, z: s.oz + s.dz * reach,
      });
      if (killed) this.kill(target);
    }

    const message: ServerMessage = {
      t: "shot", id: player.id, ox: s.ox, oy: s.oy, oz: s.oz, dx: s.dx, dy: s.dy, dz: s.dz, length: reach, hitMech: target !== null,
    };
    for (const other of this.players.values()) other.send(message);
  }

  // Finds the nearest living mech along the shot, checked at where it stood a moment ago, because
  // the shooter was looking at a slightly old picture. Result zone and distance are left in this.zoneHit.
  private findTarget(shooter: Player, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number): Player | null {
    const rewindTicks = Math.min(this.historyLength - 1, Math.round(this.config.combat.lagCompensationMs / (STEP * 1000)));
    const wanted = this.tickCount - rewindTicks;
    let best: Player | null = null;
    let bestDistance = reach;
    let bestZone = -1;

    for (const target of this.players.values()) {
      if (target === shooter || target.dead) continue;
      const index = ((wanted % this.historyLength) + this.historyLength) % this.historyLength;
      const old = target.historyTick[index] === wanted;
      const x = old ? target.history[index * 4]! : target.state.x;
      const y = old ? target.history[index * 4 + 1]! : target.state.y;
      const z = old ? target.history[index * 4 + 2]! : target.state.z;
      const yaw = old ? target.history[index * 4 + 3]! : target.state.bodyYaw;

      if (raycastMech(ox, oy, oz, dx, dy, dz, bestDistance, x, y, z, yaw, this.config.zones, this.zoneHit)) {
        best = target;
        bestDistance = this.zoneHit.distance;
        bestZone = this.zoneHit.zone;
      }
    }
    if (best) {
      this.zoneHit.distance = bestDistance;
      this.zoneHit.zone = bestZone;
    }
    return best;
  }

  private tryThrow(player: Player, input: MechInput): void {
    const { grenade } = this.config;
    if (!player.grenadeGate.tryFire(player.steps * STEP, 1 / grenade.cooldownSeconds)) return;
    throwGrenade(player.state, input.targetX, input.targetY, input.targetZ, grenade, this.newGrenade);
    const g = this.newGrenade;
    this.grenades.push({ ownerId: player.id, state: { ...g } });
    const message: ServerMessage = { t: "grenade", id: player.id, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz };
    for (const other of this.players.values()) other.send(message);
  }

  private stepGrenades(): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const live = this.grenades[i]!;
      if (!stepGrenade(live.state, this.config.grenade, STEP, this.config.boxes)) continue;
      this.grenades.splice(i, 1);
      this.explode(live);
    }
  }

  // Splash hits every zone of everyone in range, so a close grenade wrecks parts and makes a story.
  private explode(live: LiveGrenade): void {
    const { grenade, zones } = this.config;
    const g = live.state;
    const bx = g.x, by = g.y + BLAST_LIFT, bz = g.z;
    const blast: ServerMessage = { t: "explode", x: g.x, y: g.y, z: g.z };
    for (const p of this.players.values()) p.send(blast);

    const owner = this.players.get(live.ownerId);
    for (const target of this.players.values()) {
      if (target.dead) continue;
      const dx = target.state.x - bx, dy = target.state.y + CHEST_HEIGHT - by, dz = target.state.z - bz;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= grenade.blastRadius) continue;
      // Walls block the blast.
      if (distance > 0.5 && raycastBoxes(bx, by, bz, dx / distance, dy / distance, dz / distance, distance - 0.5, this.config.boxes, this.worldHit)) continue;

      const amount = grenade.damage * (1 - distance / grenade.blastRadius);
      let total = 0;
      for (let zone = 0; zone < ZONE_COUNT; zone++) total += applyDamage(target.hp, zones, zone, amount);
      const killed = isDestroyed(target.hp);
      owner?.send({ t: "hit", targetId: target.id, zone: -1, damage: total, killed, x: target.state.x, y: target.state.y + CHEST_HEIGHT, z: target.state.z });
      if (killed) this.kill(target);
    }
  }

  private kill(player: Player): void {
    player.hp[ZONE_TORSO] = 0;
    player.dead = true;
    player.respawnTick = this.tickCount + Math.ceil(this.config.combat.respawnSeconds / STEP);
  }

  // Stand-in until the real match loop (M5): destroyed mechs come back at their spawn after a short wait.
  private respawn(player: Player): void {
    player.state = createMechState(this.config.mech, ...this.spawnFor(player.slot), Math.PI);
    player.hp = createHealth(this.config.zones);
    player.dead = false;
  }

  private recordHistory(player: Player): void {
    const index = this.tickCount % this.historyLength;
    player.historyTick[index] = this.tickCount;
    player.history[index * 4] = player.state.x;
    player.history[index * 4 + 1] = player.state.y;
    player.history[index * 4 + 2] = player.state.z;
    player.history[index * 4 + 3] = player.state.bodyYaw;
  }

  private spawnFor(slot: number): [number, number, number] {
    const [x, y, z] = this.config.spawn;
    return [x + (slot - 3.5) * this.config.net.spawnSpacing, y, z];
  }

  private broadcastSnapshots(): void {
    // Everyone sees everyone for now. Nearby-only filtering lands with bots and big maps (M4/M5).
    const others: OtherState[] = [];
    for (const p of this.players.values()) {
      others.push({
        id: p.id, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.state.bodyYaw,
        running: p.state.running, jetting: p.state.jetting, dead: p.dead, hp: p.hp.map(Math.ceil),
      });
    }
    for (const player of this.players.values()) {
      const respawnIn = player.dead ? Math.max(0, (player.respawnTick - this.tickCount) * STEP) : 0;
      player.send({
        t: "snapshot", tick: this.tickCount, ack: player.lastSeq, you: writeSelf(player.state),
        health: { hp: player.hp.map(Math.ceil), dead: player.dead, respawnIn },
        others: others.filter((o) => o.id !== player.id),
      });
    }
  }
}
