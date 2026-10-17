import * as THREE from "three";
import { STEP, type OtherState } from "@rustbucket/shared";
import { createMechModel, setMechDamage, setMechGear, type MechModel } from "./mechModel";

interface Sample {
  time: number;
  x: number; y: number; z: number; yaw: number;
}

interface Remote {
  model: MechModel;
  dead: boolean;
  looted: boolean;
  bot: boolean;
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

  // The colour of each weapon by index, for drawing the gun in hand.
  weaponColors: string[] = [];

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

  // Whether a wreck that still has something in it is within range of a spot, for the "hold E" prompt.
  fullWreckNear(x: number, z: number, range: number): boolean {
    for (const r of this.remotes.values()) {
      if (!r.dead || r.looted) continue;
      const p = r.model.group.position;
      if (Math.hypot(p.x - x, p.z - z) <= range) return true;
    }
    return false;
  }

  // Where a mech is drawn right now, or false if we have not seen it.
  positionOf(id: number, out: { x: number; y: number; z: number }): boolean {
    const remote = this.remotes.get(id);
    if (!remote) return false;
    const p = remote.model.group.position;
    out.x = p.x; out.y = p.y; out.z = p.z;
    return true;
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
      if (!remote) {
        const model = createMechModel("#2f7fd0", this.zoneMaxHp);
        this.scene.add(model.group);
        remote = { model, dead: false, looted: false, bot: o.bot, samples: [], seen: true };
        this.remotes.set(o.id, remote);
      }
      remote.seen = true;
      remote.dead = o.dead;
      remote.looted = o.looted;
      setMechDamage(remote.model, o.hp, o.dead);
      setMechGear(remote.model, this.weaponColors[o.weapon] ?? "#d9731a", o.armor);
      remote.samples.push({ time: serverMs, x: o.x, y: o.y, z: o.z, yaw: o.yaw });
      if (remote.samples.length > MAX_SAMPLES) remote.samples.shift();
    }

    for (const [id, remote] of this.remotes) {
      if (!remote.seen) {
        this.scene.remove(remote.model.group);
        this.remotes.delete(id);
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
      let dyaw = b.yaw - a.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      remote.model.group.rotation.y = a.yaw + dyaw * t;
    }
  }
}
