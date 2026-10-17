import type { Bot } from "./Bot";
import type { FireGate, Loadout, MechInput, MechState, NoiseEvent, ServerMessage } from "@rustbucket/shared";

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
  loadout: Loadout;
  askedSlot: number; // the slot the client last asked for. Only a change of request switches weapons.
  interactReadyTick: number; // a fresh press of E is ignored until this tick, so taking weapons cannot be spammed
  interactHeld: boolean; // E was down on the last input, so a new press can be told from holding it
  lootingId: number; // the wreck being looted, 0 for none
  lootSeconds: number; // how long E has been held on that wreck
  looted: boolean; // this mech's wreck has been emptied
  repairZone: number; // the part being repaired, -1 for none
  repairSeconds: number; // how long F has been held on it
  healthMark: number; // hit points plus armor last step, so any damage at all can cancel a repair
  interested: Set<number>;
  watchId: number;
  heard: NoiseEvent[];
  sentPickupIds: number[]; // the pickups in the last snapshot, so an unchanged list is not sent again // sounds to pass on in the next snapshot
  quietUntil: Int32Array; // per noise kind, the tick before which this mech makes no new pulse // when knocked out, the mech this client says it is watching (0 for none) // ids of the mechs this client is currently being sent
  dead: boolean;
  respawnTick: number; // between matches a destroyed mech comes back on this tick
  participant: boolean; // took part in the current match from its start
  eliminated: boolean; // out of the current match, now watching
  // Recent positions, one per tick, so shots can be checked against where a target was a moment ago.
  historyTick: Int32Array;
  history: Float32Array; // x, y, z, yaw per entry
}
