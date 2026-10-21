import type { BotDifficulty } from "./botDifficulty";
import type { MatchState } from "./match";
import type { MechInput } from "./MechInput";
import type { SupplyDrop } from "./drops";
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
  altFire: boolean;
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

// How a mech was knocked out, for the knockout card (gate 14c). `causes` are the last two different things that hurt
// it, newest last, each an id the client turns into words: "weapon:<weapons.json id>", "ability:<abilities.json kind>"
// (ram, pounce, barrage, decoy, rail), "grenade", "barrel", "ring", "drop" (a supply drop landing), or "titan:stomp" /
// "titan:car" (the Junk Titan, gate 13c; killerMech -1).
// `killerMech` is the killer's roster mech, -1 for none (the ring) or unknown.
export interface KnockoutHow {
  killerMech: number;
  killerBot: boolean;
  causes: string[];
}

// The Junk Titan (gate 13c), the roaming scrap boss on medium and large maps, as far as a client near it needs to draw
// it: where it stands and faces, how much of it is left (0 to 1 of its full hit points) and what it is doing, with how
// far into that it is, so the stomp and throw animations line up with the server's.
export type TitanAction = "walk" | "stomp" | "throw" | "roar" | "down";
export interface TitanState {
  x: number; y: number; z: number;
  yaw: number;
  hp: number; // share of full, 0 to 1
  action: TitanAction;
  actionSeconds: number;
}

// A Titan moment worth an effect, sent to everyone near it: a stomp landing (radius), a car thrown (from x, y, z at
// vx, vy, vz; the server and every client fly it the same way, like a grenade), a thrown car landing, the Titan falling.
export interface TitanMessage {
  t: "titan";
  event: "stomp" | "throw" | "land" | "fall";
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  radius?: number;
}

// A fun number from the match for the results screen (gate 14c): who did the most of something. Only stats someone
// actually scored are sent. `value` is a count, or metres for the distance ones.
export type MatchStatKind = "treesFelled" | "barrelsSetOff" | "longestPounce" | "longestRailShot" | "propsSmashed" | "mostDamage" | "titanDamage";
export interface MatchStat {
  kind: MatchStatKind;
  playerId: number;
  value: number;
}

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
  speedScale: number;
  dropPhase: number; dropTime: number; // the drop-in (drop.ts): phase 0 down, 1 hanging, 2 ball, 3 braking; landing stun left
  heat: number; overheat: number; windup: number; charge: number; // your secondary fire (altFire.ts AltFireState)
  pinTime: number; pinSpeed: number; // pinned by a full charge spike: seconds left, share of speed kept
  pullTime: number; pullVx: number; pullVy: number; pullVz: number; // a harpoon yank or reel in progress (mechStep.ts startPull)
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
  dropPhase: number; // the drop-in (drop.ts): 0 down, 1 hanging, 2 ball, 3 braking, for drawing the drop
  bot: boolean;
  hp: number[]; // legs, arms, torso
  weapon: number; // index of the weapon in hand, for drawing the right gun
  armor: number[]; // plate points left on legs, arms, torso, for drawing plates
  upgrades: number[]; // the two upgrades fitted, -1 for none, for drawing the parts bolted on
  mech: number; // which roster mech to draw, and whose hit boxes the crosshair checks
  ability: boolean; // using its ability right now (ramming, or in the air on a pounce)
  pinned: boolean; // held by a full charge spike
  overheated: boolean; // its windup gun is venting
  spin: number; // 0 to 1: its windup gun's spin, or its spike's charge, so the barrel is seen and heard winding up
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
  alt?: number; // a secondary shot: its damage share, 0 to 1 (1 for a slug or a full charge). Left out for a primary
  pierce?: boolean; // a full charge spike, passing through
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

// Sent to the victim only: where it was hit, for the dots on its damage diagram. x and y are the hit point in the
// victim's own frame (metres right of and up from its feet, as toMechFrame gives them), to the centimetre. zone is -1
// for splash (blasts, rams, stomps), which hit several zones at once: x, y is then where it came from. kind is
// HURT_PLATE, HURT_HULL or HURT_BROKEN (zones.ts); for splash, the worst of the zones it hurt.
export interface HurtMessage {
  t: "hurt";
  zone: number;
  x: number; y: number;
  kind: number;
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
  rivet?: number; // a rivet popping (gate 18b): its id from the rivet stick message. Its radius is in weapons.json
}

