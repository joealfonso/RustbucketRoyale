import {
  FireGate, STEP, ZONE_COUNT, applyDamage, computeShot, createGrenade, createHealth, createMechInput,
  createMechState, createRayHit, createRingNow, createShot, createZoneHit, isDestroyed, isOutsideRing, makeRingSchedule,
  parseClientMessage, ringAt, raycastMech, stepGrenade, stepMech, throwGrenade, toMechInput, writeSelf,
  type BotStats, type CombatStats, type GrenadeState, type GrenadeStats, type MatchConfig, type MatchState, type MechInput,
  type MechStats, type NetStats, type OtherState, type RingConfig, type RingNow, type RingSchedule, type ServerMessage,
  type WeaponStats, type World, type ZoneSet,
} from "@rustbucket/shared";
import { Bot, type BotTarget } from "./Bot";
import type { Player } from "./Player";

const KILL_HEIGHT = -50;
const CHEST_HEIGHT = 1.7; // where splash damage measures to
const BLAST_LIFT = 0.2; // keeps a grenade resting on the floor from blasting from inside it

interface LiveGrenade {
  ownerId: number;
  state: GrenadeState;
}

export interface MapForRoom {
  world: World;
  spawns: [number, number, number][];
  meters: number;
}

export interface RoomConfig {
  mech: MechStats;
  bots: BotStats;
  weapon: WeaponStats;
  grenade: GrenadeStats;
  combat: CombatStats;
  net: NetStats;
  match: MatchConfig;
  ring: RingConfig;
  zones: ZoneSet;
  // Builds the map for a tier and seed. The room asks for a fresh one at the start of every match.
  mapFor: (tier: string, seed: number) => MapForRoom;
  random?: () => number;
}

// One room: a lobby that runs match after match. Transport free: it only sees parsed messages and a send
// function, so it is easy to test. Every input is processed exactly once, in order, so the client's
// prediction and the server never disagree on history.
export class Room {
  private players = new Map<number, Player>();
  private grenades: LiveGrenade[] = [];
  private nextId = 1;
  private tickCount = 0;
  private shot = createShot();
  private newGrenade = createGrenade();
  private worldHit = createRayHit();
  private zoneHit = createZoneHit();
  private ringNow = createRingNow();
  private lobbyZone = createRingNow();
  private random: () => number;
  private historyLength: number;

  private state: MatchState = "lobby";
  private phaseEndTick = 0;
  private matchStartTick = 0;
  private startedWith = 0;
  private placeCounter = 0;
  private hostId = 0;
  private seed: number;
  private map: MapForRoom;
  private ring: RingSchedule | null = null;

  private botInput = createMechInput();
  private botTargets: BotTarget[] = [];

  // `botCount` computer players fill the room. They are capped by the spawns the map has left over from the humans.
  constructor(readonly code: string, readonly tier: string, private config: RoomConfig, botCount = 0) {
    this.random = config.random ?? Math.random;
    this.historyLength = Math.ceil(config.combat.historyMs / (STEP * 1000));
    this.seed = this.newSeed();
    this.map = config.mapFor(tier, this.seed);
    const room = this.map.spawns.length - config.net.maxPlayers;
    for (let i = 0; i < Math.min(botCount, Math.max(0, room)); i++) this.addBot();
  }

  // People, not bots. A room with only bots left in it is empty.
  get playerCount(): number {
    return this.humans().length;
  }

