import * as THREE from "three";
import { STEP, raycastMech, type OtherState, type ZoneHit, type ZoneSet } from "@rustbucket/shared";
import { createMechModel, setMechDamage, setMechGear, setMechUpgrades, type MechModel } from "./mechModel";
import type { UpgradeDef } from "@rustbucket/shared";
import type { Toon } from "./toonMaterial";
import type { LoadedKit } from "./mechKit";
import type { AbilityFxConfig } from "./abilityFx";
import { makeGhost } from "./ghostLook";
import { castShadows } from "./sunShadows";
import { createDrawnMech, type DrawnMech } from "./replayFrames";

interface Sample {
  time: number;
  x: number; y: number; z: number; yaw: number;
}

interface Remote {
  id: number;
  model: MechModel;
  vx: number; vy: number; vz: number; // how fast it is moving where it is drawn, for its walk
  jetting: boolean;
  running: boolean;
  ability: boolean; // using its ability right now: ramming, or in the air on a pounce
  dropPhase: number; // the drop-in (drop.ts): 0 down, 1 riding, 2 diving, 3 braking
  mech: number; // the roster mech it is drawn as. A new one swaps the model.
  weapon: number; // the weapon in hand, by index in weapons.json, so its shots are drawn in that weapon's look
  dead: boolean;
  hp: number[]; // the newest hit points the server sent, so a replay can hand the mech back as it is now
  looted: boolean;
  bot: boolean;
  ghost: THREE.Material[] | null; // drawn see-through as one of your own decoys, with the material copies that took
  samples: Sample[];
  seen: boolean;
}

const MAX_SAMPLES = 12;
const OFFSET_WINDOW = 40; // snapshots to look back over when working out the fastest the network has been

// Other players, drawn a little in the past. Blending between two real snapshots looks smooth
// where chasing the newest one would stutter. Samples are placed on the server's own clock (the tick number),
// so a late packet does not jolt anyone, and the delay is one snapshot interval plus a small buffer that grows
// only as far as the connection's measured jitter requires. A clean connection sees others about 65 ms behind.
export class RemoteMechs {
  private remotes = new Map<number, Remote>();
  private arrivals: number[] = []; // recent (local arrival time - server time), the lowest is the best case
  private offset = 0;
  private jitter = 0;
  private hasClock = false;
  private ownDecoys = new Set<number>(); // ids of your own decoys, drawn see-through for you alone
  // While the kill replay plays it moves and damages the models from its recording; snapshots still arrive and are
  // kept, so everyone is back where they are now the moment it ends.
  private replaying = false;
  private drawn: DrawnMech;

  // The colour of each weapon by index, for drawing the gun in hand.
  weaponColors: string[] = [];
  upgrades: UpgradeDef[] = [];
  // The toon look and colours for other mechs. Without it they are drawn as plain grey boxes.
  look: { toon: Toon; accentFor: (id: number) => string; body: string; kitFor: (mech: number) => LoadedKit | null; trim: string } | null = null;
  // How your own decoys look to you. Without it they are drawn like anyone else.
  ghostLook: AbilityFxConfig["ghost"] | null = null;
  // A mech just knocked out, for the blow-apart (deathFx.ts). `alreadyDown`: it was a wreck when first seen, or came
  // back from a replay a wreck that the replay never showed going down, so it should lie there rather than blow up.
  onKnockedOut: ((id: number, model: MechModel, alreadyDown: boolean) => void) | null = null;
  // A mech's drop-in moved on a phase (drop.ts), as the server saw it, at the spot it was then: the retro burn
  // lighting, or touching down (to 0). Not called for a mech first seen mid drop.
  onDropPhase: ((model: MechModel, from: number, to: number, x: number, y: number, z: number) => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private bufferMs: number,
    private maxDelayMs: number,
    private snapshotIntervalMs: number,
    private zoneMaxHp: readonly number[],
  ) {
    this.drawn = createDrawnMech(zoneMaxHp.length);
  }

  // How far behind the server the picture of other mechs is right now, in ms. Shots are rewound by this much plus the ping.
  get viewDelayMs(): number {
    return Math.min(this.maxDelayMs, this.snapshotIntervalMs + this.bufferMs + 3 * this.jitter);
  }

