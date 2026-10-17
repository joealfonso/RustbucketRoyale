import { Predictor, STEP, createMechInput, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Room, type RoomConfig } from "./Room";

// A room tuned for fast tests: short countdown and results, and the flat test map.
export function makeRoom(patch: (config: RoomConfig) => RoomConfig = (c) => c, tier = "small"): { room: Room; config: RoomConfig } {
  const base = loadRoomConfig();
  const config = patch({ ...base, match: { ...base.match, countdownSeconds: 0.2, resultsSeconds: 0.5 }, random: lcg(12345) });
  return { room: new Room("TEST", tier, config), config };
}

// Repeatable pseudo random numbers, so a test room picks the same seeds and ring every run.
export function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function tickRoom(room: Room, count: number): void {
  for (let i = 0; i < count; i++) room.tick();
}

export const startMatch = (room: Room, host: Client) => {
  room.receive(host.id, JSON.stringify({ t: "start" }));
  tickRoom(room, 20); // past the short test countdown
};

export type Snapshot = Extract<ServerMessage, { t: "snapshot" }>;

export function inputMessage(seq: number, input: MechInput): string {
  return JSON.stringify({ t: "input", seq, ...input });
}

// Aim yaw PI faces +Z, the way a fresh mech spawns.
export const forward = (extra: Partial<MechInput> = {}): MechInput => ({ ...createMechInput(), moveY: 1, aimYaw: Math.PI, ...extra });
export const idle = (extra: Partial<MechInput> = {}): MechInput => ({ ...createMechInput(), aimYaw: Math.PI, ...extra });

// A fake player: joins a room, predicts locally, and keeps every message the server sends it.
export class Client {
  messages: ServerMessage[] = [];
  id = 0;
  predictor: Predictor;
  constructor(public room: Room, config = loadRoomConfig()) {
    this.id = room.join((m) => this.messages.push(m)) ?? 0;
    // Start where the server put this player (slot = join order here) so the first snapshot is not a jump.
    const map = config.mapFor(room.tier, 0);
    const [x, y, z] = map.spawns[(this.id - 1) % map.spawns.length]!;
    this.predictor = new Predictor(config.mech, map.world, x, y, z, Math.PI);
  }
  send(input: MechInput): void {
    const seq = this.predictor.step(input, STEP);
    this.room.receive(this.id, inputMessage(seq, input));
  }
  snapshots(): Snapshot[] {
    return this.messages.filter((m): m is Snapshot => m.t === "snapshot");
  }
  last(): Snapshot {
    return this.snapshots().at(-1)!;
  }
}
