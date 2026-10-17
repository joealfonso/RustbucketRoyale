import { sanitizeInput, type InputMessage, type Loadout, type NoiseEvent, type OtherState, type PickupState, type SelfState, type ServerMessage, type ShotMessage } from "./protocol";
import type { MatchState } from "./match";

// Packed binary forms of the three messages that make up nearly all the traffic: a client's input,
// a snapshot, and a shot. Everything else stays readable text, because it is rare.
// All numbers are little endian. Positions of other mechs are rounded to 10 cm sideways and 5 cm up, which is
// finer than anything visible at the distances they are drawn, and your own state keeps full float precision so
// the client's replay of its own movement still lines up with the server.
const TYPE_SNAPSHOT = 1;
const TYPE_SHOT = 2;
const TYPE_INPUT = 3;

const MATCH_STATES: MatchState[] = ["lobby", "countdown", "active", "results"];
const TWO_PI = Math.PI * 2;

const POSITION_STEP = 0.1; // metres, for x and z
const HEIGHT_STEP = 0.05; // metres, for y

export const isBinaryType = (first: number) => first === TYPE_SNAPSHOT || first === TYPE_SHOT || first === TYPE_INPUT;

// ---- sizes

const SELF_BYTES = 15 * 4 + 1;
const OTHER_BYTES = 18;
const LOADOUT_BYTES = 7;
const LOOTING_BYTES = 2; // how far through looting a wreck, then through a repair, 0 to 255 each
const PICKUP_BYTES = 9;
const NOISE_BYTES = 5;
const NOISE_STEP = 0.5; // metres: noises are shown fuzzy anyway
const SNAPSHOT_HEADER_BYTES = 23;
const SHOT_BYTES = 24;
const INPUT_BASE_BYTES = 1 + 4 + 1 + 1 + 1 + 1 + 4 + 4;
const EMPTY_SLOT = 255;
const PICKUPS_UNCHANGED = 255; // in place of the pickup count: keep the list from the last snapshot

const u8 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

// ---- snapshot

export function snapshotSize(others: number, noises = 0, pickups = 0): number {
  return SNAPSHOT_HEADER_BYTES + SELF_BYTES + 1 + others * OTHER_BYTES + 1 + noises * NOISE_BYTES + LOADOUT_BYTES + LOOTING_BYTES + 1 + pickups * PICKUP_BYTES;
}