  private humans(): Player[] {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  private freeSlot(): number {
    const taken = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;
    return slot;
  }

  private addBot(): void {
    const { mech, net } = this.config;
    const slot = this.freeSlot();
    const id = this.nextId++;
    this.players.set(id, {
      id, slot, bot: new Bot(this.config.bots, this.random), send: () => {}, state: createMechState(mech, ...this.spawnFor(slot), Math.PI),
      gate: new FireGate(), grenadeGate: new FireGate(), queue: [], lastSeq: 0, ackTick: 0, lagMs: 0, steps: 0, budget: net.maxMessagesPerSecond,
      hp: createHealth(this.config.zones), dead: false, participant: true, eliminated: false,
      historyTick: new Int32Array(this.historyLength).fill(-1), history: new Float32Array(this.historyLength * 4),
    });
  }

  get matchState(): MatchState {
    return this.state;
  }

  private newSeed(): number {
    return Math.floor(this.random() * 0x100000000);
  }

  // Returns the new player's id, or null if the room is full.
  join(send: (message: ServerMessage) => void): number | null {
    const { net, mech } = this.config;
    if (this.humans().length >= net.maxPlayers) {
      send({ t: "refused", reason: "The room is full." });
      return null;
    }
    const slot = this.freeSlot();

    // Someone arriving while a match is running can only watch it.
    const watching = this.state === "active" || this.state === "results";
    const id = this.nextId++;
    const player: Player = {
      id, slot, bot: null, send, state: createMechState(mech, ...this.spawnFor(slot), Math.PI), gate: new FireGate(), grenadeGate: new FireGate(),
      queue: [], lastSeq: 0, ackTick: 0, lagMs: this.config.combat.defaultLagMs, steps: 0, budget: net.maxMessagesPerSecond, hp: createHealth(this.config.zones),
      dead: watching, participant: !watching, eliminated: watching,
      historyTick: new Int32Array(this.historyLength).fill(-1), history: new Float32Array(this.historyLength * 4),
    };
    this.players.set(id, player);
    if (this.hostId === 0) this.hostId = id;

    send({ t: "welcome", id, code: this.code, seed: this.seed, tier: this.tier });
    this.broadcastRoom();
    return id;
  }

  leave(id: number): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this.humans()[0]?.id ?? 0;
    // Walking out of a running match counts as being knocked out.
    if (this.state === "active" && player.participant && !player.eliminated) this.checkMatchOver();
    this.broadcastRoom();
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

    if (message.t === "start") {
      if (id === this.hostId && this.state === "lobby") this.beginCountdown();
      return true;
    }

    if (message.lagMs !== undefined) player.lagMs = message.lagMs;
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

    if (this.state === "countdown" && this.tickCount >= this.phaseEndTick) this.beginMatch();
    else if (this.state === "results" && this.tickCount >= this.phaseEndTick) this.afterResults();

    if (this.state === "active" && this.ring) ringAt(this.ring, this.elapsedSeconds(), this.ringNow);
    for (const player of this.players.values()) {
      if (player.bot) {
        this.runBot(player);
        this.recordHistory(player);
        continue;
      }
      player.budget = Math.min(net.maxMessagesPerSecond, player.budget + net.maxMessagesPerSecond * STEP);
      for (let i = 0; i < net.maxInputsPerTick; i++) {
        const next = player.queue.shift();
        if (!next) break;
        this.processInput(player, next.input);
        player.lastSeq = next.seq;
        player.ackTick = this.tickCount;
      }
      this.recordHistory(player);
    }

    this.stepGrenades();
    if (this.state === "active") this.applyRing();
    if (this.tickCount % net.snapshotEvery === 0) this.broadcastSnapshots();
  }

  // A bot decides what to do this tick, from what it can see, and its input goes through the same path as a person's.
  // It roams and fights in the lobby and between matches too, where nothing does damage, so the room feels alive.
  // Only the countdown holds everyone still.
  private runBot(player: Player): void {
    const input = this.botInput;
    if (this.state !== "countdown" && !player.dead && player.bot) {
      this.botTargets.length = 0;
      for (const other of this.players.values()) {
        if (other === player || !other.participant || other.dead) continue;
        // Between matches they only go for people, so they come to you instead of squabbling out of sight.
        if (this.state !== "active" && other.bot) continue;
        this.botTargets.push({ id: other.id, x: other.state.x, y: other.state.y, z: other.state.z });
      }
      player.bot.think(player.state, this.botTargets, this.botZone(player), this.map.world, STEP, input);
    } else {
      Object.assign(input, createMechInput(), { aimYaw: player.state.bodyYaw });
    }
    this.processInput(player, input);
  }

