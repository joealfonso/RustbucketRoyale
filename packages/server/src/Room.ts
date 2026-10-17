import {
  FireGate, STEP, computeShot, createMechInput, createMechState, createShot, parseClientMessage,
  stepMech, toMechInput, writeSelf,
  type Box, type MechInput, type MechState, type MechStats, type NetStats, type OtherState,
  type ServerMessage, type WeaponStats,
} from "@rustbucket/shared";

const KILL_HEIGHT = -50;

interface Player {
  id: number;
  slot: number;
  send: (message: ServerMessage) => void;
  state: MechState;
  gate: FireGate;
  queue: { seq: number; input: MechInput }[];
  lastSeq: number; // highest input processed, sent back as the ack
  steps: number; // the player's own clock: one step per input processed
  budget: number; // message allowance, refills every tick
}

export interface RoomConfig {
  mech: MechStats;
  weapon: WeaponStats;
  net: NetStats;
  boxes: readonly Box[];
  spawn: [number, number, number];
  random?: () => number;
}

// One match. Transport free: it only sees parsed messages and a send function, so it is easy to test.
// Every input is processed exactly once, in order, so the client's prediction and the server never disagree on history.
export class Room {
  private players = new Map<number, Player>();
  private nextId = 1;
  private tickCount = 0;
  private shot = createShot();
  private random: () => number;

  constructor(private config: RoomConfig) {
    this.random = config.random ?? Math.random;
  }

  get playerCount(): number {
    return this.players.size;
  }

  // Returns the new player's id, or null if the room is full.
  join(send: (message: ServerMessage) => void): number | null {
    const { net, mech, spawn } = this.config;
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
      id, slot, send, state, gate: new FireGate(), queue: [], lastSeq: 0, steps: 0, budget: net.maxMessagesPerSecond,
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
    const { net, mech, weapon } = this.config;
    this.tickCount++;

    for (const player of this.players.values()) {
      player.budget = Math.min(net.maxMessagesPerSecond, player.budget + net.maxMessagesPerSecond * STEP);

      for (let i = 0; i < net.maxInputsPerTick; i++) {
        const next = player.queue.shift();
        if (!next) break;
        stepMech(player.state, next.input, mech, STEP, this.config.boxes);
        player.steps++;
        player.lastSeq = next.seq;
        if (next.input.fire) this.tryShoot(player, next.input, weapon);
        if (player.state.y < KILL_HEIGHT) this.respawn(player);
      }
    }

    if (this.tickCount % net.snapshotEvery === 0) this.broadcastSnapshots();
  }

  private tryShoot(player: Player, input: MechInput, weapon: WeaponStats): void {
    if (!player.gate.tryFire(player.steps * STEP, weapon.shotsPerSecond)) return;
    // The aim point is only a direction hint, so it cannot send a shot faster or from anywhere but the barrel.
    computeShot(player.state, input.targetX, input.targetY, input.targetZ, weapon, this.random, this.shot);
    const s = this.shot;
    const message: ServerMessage = { t: "shot", id: player.id, ox: s.ox, oy: s.oy, oz: s.oz, dx: s.dx, dy: s.dy, dz: s.dz };
    for (const other of this.players.values()) other.send(message);
  }

  private respawn(player: Player): void {
    player.state = createMechState(this.config.mech, ...this.spawnFor(player.slot), Math.PI);
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
        running: p.state.running, jetting: p.state.jetting,
      });
    }
    for (const player of this.players.values()) {
      player.send({
        t: "snapshot", tick: this.tickCount, ack: player.lastSeq, you: writeSelf(player.state),
        others: others.filter((o) => o.id !== player.id),
      });
    }
  }
}