export function encodeSnapshot(m: Extract<ServerMessage, { t: "snapshot" }>): Uint8Array {
  const others = m.others.slice(0, 255);
  const noises = m.noises.slice(0, 255);
  const pickups = m.pickups?.slice(0, PICKUPS_UNCHANGED - 1) ?? [];
  const buffer = new ArrayBuffer(snapshotSize(others.length, noises.length, pickups.length));
  const v = new DataView(buffer);
  let o = 0;
  v.setUint8(o, TYPE_SNAPSHOT); o += 1;
  v.setUint32(o, m.tick, true); o += 4;
  v.setUint32(o, m.ack, true); o += 4;
  v.setUint16(o, Math.max(0, Math.min(65535, Math.round(m.ackAgeMs))), true); o += 2;
  v.setUint8(o, MATCH_STATES.indexOf(m.match.state)); o += 1;
  v.setFloat32(o, m.match.seconds, true); o += 4;
  v.setUint8(o, u8(m.match.alive)); o += 1;
  v.setUint8(o, u8(m.match.total)); o += 1;
  for (let i = 0; i < 3; i++) { v.setUint8(o, u8(m.health.hp[i] ?? 0)); o += 1; }
  v.setUint8(o, m.health.dead ? 1 : 0); o += 1;
  v.setUint8(o, u8(Math.ceil(m.health.respawnIn))); o += 1;

  const s = m.you;
  for (const n of [s.x, s.y, s.z, s.vx, s.vz, s.vy, s.bodyYaw, s.dashTime, s.dashCooldown, s.dashX, s.dashZ, s.fuel, s.fuelTimer, s.stamina, s.staminaTimer]) {
    v.setFloat32(o, n, true); o += 4;
  }
  v.setUint8(o, (s.grounded ? 1 : 0) | (s.running ? 2 : 0) | (s.jetting ? 4 : 0) | (s.fuelLocked ? 8 : 0) | (s.staminaLocked ? 16 : 0) | (s.crawling ? 32 : 0)); o += 1;

  v.setUint8(o, others.length); o += 1;
  for (const other of others) {
    v.setUint16(o, other.id, true); o += 2;
    v.setInt16(o, Math.round(other.x / POSITION_STEP), true); o += 2;
    v.setInt16(o, Math.round(other.y / HEIGHT_STEP), true); o += 2;
    v.setInt16(o, Math.round(other.z / POSITION_STEP), true); o += 2;
    const turns = ((other.yaw % TWO_PI) + TWO_PI) % TWO_PI;
    v.setUint16(o, Math.round((turns / TWO_PI) * 65535), true); o += 2;
    v.setUint8(o, (other.running ? 1 : 0) | (other.jetting ? 2 : 0) | (other.dead ? 4 : 0) | (other.bot ? 8 : 0) | (other.looted ? 16 : 0) | (other.repairing ? 32 : 0)); o += 1;
    for (let i = 0; i < 3; i++) { v.setUint8(o, u8(other.hp[i] ?? 0)); o += 1; }
    v.setUint8(o, u8(other.weapon)); o += 1;
    for (let i = 0; i < 3; i++) { v.setUint8(o, u8(other.armor[i] ?? 0)); o += 1; }
  }
  v.setUint8(o, noises.length); o += 1;
  for (const n of noises) {
    v.setInt16(o, Math.round(n.x / NOISE_STEP), true); o += 2;
    v.setInt16(o, Math.round(n.z / NOISE_STEP), true); o += 2;
    v.setUint8(o, n.kind); o += 1;
  }
  const l = m.loadout;
  v.setUint8(o, l.slots[0] < 0 ? EMPTY_SLOT : l.slots[0]); o += 1;
  v.setUint8(o, l.slots[1] < 0 ? EMPTY_SLOT : l.slots[1]); o += 1;
  v.setUint8(o, l.active); o += 1;
  v.setUint8(o, u8(l.grenades)); o += 1;
  for (let i = 0; i < 3; i++) { v.setUint8(o, u8(l.armor[i] ?? 0)); o += 1; }
  v.setUint8(o, u8(Math.max(0, Math.min(1, m.looting)) * 255)); o += 1;
  v.setUint8(o, u8(Math.max(0, Math.min(1, m.repairing)) * 255)); o += 1;
  v.setUint8(o, m.pickups === null ? PICKUPS_UNCHANGED : pickups.length); o += 1;
  for (const p of pickups) {
    v.setUint16(o, p.id & 0xffff, true); o += 2;
    v.setUint8(o, p.item); o += 1;
    v.setInt16(o, Math.round(p.x / POSITION_STEP), true); o += 2;
    v.setInt16(o, Math.round(p.y / HEIGHT_STEP), true); o += 2;
    v.setInt16(o, Math.round(p.z / POSITION_STEP), true); o += 2;
  }
  return new Uint8Array(buffer);
}