  // The area a bot wanders in: the live ring during a match. Otherwise a circle round the nearest person, so the room
  // is full of activity where you are, not out of sight across the map.
  private botZone(bot: Player): RingNow {
    if (this.state === "active" && this.ring) return this.ringNow;
    const zone = this.lobbyZone;
    let nearest: Player | null = null;
    let best = Infinity;
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const d = Math.hypot(p.state.x - bot.state.x, p.state.z - bot.state.z);
      if (d < best) { best = d; nearest = p; }
    }
    zone.cx = nearest ? nearest.state.x : 0;
    zone.cz = nearest ? nearest.state.z : 0;
    zone.radius = nearest ? 70 : this.map.meters * 0.45;
    return zone;
  }

  // ---- match flow

  // Builds a fresh map, puts everyone on a spawn, and starts the countdown.
  private beginCountdown(): void {
    this.seed = this.newSeed();
    this.map = this.config.mapFor(this.tier, this.seed);
    this.ring = makeRingSchedule(this.config.ring, this.tier, this.map.meters, this.random);
    this.grenades = [];
    for (const player of this.players.values()) {
      player.participant = true;
      player.eliminated = false;
      player.dead = false;
      player.hp = createHealth(this.config.zones);
      player.state = createMechState(this.config.mech, ...this.spawnFor(player.slot), Math.PI);
      player.queue.length = 0;
    }
    this.state = "countdown";
    this.phaseEndTick = this.tickCount + Math.ceil(this.config.match.countdownSeconds / STEP);
    this.broadcastRoom();
  }

  private beginMatch(): void {
    this.state = "active";
    this.matchStartTick = this.tickCount;
    this.startedWith = this.players.size;
    this.placeCounter = this.players.size;
    this.broadcastRoom();
  }

  private elapsedSeconds(): number {
    return (this.tickCount - this.matchStartTick) * STEP;
  }

  private alivePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.participant && !p.eliminated);
  }

  // Someone is out. Records their place, tells the room, and checks whether the match is over.
  private eliminate(player: Player, killer: Player | null): void {
    if (player.eliminated) return;
    player.eliminated = true;
    player.dead = true;
    player.hp[ZONE_COUNT - 1] = 0;
    const place = this.placeCounter--;
    const alive = this.alivePlayers().length;
    const message: ServerMessage = { t: "eliminated", id: player.id, killerId: killer?.id ?? null, place, alive };
    for (const p of this.players.values()) p.send(message);
    this.checkMatchOver();
  }

  private checkMatchOver(): void {
    if (this.state !== "active") return;
    const alive = this.alivePlayers();
    // A match that began with one player runs until they fall or time runs out, so a solo test is not over at once.
    const over = this.startedWith >= 2 ? alive.length <= 1 : alive.length === 0;
    if (over) this.endMatch(alive.length === 1 ? alive[0]! : null);
  }

  private endMatch(winner: Player | null): void {
    this.state = "results";
    this.phaseEndTick = this.tickCount + Math.ceil(this.config.match.resultsSeconds / STEP);
    const message: ServerMessage = { t: "result", winnerId: winner?.id ?? null };
    for (const p of this.players.values()) p.send(message);
    this.broadcastRoom();
  }

  private afterResults(): void {
    if (this.config.match.autoNextMatch && this.players.size > 0) this.beginCountdown();
    else {
      this.state = "lobby";
      this.broadcastRoom();
    }
  }

  // Everyone outside the ring takes its damage on every zone, every tick.
  private applyRing(): void {
    if (!this.ring) return;
    const elapsed = this.elapsedSeconds();
    const ring = this.ringNow;
    if (elapsed >= this.config.match.matchSeconds) {
      // Time is up. The healthiest survivor wins.
      const alive = this.alivePlayers();
      const health = (p: Player) => p.hp.reduce((a, b) => a + b, 0);
      alive.sort((a, b) => health(b) - health(a));
      this.endMatch(alive[0] ?? null);
      return;
    }
    // The same circle the clients draw, worked out from the same schedule and the match clock.
    ringAt(this.ring, elapsed, ring);
    for (const player of this.alivePlayers()) {
      if (!isOutsideRing(ring, player.state.x, player.state.z)) continue;
      for (let zone = 0; zone < ZONE_COUNT; zone++) applyDamage(player.hp, this.config.zones, zone, ring.damagePerSecond * STEP);
      if (isDestroyed(player.hp)) this.eliminate(player, null);
    }
  }

  // ---- movement and combat

  private processInput(player: Player, input: MechInput): void {
    // A destroyed or frozen mech can look around but not move, jet, or fire.
    // Players watch from the lobby phases too, and everyone stands still during the countdown.
    if (player.dead || this.state === "countdown") {
      input.moveX = 0; input.moveY = 0; input.run = false; input.jet = false; input.dash = false; input.fire = false; input.grenade = false;
    }
    stepMech(player.state, input, this.config.mech, STEP, this.map.world);
    player.steps++;

    if (input.fire) this.tryShoot(player, input);
    if (input.grenade) this.tryThrow(player, input);
    if (player.state.y < KILL_HEIGHT && !player.dead) this.fellOffMap(player);
  }

  // Outside a running match nothing can be lost, so a fall just puts you back on your spawn.
  private fellOffMap(player: Player): void {
    if (this.state === "active") this.eliminate(player, null);
    else player.state = createMechState(this.config.mech, ...this.spawnFor(player.slot), Math.PI);
  }

  private tryShoot(player: Player, input: MechInput): void {
    const { weapon } = this.config;
    if (!player.gate.tryFire(player.steps * STEP, weapon.shotsPerSecond)) return;

    // The aim point is only a direction hint, so it cannot send a shot faster or from anywhere but the barrel.
    computeShot(player.state, input.targetX, input.targetY, input.targetZ, weapon, this.random, this.shot);
    const s = this.shot;

    // How far the shot goes: the nearest wall, unless a mech is in the way.
    let reach = weapon.maxAimDistance;
    if (this.map.world.raycast(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.worldHit)) reach = this.worldHit.distance;

    // Shots are only harmful while a match is running.
    const target = this.state === "active" ? this.findTarget(player, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach) : null;
    if (target) {
      reach = this.zoneHit.distance;
      const taken = applyDamage(target.hp, this.config.zones, this.zoneHit.zone, weapon.damage);
      const killed = !target.eliminated && isDestroyed(target.hp);
      player.send({
        t: "hit", targetId: target.id, zone: this.zoneHit.zone, damage: taken, killed,
        x: s.ox + s.dx * reach, y: s.oy + s.dy * reach, z: s.oz + s.dz * reach,
      });
      if (killed) this.eliminate(target, player);
    }

    const message: ServerMessage = {
      t: "shot", id: player.id, ox: s.ox, oy: s.oy, oz: s.oz, dx: s.dx, dy: s.dy, dz: s.dz, length: reach, hitMech: target !== null,
    };
    for (const other of this.players.values()) other.send(message);
  }

  // Finds the nearest living mech along the shot, checked at where it stood a moment ago, because
  // the shooter was looking at a slightly old picture. Result zone and distance are left in this.zoneHit.
  private findTarget(shooter: Player, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number): Player | null {
    // Rewind by what this shooter actually saw, never more than the cap, so the shot lands where they aimed.
    const lagMs = Math.min(shooter.lagMs, this.config.combat.lagCompensationMs);
    const rewindTicks = Math.min(this.historyLength - 1, Math.round(lagMs / (STEP * 1000)));
    const wanted = this.tickCount - rewindTicks;
    let best: Player | null = null;
    let bestDistance = reach;
    let bestZone = -1;

    for (const target of this.players.values()) {
      if (target === shooter || target.dead || !target.participant) continue;
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
      if (!stepGrenade(live.state, this.config.grenade, STEP, this.map.world)) continue;
      this.grenades.splice(i, 1);
      this.explode(live);
    }
  }

  // Splash hits every zone of everyone in range, so a close grenade wrecks parts and makes a story.
  // Walls block it, and it does nothing outside a running match.
  private explode(live: LiveGrenade): void {
    const { grenade, zones } = this.config;
    const g = live.state;
    const bx = g.x, by = g.y + BLAST_LIFT, bz = g.z;
    const blast: ServerMessage = { t: "explode", x: g.x, y: g.y, z: g.z };
    for (const p of this.players.values()) p.send(blast);
    if (this.state !== "active") return;

    const owner = this.players.get(live.ownerId);
    for (const target of this.players.values()) {
      if (target.dead || !target.participant) continue;
      const dx = target.state.x - bx, dy = target.state.y + CHEST_HEIGHT - by, dz = target.state.z - bz;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= grenade.blastRadius) continue;
      if (distance > 0.5 && this.map.world.raycast(bx, by, bz, dx / distance, dy / distance, dz / distance, distance - 0.5, this.worldHit)) continue;

      const amount = grenade.damage * (1 - distance / grenade.blastRadius);
      let total = 0;
      for (let zone = 0; zone < ZONE_COUNT; zone++) total += applyDamage(target.hp, zones, zone, amount);
      const killed = isDestroyed(target.hp);
      owner?.send({ t: "hit", targetId: target.id, zone: -1, damage: total, killed, x: target.state.x, y: target.state.y + CHEST_HEIGHT, z: target.state.z });
      if (killed) this.eliminate(target, owner ?? null);
    }
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
    const { spawns } = this.map;
    return spawns[slot % spawns.length]!;
  }

  // ---- messages out

  private broadcastRoom(): void {
    const message: ServerMessage = {
      t: "room", code: this.code, tier: this.tier, state: this.state, seed: this.seed, hostId: this.hostId,
      players: this.humans().length, ring: this.state === "lobby" ? null : this.ring, matchSeconds: this.config.match.matchSeconds,
    };
    for (const p of this.players.values()) p.send(message);
  }

  private progress(): { state: MatchState; seconds: number; alive: number; total: number } {
    let seconds = 0;
    if (this.state === "countdown" || this.state === "results") seconds = Math.max(0, (this.phaseEndTick - this.tickCount) * STEP);
    else if (this.state === "active") seconds = this.elapsedSeconds();
    const alive = this.state === "lobby" ? this.players.size : this.alivePlayers().length;
    return { state: this.state, seconds, alive, total: this.state === "lobby" ? this.players.size : this.startedWith || this.players.size };
  }

  private broadcastSnapshots(): void {
    // Everyone sees everyone for now. Nearby-only filtering comes with the bots (gate 5b).
    const others: OtherState[] = [];
    for (const p of this.players.values()) {
      if (!p.participant) continue; // spectators have no mech to draw
      others.push({
        id: p.id, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.state.bodyYaw,
        running: p.state.running, jetting: p.state.jetting, dead: p.dead, bot: p.bot !== null, hp: p.hp.map(Math.ceil),
      });
    }
    const match = this.progress();
    for (const player of this.players.values()) {
      if (player.bot) continue;
      player.send({
        t: "snapshot", tick: this.tickCount, ack: player.lastSeq, ackAgeMs: (this.tickCount - player.ackTick) * STEP * 1000, you: writeSelf(player.state),
        health: { hp: player.hp.map(Math.ceil), dead: player.dead, respawnIn: 0 }, match,
        others: others.filter((o) => o.id !== player.id),
      });
    }
  }
}
