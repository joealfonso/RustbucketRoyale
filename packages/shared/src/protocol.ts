import type { MatchState } from "./match";
import type { MechInput } from "./MechInput";
import type { RingSchedule } from "./ring";

// The fixed simulation step. Client and server both step the mech in these slices.
export const STEP = 1 / 60;

export interface InputMessage {
  t: "input";
  seq: number;
  moveX: number;
  moveY: number;
  aimYaw: number;
  aimPitch: number;
  run: boolean;
  jet: boolean;
  dash: boolean;
  fire: boolean;
  grenade: boolean;
  slot: number;
  interact: boolean;
  repair: boolean;
  ability: boolean;
  targetX: number;
  targetY: number;
  targetZ: number;
  // How far behind the server the client's picture of other mechs is (round trip plus its smoothing delay),
  // so a shot is checked against what the shooter actually saw. Optional, and capped by the server.
  lagMs?: number;
  // While knocked out: which mech this client is watching, so it is sent what is near that mech.
  watchId?: number;
}

// The room creator asks for the first match to begin. Later matches follow on their own.
export interface StartMessage {
  t: "start";
}

// Dev only: change one number in a data file for this room. The server only listens when started with DEV_TUNING=1.
export interface TuneMessage {
  t: "tune";
  file: string;
  path: string;
  value: number;
}

// The mech this player wants to drive (an index into data/roster.json). In the lobby it swaps at once; during a
// match it waits for the next one. The server checks the number against its roster.
export interface MechMessage {
  t: "mech";
  mech: number;
}

export type ClientMessage = InputMessage | StartMessage | TuneMessage | MechMessage;

// The full state a client needs to rewind and replay its own mech.
export interface SelfState {
  x: number; y: number; z: number;
  vx: number; vz: number; vy: number;
  bodyYaw: number;
  grounded: boolean; running: boolean; jetting: boolean; crawling: boolean;
  dashTime: number; dashCooldown: number; dashX: number; dashZ: number;
  abilityTime: number; abilityCooldown: number; abilityX: number; abilityZ: number;
  fuel: number; fuelLocked: boolean; fuelTimer: number;
  stamina: number; staminaLocked: boolean; staminaTimer: number;
  fuelScale: number;
  mech: number; // which roster mech you are driving. Can change between matches.
}

// All a client needs to draw somebody else.
export interface OtherState {
  id: number;
  x: number; y: number; z: number;
  yaw: number;
  running: boolean;
  jetting: boolean;
  dead: boolean;
  looted: boolean; // a wreck already emptied, so there is nothing left to take
  repairing: boolean; // standing still fixing a part, shown with welding sparks
  bot: boolean;
  hp: number[]; // legs, arms, torso
  weapon: number; // index of the weapon in hand, for drawing the right gun
  armor: number[]; // plate points left on legs, arms, torso, for drawing plates
  upgrades: number[]; // the two upgrades fitted, -1 for none, for drawing the parts bolted on
  mech: number; // which roster mech to draw, and whose hit boxes the crosshair checks
  ability: boolean; // using its ability right now (ramming, or in the air on a pounce)
}

// What you are carrying. Slots hold a weapon index, or -1 when empty.
export interface Loadout {
  slots: [number, number];
  upgrades: [number, number]; // upgrade indexes fitted, -1 for an empty socket. The first fitted is the first to go.
  active: number;
  grenades: number;
  armor: number[];
}

// Something lying on the ground to pick up. `item` indexes the loot item list (see loot.ts).
export interface PickupState {
  id: number;
  item: number;
  x: number; y: number; z: number;
}

// A sound heard on the radar. The position is deliberately a little off, never the exact spot. `kind` indexes NOISE_KINDS.
export interface NoiseEvent {
  x: number;
  z: number;
  kind: number;
}

// Your own health. Kept apart from SelfState because it never feeds back into movement.
export interface HealthState {
  hp: number[];
  dead: boolean;
  respawnIn: number; // seconds left until respawn while dead
}

export interface ShotMessage {
  t: "shot";
  id: number;
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  length: number; // how far the shot travelled before it hit something
  hitMech: boolean;
}

// Sent to the shooter only: what they hit. zone is -1 for splash damage.
export interface HitMessage {
  t: "hit";
  targetId: number;
  zone: number;
  damage: number;
  killed: boolean;
  x: number; y: number; z: number;
}