export function decodeSnapshot(bytes: Uint8Array): Extract<ServerMessage, { t: "snapshot" }> | null {
  if (bytes.length < SNAPSHOT_HEADER_BYTES + SELF_BYTES + 1) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 1;
  const tick = v.getUint32(o, true); o += 4;
  const ack = v.getUint32(o, true); o += 4;
  const ackAgeMs = v.getUint16(o, true); o += 2;
  const state = MATCH_STATES[v.getUint8(o)]; o += 1;
  if (!state) return null;
  const seconds = v.getFloat32(o, true); o += 4;
  const alive = v.getUint8(o); o += 1;
  const total = v.getUint8(o); o += 1;
  const hp = [v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2)]; o += 3;
  const dead = v.getUint8(o) === 1; o += 1;
  const respawnIn = v.getUint8(o); o += 1;

  const f = () => { const n = v.getFloat32(o, true); o += 4; return n; };
  const you: SelfState = {
    x: f(), y: f(), z: f(), vx: f(), vz: f(), vy: f(), bodyYaw: f(), dashTime: f(), dashCooldown: f(), dashX: f(), dashZ: f(),
    fuel: f(), fuelTimer: f(), stamina: f(), staminaTimer: f(),
    grounded: false, running: false, jetting: false, crawling: false, fuelLocked: false, staminaLocked: false,
  };
  const flags = v.getUint8(o); o += 1;
  you.grounded = (flags & 1) !== 0; you.running = (flags & 2) !== 0; you.jetting = (flags & 4) !== 0;
  you.fuelLocked = (flags & 8) !== 0; you.staminaLocked = (flags & 16) !== 0; you.crawling = (flags & 32) !== 0;

  const count = v.getUint8(o); o += 1;
  if (bytes.length < o + count * OTHER_BYTES + 1) return null;
  const others: OtherState[] = [];
  for (let i = 0; i < count; i++) {
    const id = v.getUint16(o, true); o += 2;
    const x = v.getInt16(o, true) * POSITION_STEP; o += 2;
    const y = v.getInt16(o, true) * HEIGHT_STEP; o += 2;
    const z = v.getInt16(o, true) * POSITION_STEP; o += 2;
    const yaw = (v.getUint16(o, true) / 65535) * TWO_PI; o += 2;
    const bits = v.getUint8(o); o += 1;
    const ohp = [v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2)]; o += 3;
    const weapon = v.getUint8(o); o += 1;
    const armor = [v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2)]; o += 3;
    others.push({ id, x, y, z, yaw, running: (bits & 1) !== 0, jetting: (bits & 2) !== 0, dead: (bits & 4) !== 0, looted: (bits & 16) !== 0, repairing: (bits & 32) !== 0, bot: (bits & 8) !== 0, hp: ohp, weapon, armor });
  }
  const noiseCount = v.getUint8(o); o += 1;
  if (bytes.length < o + noiseCount * NOISE_BYTES + LOADOUT_BYTES + LOOTING_BYTES + 1) return null;
  const noises: NoiseEvent[] = [];
  for (let i = 0; i < noiseCount; i++) {
    noises.push({ x: v.getInt16(o, true) * NOISE_STEP, z: v.getInt16(o + 2, true) * NOISE_STEP, kind: v.getUint8(o + 4) });
    o += NOISE_BYTES;
  }
  const slot = (n: number) => (n === EMPTY_SLOT ? -1 : n);
  const loadout: Loadout = {
    slots: [slot(v.getUint8(o)), slot(v.getUint8(o + 1))], active: v.getUint8(o + 2), grenades: v.getUint8(o + 3),
    armor: [v.getUint8(o + 4), v.getUint8(o + 5), v.getUint8(o + 6)],
  };
  o += LOADOUT_BYTES;
  const looting = v.getUint8(o) / 255;
  const repairing = v.getUint8(o + 1) / 255;
  o += LOOTING_BYTES;
  const countByte = v.getUint8(o); o += 1;
  const unchanged = countByte === PICKUPS_UNCHANGED;
  const pickupCount = unchanged ? 0 : countByte;
  if (bytes.length !== o + pickupCount * PICKUP_BYTES) return null;
  const pickups: PickupState[] = [];
  for (let i = 0; i < pickupCount; i++) {
    pickups.push({
      id: v.getUint16(o, true), item: v.getUint8(o + 2),
      x: v.getInt16(o + 3, true) * POSITION_STEP, y: v.getInt16(o + 5, true) * HEIGHT_STEP, z: v.getInt16(o + 7, true) * POSITION_STEP,
    });
    o += PICKUP_BYTES;
  }
  return { t: "snapshot", tick, ack, ackAgeMs, you, health: { hp, dead, respawnIn }, match: { state, seconds, alive, total }, others, noises, loadout, looting, repairing, pickups: unchanged ? null : pickups };
}

// ---- shot

export function encodeShot(m: ShotMessage): Uint8Array {
  const buffer = new ArrayBuffer(SHOT_BYTES);
  const v = new DataView(buffer);
  let o = 0;
  v.setUint8(o, TYPE_SHOT); o += 1;
  v.setUint16(o, m.id, true); o += 2;
  for (const n of [m.ox, m.oy, m.oz]) { v.setFloat32(o, n, true); o += 4; }
  for (const n of [m.dx, m.dy, m.dz]) { v.setInt16(o, Math.round(Math.max(-1, Math.min(1, n)) * 32767), true); o += 2; }
  v.setUint16(o, Math.max(0, Math.min(65535, Math.round(m.length * 100))), true); o += 2;
  v.setUint8(o, m.hitMech ? 1 : 0);
  return new Uint8Array(buffer);
}

