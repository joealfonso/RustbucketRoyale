import * as THREE from "three";
import { STEP, raycastMech, type OtherState, type ZoneHit, type ZoneSet } from "@rustbucket/shared";
import { createMechModel, setMechDamage, setMechGear, setMechUpgrades, type MechModel } from "./mechModel";
import type { UpgradeDef } from "@rustbucket/shared";
import type { Toon } from "./toonMaterial";
import type { LoadedKit } from "./mechKit";
import type { AbilityFxConfig } from "./abilityFx";
import { makeGhost } from "./ghostLook";

interface Sample {
  time: number;
  x: number; y: number; z: number; yaw: number;
}

interface Remote {
  model: MechModel;
  vx: number; vy: number; vz: number; // how fast it is moving where it is drawn, for its walk
  jetting: boolean;
  running: boolean;
  ability: boolean; // using its ability right now: ramming, or in the air on a pounce
  mech: number; // the roster mech it is drawn as. A new one swaps the model.
  dead: boolean;
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

  // The colour of each weapon by index, for drawing the gun in hand.
  weaponColors: string[] = [];
  upgrades: UpgradeDef[] = [];
  // The toon look and colours for other mechs. Without it they are drawn as plain grey boxes.
  look: { toon: Toon; accentFor: (id: number) => string; body: string; kitFor: (mech: number) => LoadedKit | null; trim: string } | null = null;
  // How your own decoys look to you. Without it they are drawn like anyone else.
  ghostLook: AbilityFxConfig["ghost"] | null = null;

  constructor(
    private scene: THREE.Scene,
    private bufferMs: number,
    private maxDelayMs: number,
    private snapshotIntervalMs: number,
    private zoneMaxHp: readonly number[],
  ) {}

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
  forEachNear(x: number, z: number, range: number, fn: (model: MechModel, mech: number, vx: number, vy: number, vz: number, jetting: boolean, running: boolean, ability: boolean) => void): void {
    for (const r of this.remotes.values()) {
      const p = r.model.group.position;
      if (Math.abs(p.x - x) > range || Math.abs(p.z - z) > range) continue;
      fn(r.model, r.mech, r.vx, r.vy, r.vz, r.jetting, r.running, r.ability);
    }
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
        remote = { model: this.makeModel(o), mech: o.mech, vx: 0, vy: 0, vz: 0, jetting: false, running: false, ability: false, dead: false, looted: false, bot: o.bot, ghost: null, samples: [], seen: true };
        this.remotes.set(o.id, remote);
      }
      remote.seen = true;
      remote.dead = o.dead;
      remote.looted = o.looted;
      remote.jetting = o.jetting;
      remote.running = o.running;
      remote.ability = o.ability;
      remote.model.repairing = o.repairing;
      setMechDamage(remote.model, o.hp, o.dead);
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

  update(nowMs: number): void {
    if (!this.hasClock) return;
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
