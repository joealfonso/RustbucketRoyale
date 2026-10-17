import { Predictor, STEP, createMechInput, type MechInput, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import type { Room } from "./Room";

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
    const [x, y, z] = config.spawn;
    this.predictor = new Predictor(config.mech, config.boxes, x + (this.id - 1 - 3.5) * config.net.spawnSpacing, y, z, Math.PI);
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