export function decodeShot(bytes: Uint8Array): ShotMessage | null {
  if (bytes.length !== SHOT_BYTES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 1;
  const id = v.getUint16(o, true); o += 2;
  const ox = v.getFloat32(o, true), oy = v.getFloat32(o + 4, true), oz = v.getFloat32(o + 8, true); o += 12;
  let dx = v.getInt16(o, true) / 32767, dy = v.getInt16(o + 2, true) / 32767, dz = v.getInt16(o + 4, true) / 32767; o += 6;
  const n = Math.hypot(dx, dy, dz) || 1; // put back to exactly unit length after the rounding
  dx /= n; dy /= n; dz /= n;
  const length = v.getUint16(o, true) / 100; o += 2;
  const hitMech = v.getUint8(o) === 1;
  return { t: "shot", id, ox, oy, oz, dx, dy, dz, length, hitMech };
}

// ---- input

export function encodeInput(m: InputMessage, hasTarget: boolean): Uint8Array {
  const hasLag = m.lagMs !== undefined;
  const hasWatch = m.watchId !== undefined;
  const buffer = new ArrayBuffer(INPUT_BASE_BYTES + (hasTarget ? 12 : 0) + (hasLag ? 2 : 0) + (hasWatch ? 2 : 0));
  const v = new DataView(buffer);
  let o = 0;
  v.setUint8(o, TYPE_INPUT); o += 1;
  v.setUint32(o, m.seq, true); o += 4;
  v.setInt8(o, Math.round(m.moveX * 127)); o += 1;
  v.setInt8(o, Math.round(m.moveY * 127)); o += 1;
  v.setUint8(o, (m.run ? 1 : 0) | (m.jet ? 2 : 0) | (m.dash ? 4 : 0) | (m.fire ? 8 : 0) | (m.grenade ? 16 : 0) | (hasTarget ? 32 : 0) | (hasLag ? 64 : 0) | (hasWatch ? 128 : 0)); o += 1;
  v.setUint8(o, (m.interact ? 1 : 0) | (m.slot === 1 ? 2 : 0) | (m.repair ? 4 : 0)); o += 1;
  v.setFloat32(o, m.aimYaw, true); o += 4;
  v.setFloat32(o, m.aimPitch, true); o += 4;
  if (hasTarget) for (const n of [m.targetX, m.targetY, m.targetZ]) { v.setFloat32(o, n, true); o += 4; }
  if (hasLag) { v.setUint16(o, Math.max(0, Math.min(65535, Math.round(m.lagMs!))), true); o += 2; }
  if (hasWatch) v.setUint16(o, Math.max(0, Math.min(65535, m.watchId!)), true);
  return new Uint8Array(buffer);
}

// Reads a packed input from a client. The length must match exactly, and the result goes through the same
// checks as a text input, so a hand made packet cannot get anything past them.
export function decodeInput(bytes: Uint8Array): InputMessage | null {
  if (bytes.length < INPUT_BASE_BYTES || bytes[0] !== TYPE_INPUT) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = v.getUint8(7);
  const flags2 = v.getUint8(8);
  const hasTarget = (flags & 32) !== 0, hasLag = (flags & 64) !== 0, hasWatch = (flags & 128) !== 0;
  if (bytes.length !== INPUT_BASE_BYTES + (hasTarget ? 12 : 0) + (hasLag ? 2 : 0) + (hasWatch ? 2 : 0)) return null;

  let o = INPUT_BASE_BYTES;
  const record: Record<string, unknown> = {
    seq: v.getUint32(1, true), moveX: v.getInt8(5) / 127, moveY: v.getInt8(6) / 127,
    run: (flags & 1) !== 0, jet: (flags & 2) !== 0, dash: (flags & 4) !== 0, fire: (flags & 8) !== 0, grenade: (flags & 16) !== 0,
    interact: (flags2 & 1) !== 0, slot: (flags2 & 2) !== 0 ? 1 : 0, repair: (flags2 & 4) !== 0,
    aimYaw: v.getFloat32(9, true), aimPitch: v.getFloat32(13, true),
    targetX: 0, targetY: 0, targetZ: 0,
  };
  if (hasTarget) {
    record.targetX = v.getFloat32(o, true); record.targetY = v.getFloat32(o + 4, true); record.targetZ = v.getFloat32(o + 8, true); o += 12;
  }
  if (hasLag) { record.lagMs = v.getUint16(o, true); o += 2; }
  if (hasWatch) record.watchId = v.getUint16(o, true);
  return sanitizeInput(record);
}

// ---- both directions

// Packed form of a server message, or null when it is one of the readable ones.
export function encodeServerBinary(m: ServerMessage): Uint8Array | null {
  if (m.t === "snapshot") return encodeSnapshot(m);
  if (m.t === "shot") return encodeShot(m);
  return null;
}

export function decodeServerBinary(bytes: Uint8Array): ServerMessage | null {
  if (bytes[0] === TYPE_SNAPSHOT) return decodeSnapshot(bytes);
  if (bytes[0] === TYPE_SHOT) return decodeShot(bytes);
  return null;
}
