import type { Bot } from "./Bot";
import type { FireGate, MechInput, MechState, NoiseEvent, ServerMessage } from "@rustbucket/shared";

// One person in a room. Plain data: the room moves it, this file just names the fields.
export interface Player {
  id: number;
  slot: number;
  bot: Bot | null; // set for computer players, which have no connection
  send: (message: ServerMessage) => void;
  state: MechState;
  gate: FireGate;
  grenadeGate: FireGate;
  queue: { seq: number; input: MechInput }[];
  lastSeq: number; // highest input processed, sent back as the ack
  ackTick: number; // the server tick on which that input was processed, so a client can subtract the wait from its ping
  lagMs: number; // how far behind the client's view is, from what it reports. Used to rewind targets for its shots
  steps: number; // the player's own clock: one step per input processed
  budget: number; // message allowance, refills every tick
  hp: number[];
  interested: Set<number>;
  watchId: number;
  heard: NoiseEvent[]; // sounds to pass on in the next snapshot
  quietUntil: Int32Array; // per noise kind, the tick before which this mech makes no new pulse // when knocked out, the mech this client says it is watching (0 for none) // ids of the mechs this client is currently being sent
  dead: boolean;
  respawnTick: number; // between matches a destroyed mech comes back on this tick
  participant: boolean; // took part in the current match from its start
  eliminated: boolean; // out of the current match, now watching
  // Recent positions, one per tick, so shots can be checked against where a target was a moment ago.
  historyTick: Int32Array;
  history: Float32Array; // x, y, z, yaw per entry
}