  get count(): number {
    return this.remotes.size;
  }

  // Calls `fn` for every mech we can see, with where it is drawn. Allocates nothing.
  forEach(fn: (x: number, z: number, bot: boolean, dead: boolean) => void): void {
    for (const r of this.remotes.values()) {
      const p = r.model.group.position;
      fn(p.x, p.z, r.bot, r.dead);
    }
  }

  forEachModel(fn: (model: MechModel) => void): void {
    for (const r of this.remotes.values()) fn(r.model);
  }

  isBot(id: number): boolean {
    return this.remotes.get(id)?.bot === true;
  }

  // Who can be watched: everyone still standing.
  aliveIds(): number[] {
    return [...this.remotes.entries()].filter(([, r]) => !r.dead).map(([id]) => id);
  }

  // The distance along a ray to the nearest standing mech, checked against its hit zones where it is drawn, or -1.
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, zonesFor: (mech: number) => ZoneSet, hit: ZoneHit): number {
    let best = -1;
    let reach = max;
    for (const r of this.remotes.values()) {
      if (r.dead) continue;
      const p = r.model.group.position;
      if (raycastMech(ox, oy, oz, dx, dy, dz, reach, p.x, p.y, p.z, r.model.group.rotation.y, zonesFor(r.mech), hit)) {
        best = hit.distance;
        reach = hit.distance;
      }
    }
    return best;
  }

  // Calls `fn` for every mech within `range` of a point, with how it is moving where it is drawn, for its walk.
  // Allocates nothing.
  forEachNear(x: number, z: number, range: number, fn: (model: MechModel, mech: number, vx: number, vy: number, vz: number, jetting: boolean, running: boolean, ability: boolean, dropPhase: number) => void): void {
    for (const r of this.remotes.values()) {
      const p = r.model.group.position;
      if (Math.abs(p.x - x) > range || Math.abs(p.z - z) > range) continue;
      fn(r.model, r.mech, r.vx, r.vy, r.vz, r.jetting, r.running, r.ability, r.dropPhase);
    }
  }

  // Calls `fn` for every mech, however far, with its drop phase and how it moves where it is drawn, for the dive's
  // pose and smoke trail. Not while the kill replay is placing everyone. Allocates nothing.
  forEachDrop(fn: (model: MechModel, dropPhase: number, vx: number, vy: number, vz: number, id: number) => void): void {
    if (this.replaying) return;
    for (const r of this.remotes.values()) fn(r.model, r.dropPhase, r.vx, r.vy, r.vz, r.id);
  }

  // Whether a wreck that still has something in it is within range of a spot, for the "hold E" prompt.
  fullWreckNear(x: number, z: number, range: number): boolean {
    for (const r of this.remotes.values()) {
      if (!r.dead || r.looted) continue;
      const p = r.model.group.position;
      if (Math.hypot(p.x - x, p.z - z) <= range) return true;
    }
    return false;
  }

  // Which roster mech someone is, or -1 if we have not seen them.
  mechOf(id: number): number {
    return this.remotes.get(id)?.mech ?? -1;
  }

  // The weapon someone has in hand (index in weapons.json), or -1 if we have not seen them.
  weaponOf(id: number): number {
    return this.remotes.get(id)?.weapon ?? -1;
  }

  // The model someone is drawn with, or null if we have not seen them: for their gun's kick when they fire.
  modelOf(id: number): MechModel | null {
    return this.remotes.get(id)?.model ?? null;
  }

  // Which way a mech faces as drawn right now, in radians, or NaN if we have not seen it.
  yawOf(id: number): number {
    return this.remotes.get(id)?.model.group.rotation.y ?? Number.NaN;
  }

  // Where a mech is drawn right now, or false if we have not seen it.
  positionOf(id: number, out: { x: number; y: number; z: number }): boolean {
    const remote = this.remotes.get(id);
    if (!remote) return false;
    const p = remote.model.group.position;
    out.x = p.x; out.y = p.y; out.z = p.z;
    return true;
  }

  // Your decoys just went out. They may already be in a snapshot, or arrive in the next one: either way they go see-through.
  addOwnDecoys(ids: readonly number[]): void {
    for (const id of ids) {
      this.ownDecoys.add(id);
      const remote = this.remotes.get(id);
      if (remote) this.ghostIfOwn(id, remote);
    }
  }

  // One of your decoys burst. It leaves the snapshots next, so there is nothing left to draw differently.
  forgetOwnDecoy(id: number): void {
    this.ownDecoys.delete(id);
  }

  isOwnDecoy(id: number): boolean {
    return this.ownDecoys.has(id);
  }

  private ghostIfOwn(id: number, remote: Remote): void {
    if (remote.ghost || !this.ghostLook || !this.ownDecoys.has(id)) return;
    remote.ghost = makeGhost(remote.model, this.ghostLook);
  }

  private dropModel(remote: Remote): void {
    this.scene.remove(remote.model.group);
    if (remote.ghost) for (const m of remote.ghost) m.dispose();
    remote.ghost = null;
  }

  private makeModel(o: OtherState): MechModel {
    const model = this.look ? createMechModel(this.look.accentFor(o.id), this.zoneMaxHp, this.look.toon, this.look.body, this.look.kitFor(o.mech), this.look.trim) : createMechModel("#2f7fd0", this.zoneMaxHp);
    castShadows(model.group);
    this.scene.add(model.group);
    return model;
  }

  push(others: readonly OtherState[], serverTick: number, nowMs: number): void {
    const serverMs = serverTick * STEP * 1000;
    const gap = nowMs - serverMs;
    this.arrivals.push(gap);
    if (this.arrivals.length > OFFSET_WINDOW) this.arrivals.shift();
    this.offset = Math.min(...this.arrivals);
    // How much later than the best case this snapshot came, smoothed. This is the jitter the buffer has to absorb.
    this.jitter = this.hasClock ? this.jitter + ((gap - this.offset) - this.jitter) * 0.1 : 0;
    this.hasClock = true;

    for (const r of this.remotes.values()) r.seen = false;

    for (const o of others) {
      let remote = this.remotes.get(o.id);
      if (remote && remote.mech !== o.mech) {
        // Picked another mech between matches: same player, new body. Keeps its samples so it does not jump.
        this.dropModel(remote);
        remote.model = this.makeModel(o);
        remote.mech = o.mech;
      }
      if (!remote) {
        remote = { id: o.id, model: this.makeModel(o), mech: o.mech, weapon: o.weapon, vx: 0, vy: 0, vz: 0, jetting: false, running: false, ability: false, dropPhase: o.dropPhase, dead: false, hp: [...o.hp], looted: false, bot: o.bot, ghost: null, samples: [], seen: true };
        this.remotes.set(o.id, remote);
      }
      remote.seen = true;
      remote.weapon = o.weapon;
      const wasDead = remote.dead, firstSeen = remote.samples.length === 0;
      remote.dead = o.dead;
      remote.looted = o.looted;
      remote.jetting = o.jetting;
      remote.running = o.running;
      remote.ability = o.ability;
      if (o.dropPhase !== remote.dropPhase) {
        const from = remote.dropPhase;
        remote.dropPhase = o.dropPhase;
        if (!this.replaying) this.onDropPhase?.(remote.model, from, o.dropPhase, o.x, o.y, o.z);
      }
      remote.model.repairing = o.repairing;
      for (let zone = 0; zone < remote.hp.length; zone++) remote.hp[zone] = o.hp[zone] ?? 0;
      // Going down during a replay shows when it ends, lying there: the replay has the old picture on screen.
      if (!this.replaying) {
        setMechDamage(remote.model, o.hp, o.dead);
        if (o.dead && !wasDead) this.onKnockedOut?.(o.id, remote.model, firstSeen);
      }
      setMechGear(remote.model, this.weaponColors[o.weapon] ?? "#d9731a", o.armor);
      setMechUpgrades(remote.model, o.upgrades, this.upgrades);
      this.ghostIfOwn(o.id, remote); // after the upgrades, so their parts go see-through too
      remote.samples.push({ time: serverMs, x: o.x, y: o.y, z: o.z, yaw: o.yaw });
      if (remote.samples.length > MAX_SAMPLES) remote.samples.shift();
    }

    for (const [id, remote] of this.remotes) {
      if (!remote.seen) {
        this.dropModel(remote);
        this.remotes.delete(id);
        this.ownDecoys.delete(id); // a decoy runs out within sight of you, so once gone it is gone for good
      }
    }
  }

  // Calls `fn` for every mech as it is drawn this frame, for the kill replay's recording. The same object is passed
  // each time and overwritten, so nothing is allocated.
  forEachDrawn(fn: (id: number, m: DrawnMech) => void): void {
    const d = this.drawn;
    for (const r of this.remotes.values()) {
      const p = r.model.group.position;
      d.x = p.x; d.y = p.y; d.z = p.z; d.yaw = r.model.group.rotation.y;
      d.vx = r.vx; d.vy = r.vy; d.vz = r.vz;
      d.jetting = r.jetting; d.running = r.running; d.ability = r.ability; d.dead = r.dead;
      for (let zone = 0; zone < d.hp.length; zone++) d.hp[zone] = r.hp[zone] ?? 0;
      fn(r.id, d);
    }
  }

  // The kill replay takes over: `update` stops moving anyone and snapshots stop changing their damage.
  beginReplay(): void {
    this.replaying = true;
  }

  // Each replay frame starts with everyone hidden; `showRecorded` brings back the ones in the recording, so a mech
  // that arrived since is not standing in the middle of the past.
  hideAll(): void {
    for (const r of this.remotes.values()) r.model.group.visible = false;
  }

  // Draws a mech as the recording has it. False if it has left since, so there is no model to draw.
  showRecorded(id: number, m: DrawnMech): boolean {
    const r = this.remotes.get(id);
    if (!r) return false;
    r.model.group.visible = true;
    r.model.group.position.set(m.x, m.y, m.z);
    r.model.group.rotation.y = m.yaw;
    r.vx = m.vx; r.vy = m.vy; r.vz = m.vz;
    r.jetting = m.jetting; r.running = m.running; r.ability = m.ability;
    if (damageDiffers(r.model, m)) {
      const wasDead = r.model.dead;
      setMechDamage(r.model, m.hp, m.dead);
      if (m.dead && !wasDead) this.onKnockedOut?.(id, r.model, false); // blows apart again, as it did then
    }
    return true;
  }

  // Everyone back as they are now: shown, damaged as the newest snapshot says, and moved again by `update`.
  endReplay(): void {
    if (!this.replaying) return;
    this.replaying = false;
    for (const r of this.remotes.values()) {
      r.model.group.visible = true;
      setMechDamage(r.model, r.hp, r.dead);
      if (r.dead && !r.model.blownApart) this.onKnockedOut?.(r.id, r.model, true);
    }
  }

  update(nowMs: number): void {
    if (!this.hasClock || this.replaying) return;
    // Where the server's clock is as far as this client can tell, minus the buffer: the moment we draw.
    const renderTime = nowMs - this.offset - this.viewDelayMs;
    for (const remote of this.remotes.values()) {
      const s = remote.samples;
      if (s.length === 0) continue;

      // Find the two samples around renderTime. Before the first or after the last, hold still.
      let i = s.length - 1;
      while (i > 0 && s[i]!.time > renderTime) i--;
      const a = s[i]!;
      const b = s[Math.min(i + 1, s.length - 1)]!;
      const span = b.time - a.time;
      const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.time) / span)) : 0;

      remote.model.group.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      // The speed between the two samples it is drawn between; standing still once it runs past the newest.
      const moving = span > 0 && renderTime < b.time;
      remote.vx = moving ? ((b.x - a.x) / span) * 1000 : 0;
      remote.vy = moving ? ((b.y - a.y) / span) * 1000 : 0;
      remote.vz = moving ? ((b.z - a.z) / span) * 1000 : 0;
      let dyaw = b.yaw - a.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      remote.model.group.rotation.y = a.yaw + dyaw * t;
    }
  }
}

// Damage is shown only when it changes: setMechDamage walks every part of the model.
export function damageDiffers(model: MechModel, m: DrawnMech): boolean {
  if (model.dead !== m.dead) return true;
  for (let zone = 0; zone < model.hp.length; zone++) if (model.hp[zone] !== m.hp[zone]) return true;
  return false;
}