export interface GrenadeMessage {
  t: "grenade";
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

export interface ExplodeMessage {
  t: "explode";
  x: number; y: number; z: number;
}

// A moment of somebody's ability worth showing: a ram, leap, strike or decoys starting, a ram connecting, a pounce
// landing, a decoy shot and bursting. A barrage start is at the target point, where the warning goes, not the mech.
export interface AbilityMessage {
  t: "ability";
  id: number;
  kind: "ram" | "pounce" | "barrage" | "decoy";
  event: "start" | "hit" | "land" | "pop";
  x: number; y: number; z: number;
  ids?: number[]; // on a decoy start, the decoys' ids, so their owner can draw its own decoys see-through
}

// Where the match is. `seconds` means: time left in the countdown or results, or time elapsed once active.
export interface MatchProgress {
  state: MatchState;
  seconds: number;
  alive: number;
  total: number;
}

export type ServerMessage =
  | { t: "welcome"; id: number; code: string; seed: number; tier: string; tuning: boolean }
  | { t: "tuned"; file: string; path: string; value: number } // a number in a data file changed for this room
  | {
      t: "room"; code: string; tier: string; state: MatchState; seed: number; hostId: number;
      players: number; ring: RingSchedule | null; matchSeconds: number;
    }
  | { t: "eliminated"; id: number; killerId: number | null; place: number; alive: number }
  | { t: "result"; winnerId: number | null }
  | { t: "refused"; reason: string }
  | { t: "prop"; id: number } // a prop was destroyed
  | { t: "props"; destroyed: number[] } // every prop destroyed so far, sent to someone arriving mid way
  | { t: "snapshot"; tick: number; ack: number; ackAgeMs: number; you: SelfState; health: HealthState; match: MatchProgress; others: OtherState[]; noises: NoiseEvent[]; loadout: Loadout; looting: number; repairing: number; pickups: PickupState[] | null } // pickups null: unchanged since the last snapshot
  | ShotMessage
  | HitMessage
  | GrenadeMessage
  | ExplodeMessage
  | AbilityMessage;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Never trust a client. Anything malformed becomes null and is dropped, numbers are clamped into range.
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.t === "start") return { t: "start" };
  if (m.t === "mech") return Number.isInteger(m.mech) && (m.mech as number) >= 0 ? { t: "mech", mech: m.mech as number } : null;
  if (m.t === "tune") {
    if (typeof m.file !== "string" || typeof m.path !== "string" || m.path.length > 80 || !finite(m.value)) return null;
    return { t: "tune", file: m.file, path: m.path, value: m.value };
  }

  if (m.t !== "input") return null;

  return sanitizeInput(m);
}

// Checks one input message from a client, whether it came as text or packed binary, and clamps what it can.
// Anything that is not what it should be becomes null and is dropped.
export function sanitizeInput(m: Record<string, unknown>): InputMessage | null {
  const numbers = [m.seq, m.moveX, m.moveY, m.aimYaw, m.aimPitch, m.targetX, m.targetY, m.targetZ];
  if (!numbers.every(finite)) return null;
  if (typeof m.run !== "boolean" || typeof m.jet !== "boolean" || typeof m.dash !== "boolean" || typeof m.fire !== "boolean" || typeof m.grenade !== "boolean" || typeof m.interact !== "boolean") return null;
  if (!Number.isInteger(m.seq) || (m.seq as number) < 1) return null;

  const lagMs = finite(m.lagMs) ? clamp(m.lagMs, 0, 1000) : undefined;
  const watchId = Number.isInteger(m.watchId) && (m.watchId as number) >= 0 ? (m.watchId as number) : undefined;
  return {
    t: "input",
    lagMs,
    watchId,
    seq: m.seq as number,
    moveX: clamp(m.moveX as number, -1, 1),
    moveY: clamp(m.moveY as number, -1, 1),
    aimYaw: m.aimYaw as number,
    aimPitch: clamp(m.aimPitch as number, -Math.PI / 2, Math.PI / 2),
    run: m.run,
    jet: m.jet,
    dash: m.dash,
    fire: m.fire,
    grenade: m.grenade,
    slot: m.slot === 1 ? 1 : 0,
    interact: m.interact,
    repair: m.repair === true,
    ability: m.ability === true,
    targetX: m.targetX as number,
    targetY: m.targetY as number,
    targetZ: m.targetZ as number,
  };
}

export function toMechInput(message: InputMessage, out: MechInput): void {
  out.moveX = message.moveX;
  out.moveY = message.moveY;
  out.aimYaw = message.aimYaw;
  out.aimPitch = message.aimPitch;
  out.run = message.run;
  out.jet = message.jet;
  out.dash = message.dash;
  out.fire = message.fire;
  out.grenade = message.grenade;
  out.slot = message.slot;
  out.interact = message.interact;
  out.repair = message.repair;
  out.ability = message.ability;
  out.targetX = message.targetX;
  out.targetY = message.targetY;
  out.targetZ = message.targetZ;
}