// A rivet (gate 18b). "stick": it landed and will pop in `fuse` seconds; x, y, z is where, nudged a little off the
// surface. On the world it carries the surface normal; riding a mech, `on` is the mech's id and lx, ly, lz the offset
// from its feet in its own frame, turned by its body yaw like muzzles: world x = mx + cos(yaw)*lx + sin(yaw)*lz,
// y = my + ly, z = mz - sin(yaw)*lx + cos(yaw)*lz. "detonate": its owner pressed right-click (id 0, x, y, z the
// owner's mech); each rivet that pops then comes as an explode message with its id.
export interface RivetMessage {
  t: "rivet";
  event: "stick" | "detonate";
  owner: number;
  id: number;
  x: number; y: number; z: number;
  nx?: number; ny?: number; nz?: number;
  on?: number;
  lx?: number; ly?: number; lz?: number;
  fuse?: number;
}

// A harpoon landing (gate 18b), sent when it gets there (a shot message went when it was fired). `id` is the shooter,
// `reel` true for a right-click reel. `hit` is what it struck at x, y, z; `target` is that mech's, pickup's or prop's
// id. `seconds` is how long the pull lasts (the yank on a mech, the reel on the shooter, a pickup's slide); with none
// the line lets go at once. `loot` is the pickup id of a smashed crate's loot, sliding toward the shooter.
export interface HarpoonMessage {
  t: "harpoon";
  id: number;
  reel: boolean;
  hit: "mech" | "pickup" | "prop" | "world" | "none";
  target?: number;
  x: number; y: number; z: number;
  seconds?: number;
  loot?: number;
}

// A moment of somebody's ability worth showing: a ram, leap, strike or decoys starting, a ram connecting, a pounce
// landing, a decoy shot and bursting. A barrage start is at the target point, where the warning goes, not the mech.
export interface AbilityMessage {
  t: "ability";
  id: number;
  kind: "ram" | "pounce" | "barrage" | "decoy" | "rail";
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
  // `rejoin` is this player's secret for getting their mech back after the connection drops (Room.rejoin).
  | { t: "welcome"; id: number; code: string; seed: number; tier: string; tuning: boolean; rejoin: string }
  | { t: "tuned"; file: string; path: string; value: number } // a number in a data file changed for this room
  | {
      t: "room"; code: string; tier: string; state: MatchState; seed: number; hostId: number;
      players: number; ring: RingSchedule | null; matchSeconds: number;
      drops: SupplyDrop[] | null; // this match's supply drops, planned with the ring
      difficulty: BotDifficulty; // so someone who joined by code also sees how hard the bots are
    }
  | { t: "eliminated"; id: number; killerId: number | null; place: number; alive: number; left?: boolean; how?: KnockoutHow } // left: their connection closed
  | { t: "result"; winnerId: number | null; stats?: MatchStat[] }
  | TitanMessage
  | { t: "refused"; reason: string; rejoinFailed?: boolean } // rejoinFailed: too late, join the room afresh
  | { t: "notice"; text: string } // a line for the feed from the server itself, such as a restart
  | { t: "prop"; id: number } // a prop was destroyed
  | { t: "props"; destroyed: number[] } // every prop destroyed so far, sent to someone arriving mid way
  | { t: "snapshot"; tick: number; ack: number; ackAgeMs: number; you: SelfState; health: HealthState; match: MatchProgress; others: OtherState[]; noises: NoiseEvent[]; loadout: Loadout; looting: number; repairing: number; pickups: PickupState[] | null; titan?: TitanState | null } // pickups null: unchanged since the last snapshot; titan null: none near you
  | ShotMessage
  | HitMessage
  | HurtMessage
  | GrenadeMessage
  | ExplodeMessage
  | RivetMessage
  | HarpoonMessage
  | AbilityMessage;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Never trust a client. Anything malformed becomes null and is dropped, numbers are clamped into range.
// The first message on a connection opened with `?rejoin` in its address: who you were and your secret. It travels
// as a message, never in the address, because proxies log addresses.
export interface RejoinMessage {
  t: "rejoin";
  id: number;
  token: string;
}

export function parseRejoin(raw: string): RejoinMessage | null {
  try {
    const d = JSON.parse(raw) as Partial<RejoinMessage>;
    if (d?.t !== "rejoin" || !Number.isInteger(d.id) || typeof d.token !== "string" || !/^[0-9a-f]{32}$/.test(d.token)) return null;
    return { t: "rejoin", id: d.id!, token: d.token };
  } catch {
    return null;
  }
}

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
    altFire: m.altFire === true,
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
  out.altFire = message.altFire;
  out.grenade = message.grenade;
  out.slot = message.slot;
  out.interact = message.interact;
  out.repair = message.repair;
  out.ability = message.ability;
  out.targetX = message.targetX;
  out.targetY = message.targetY;
  out.targetZ = message.targetZ;
}
