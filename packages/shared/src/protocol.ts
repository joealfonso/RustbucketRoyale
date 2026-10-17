import type { MechInput } from "./MechInput";

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
  targetX: number;
  targetY: number;
  targetZ: number;
}

export type ClientMessage = InputMessage;

// The full state a client needs to rewind and replay its own mech.
export interface SelfState {
  x: number; y: number; z: number;
  vx: number; vz: number; vy: number;
  bodyYaw: number;
  grounded: boolean; running: boolean; jetting: boolean;
  dashTime: number; dashCooldown: number; dashX: number; dashZ: number;
  fuel: number; fuelLocked: boolean; fuelTimer: number;
  stamina: number; staminaLocked: boolean; staminaTimer: number;
}

// All a client needs to draw somebody else.
export interface OtherState {
  id: number;
  x: number; y: number; z: number;
  yaw: number;
  running: boolean;
  jetting: boolean;
  dead: boolean;
  hp: number[]; // legs, arms, torso
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

export type ServerMessage =
  | { t: "welcome"; id: number }
  | { t: "full" }
  | { t: "snapshot"; tick: number; ack: number; you: SelfState; health: HealthState; others: OtherState[] }
  | ShotMessage
  | HitMessage
  | GrenadeMessage
  | ExplodeMessage;

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

  if (m.t !== "input") return null;

  const numbers = [m.seq, m.moveX, m.moveY, m.aimYaw, m.aimPitch, m.targetX, m.targetY, m.targetZ];
  if (!numbers.every(finite)) return null;
  if (typeof m.run !== "boolean" || typeof m.jet !== "boolean" || typeof m.dash !== "boolean" || typeof m.fire !== "boolean" || typeof m.grenade !== "boolean") return null;
  if (!Number.isInteger(m.seq) || (m.seq as number) < 1) return null;

  return {
    t: "input",
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
  out.targetX = message.targetX;
  out.targetY = message.targetY;
  out.targetZ = message.targetZ;
}
