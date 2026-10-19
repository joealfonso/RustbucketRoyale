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

// Your own state: 20 float32s, but most do not change from one snapshot to the next (timers at 0, full fuel and
// stamina, the fuel scale, the facing while standing). A 3-byte mask says which are sent; one left out is the same
// float as last time (0 for a fresh memory), so prediction replays from exactly the numbers the server has. Then one
// byte of flags.
const SELF_FLOATS = 20;
const SELF_MASK_BYTES = 3;
// Another mech: id, a byte saying what follows, its flags, its position, its yaw, then its details (hit points,
// weapon, armour, upgrades). Once a client has been sent a mech, the position goes as the change since last time,
// 1 byte an axis, and the details only when one changes, so a mech in view usually costs 9 bytes instead of 21.
const OTHER_HEAD_BYTES = 2 + 1 + 1;
const POSITION_BYTES = 6;
const POSITION_DELTA_BYTES = 3;
const YAW_BYTES = 2;
const DETAIL_BYTES = 9;
const OTHER_BYTES = OTHER_HEAD_BYTES + POSITION_BYTES + YAW_BYTES + DETAIL_BYTES;
const ABILITY_BIT = 1;
const DELTA_BIT = 2;
const DETAILS_BIT = 4;
const LOADOUT_BYTES = 9;
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

interface OtherMemory {
  x: number; // position in whole steps, as sent
  y: number;
  z: number;
  details: number[]; // the detail bytes, as sent
}

// What one connection was last sent about each mech in view. WebSocket messages arrive whole and in order, so the
// server keeps one per connection to write snapshots against and the client keeps one to read them. A mech that
// leaves view is forgotten on both sides, so it comes back in full. A fresh memory per call gives full snapshots.
export class SnapshotMemory {
  self = new Float32Array(SELF_FLOATS);
  others = new Map<number, OtherMemory>();
}

const fitsByte = (n: number) => n >= -128 && n <= 127;

// ---- snapshot

// `selfFloats` is how many of your own numbers are not 0.
export function snapshotSize(others: number, noises = 0, pickups = 0, selfFloats = SELF_FLOATS): number {
  return SNAPSHOT_HEADER_BYTES + SELF_MASK_BYTES + selfFloats * 4 + 1 + 1 + others * OTHER_BYTES + 1 + noises * NOISE_BYTES + LOADOUT_BYTES + LOOTING_BYTES + 1 + pickups * PICKUP_BYTES;
}

export function encodeSnapshot(m: Extract<ServerMessage, { t: "snapshot" }>, memory = new SnapshotMemory()): Uint8Array {
  const others = m.others.slice(0, 255);
  const noises = m.noises.slice(0, 255);
  const pickups = m.pickups?.slice(0, PICKUPS_UNCHANGED - 1) ?? [];
  const s = m.you;
  const selfNumbers = [s.x, s.y, s.z, s.vx, s.vz, s.vy, s.bodyYaw, s.dashTime, s.dashCooldown, s.dashX, s.dashZ, s.abilityTime, s.abilityCooldown, s.abilityX, s.abilityZ, s.fuel, s.fuelTimer, s.stamina, s.staminaTimer, s.fuelScale];
  let mask = 0, present = 0;
  selfNumbers.forEach((n, i) => { if (!Object.is(Math.fround(n), memory.self[i])) { mask |= 1 << i; present++; } });

  // Each other mech against what this connection was last sent about it.
  const seen = new Map<number, OtherMemory>();
  const kinds: number[] = [];
  let otherBytes = 0;
  for (const other of others) {
    const now: OtherMemory = {
      x: Math.round(other.x / POSITION_STEP), y: Math.round(other.y / HEIGHT_STEP), z: Math.round(other.z / POSITION_STEP),
      details: [
        u8(other.hp[0] ?? 0), u8(other.hp[1] ?? 0), u8(other.hp[2] ?? 0), u8(other.weapon),
        u8(other.armor[0] ?? 0), u8(other.armor[1] ?? 0), u8(other.armor[2] ?? 0),
        (other.upgrades[0] ?? -1) < 0 ? EMPTY_SLOT : other.upgrades[0]!, (other.upgrades[1] ?? -1) < 0 ? EMPTY_SLOT : other.upgrades[1]!,
      ],
    };
    const was = memory.others.get(other.id);
    const delta = was !== undefined && fitsByte(now.x - was.x) && fitsByte(now.y - was.y) && fitsByte(now.z - was.z);
    const details = was === undefined || now.details.some((b, i) => b !== was.details[i]);
    kinds.push((other.ability ? ABILITY_BIT : 0) | (delta ? DELTA_BIT : 0) | (details ? DETAILS_BIT : 0));
    otherBytes += OTHER_HEAD_BYTES + (delta ? POSITION_DELTA_BYTES : POSITION_BYTES) + YAW_BYTES + (details ? DETAIL_BYTES : 0);
    seen.set(other.id, now);
  }

  const buffer = new ArrayBuffer(snapshotSize(0, noises.length, pickups.length, present) + otherBytes);
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

  for (let i = 0; i < SELF_MASK_BYTES; i++) { v.setUint8(o, (mask >> (i * 8)) & 255); o += 1; }
  selfNumbers.forEach((n, i) => { if (mask & (1 << i)) { v.setFloat32(o, n, true); o += 4; } });
  memory.self.set(selfNumbers);
  v.setUint8(o, (s.grounded ? 1 : 0) | (s.running ? 2 : 0) | (s.jetting ? 4 : 0) | (s.fuelLocked ? 8 : 0) | (s.staminaLocked ? 16 : 0) | (s.crawling ? 32 : 0) | ((s.mech & 3) << 6)); o += 1;

  v.setUint8(o, others.length); o += 1;
  others.forEach((other, i) => {
    const kind = kinds[i]!, now = seen.get(other.id)!, was = memory.others.get(other.id);
    v.setUint16(o, other.id, true); o += 2;
    v.setUint8(o, kind); o += 1;
    v.setUint8(o, (other.running ? 1 : 0) | (other.jetting ? 2 : 0) | (other.dead ? 4 : 0) | (other.bot ? 8 : 0) | (other.looted ? 16 : 0) | (other.repairing ? 32 : 0) | ((other.mech & 3) << 6)); o += 1;
    if (kind & DELTA_BIT) {
      v.setInt8(o, now.x - was!.x); v.setInt8(o + 1, now.y - was!.y); v.setInt8(o + 2, now.z - was!.z); o += POSITION_DELTA_BYTES;
    } else {
      v.setInt16(o, now.x, true); v.setInt16(o + 2, now.y, true); v.setInt16(o + 4, now.z, true); o += POSITION_BYTES;
    }
    const turns = ((other.yaw % TWO_PI) + TWO_PI) % TWO_PI;
    v.setUint16(o, Math.round((turns / TWO_PI) * 65535), true); o += 2;
    if (kind & DETAILS_BIT) for (const b of now.details) { v.setUint8(o, b); o += 1; }
  });
  memory.others = seen;
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
  v.setUint8(o, l.upgrades[0] < 0 ? EMPTY_SLOT : l.upgrades[0]); o += 1;
  v.setUint8(o, l.upgrades[1] < 0 ? EMPTY_SLOT : l.upgrades[1]); o += 1;
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

export function decodeSnapshot(bytes: Uint8Array, memory = new SnapshotMemory()): Extract<ServerMessage, { t: "snapshot" }> | null {
  if (bytes.length < snapshotSize(0, 0, 0, 0)) return null;
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

  const mask = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); o += SELF_MASK_BYTES;
  let present = 0;
  for (let i = 0; i < SELF_FLOATS; i++) if (mask & (1 << i)) present++;
  if (bytes.length < snapshotSize(0, 0, 0, present)) return null;
  let field = 0;
  const f = () => { const i = field++; if (!(mask & (1 << i))) return memory.self[i]!; const n = v.getFloat32(o, true); o += 4; return n; };
  const you: SelfState = {
    x: f(), y: f(), z: f(), vx: f(), vz: f(), vy: f(), bodyYaw: f(), dashTime: f(), dashCooldown: f(), dashX: f(), dashZ: f(),
    abilityTime: f(), abilityCooldown: f(), abilityX: f(), abilityZ: f(),
    fuel: f(), fuelTimer: f(), stamina: f(), staminaTimer: f(), fuelScale: f(), mech: 0,
    grounded: false, running: false, jetting: false, crawling: false, fuelLocked: false, staminaLocked: false,
  };
  const selfOrder = [you.x, you.y, you.z, you.vx, you.vz, you.vy, you.bodyYaw, you.dashTime, you.dashCooldown, you.dashX, you.dashZ, you.abilityTime, you.abilityCooldown, you.abilityX, you.abilityZ, you.fuel, you.fuelTimer, you.stamina, you.staminaTimer, you.fuelScale];
  const flags = v.getUint8(o); o += 1;
  you.grounded = (flags & 1) !== 0; you.running = (flags & 2) !== 0; you.jetting = (flags & 4) !== 0;
  you.fuelLocked = (flags & 8) !== 0; you.staminaLocked = (flags & 16) !== 0; you.crawling = (flags & 32) !== 0;
  you.mech = flags >> 6;

  const slot = (n: number) => (n === EMPTY_SLOT ? -1 : n);
  const count = v.getUint8(o); o += 1;
  // Read into a new memory, and keep it only once the whole snapshot has read cleanly.
  const seen = new Map<number, OtherMemory>();
  const others: OtherState[] = [];
  for (let i = 0; i < count; i++) {
    if (bytes.length < o + OTHER_HEAD_BYTES) return null;
    const id = v.getUint16(o, true);
    const kind = v.getUint8(o + 2);
    const bits = v.getUint8(o + 3);
    o += OTHER_HEAD_BYTES;
    const delta = (kind & DELTA_BIT) !== 0, hasDetails = (kind & DETAILS_BIT) !== 0;
    const was = memory.others.get(id);
    if (!was && (delta || !hasDetails)) return null; // a change from something this connection was never sent
    if (bytes.length < o + (delta ? POSITION_DELTA_BYTES : POSITION_BYTES) + YAW_BYTES + (hasDetails ? DETAIL_BYTES : 0)) return null;
    let qx: number, qy: number, qz: number;
    if (delta) { qx = was!.x + v.getInt8(o); qy = was!.y + v.getInt8(o + 1); qz = was!.z + v.getInt8(o + 2); o += POSITION_DELTA_BYTES; }
    else { qx = v.getInt16(o, true); qy = v.getInt16(o + 2, true); qz = v.getInt16(o + 4, true); o += POSITION_BYTES; }
    const yaw = (v.getUint16(o, true) / 65535) * TWO_PI; o += YAW_BYTES;
    let d = was?.details;
    if (hasDetails) { d = Array.from(bytes.subarray(o, o + DETAIL_BYTES)); o += DETAIL_BYTES; }
    seen.set(id, { x: qx, y: qy, z: qz, details: d! });
    others.push({
      id, x: qx * POSITION_STEP, y: qy * HEIGHT_STEP, z: qz * POSITION_STEP, yaw,
      running: (bits & 1) !== 0, jetting: (bits & 2) !== 0, dead: (bits & 4) !== 0, looted: (bits & 16) !== 0, repairing: (bits & 32) !== 0, bot: (bits & 8) !== 0,
      hp: [d![0]!, d![1]!, d![2]!], weapon: d![3]!, armor: [d![4]!, d![5]!, d![6]!], upgrades: [slot(d![7]!), slot(d![8]!)], mech: bits >> 6, ability: (kind & ABILITY_BIT) !== 0,
    });
  }
  if (bytes.length < o + 1) return null;
  const noiseCount = v.getUint8(o); o += 1;
  if (bytes.length < o + noiseCount * NOISE_BYTES + LOADOUT_BYTES + LOOTING_BYTES + 1) return null;
  const noises: NoiseEvent[] = [];
  for (let i = 0; i < noiseCount; i++) {
    noises.push({ x: v.getInt16(o, true) * NOISE_STEP, z: v.getInt16(o + 2, true) * NOISE_STEP, kind: v.getUint8(o + 4) });
    o += NOISE_BYTES;
  }
  const loadout: Loadout = {
    slots: [slot(v.getUint8(o)), slot(v.getUint8(o + 1))], active: v.getUint8(o + 2), grenades: v.getUint8(o + 3),
    armor: [v.getUint8(o + 4), v.getUint8(o + 5), v.getUint8(o + 6)],
    upgrades: [slot(v.getUint8(o + 7)), slot(v.getUint8(o + 8))],
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
  memory.others = seen;
  for (let i = 0; i < SELF_FLOATS; i++) memory.self[i] = selfOrder[i]!;
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

// A pounce lands on the aim point, so the target goes along whenever the ability key is down, whatever the caller says.
export function encodeInput(m: InputMessage, shooting: boolean): Uint8Array {
  const hasTarget = shooting || m.ability;
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
  v.setUint8(o, (m.interact ? 1 : 0) | (m.slot === 1 ? 2 : 0) | (m.repair ? 4 : 0) | (m.ability ? 8 : 0)); o += 1;
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
    interact: (flags2 & 1) !== 0, slot: (flags2 & 2) !== 0 ? 1 : 0, repair: (flags2 & 4) !== 0, ability: (flags2 & 8) !== 0,
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
// `memory` is the connection's (SnapshotMemory); without one every snapshot goes in full.
export function encodeServerBinary(m: ServerMessage, memory?: SnapshotMemory): Uint8Array | null {
  if (m.t === "snapshot") return encodeSnapshot(m, memory);
  if (m.t === "shot") return encodeShot(m);
  return null;
}

export function decodeServerBinary(bytes: Uint8Array, memory?: SnapshotMemory): ServerMessage | null {
  if (bytes[0] === TYPE_SNAPSHOT) return decodeSnapshot(bytes, memory);
  if (bytes[0] === TYPE_SHOT) return decodeShot(bytes);
  return null;
}
