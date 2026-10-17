import * as THREE from "three";
import type { OtherState } from "@rustbucket/shared";
import { createMechModel, setMechDamage, type MechModel } from "./mechModel";

interface Sample {
  time: number;
  x: number; y: number; z: number; yaw: number;
}

interface Remote {
  model: MechModel;
  dead: boolean;
  samples: Sample[];
  seen: boolean;
}

const MAX_SAMPLES = 12;

// Other players, drawn a little in the past. Blending between two real snapshots looks smooth
// where chasing the newest one would stutter, at the cost of showing them ~100 ms late.
export class RemoteMechs {
  private remotes = new Map<number, Remote>();

  constructor(private scene: THREE.Scene, private delayMs: number, private zoneMaxHp: readonly number[]) {}

  get count(): number {
    return this.remotes.size;
  }

  // Who can be watched: everyone still standing.
  aliveIds(): number[] {
    return [...this.remotes.entries()].filter(([, r]) => !r.dead).map(([id]) => id);
  }

  // Where a mech is drawn right now, or false if we have not seen it.
  positionOf(id: number, out: { x: number; y: number; z: number }): boolean {
    const remote = this.remotes.get(id);
    if (!remote) return false;
    const p = remote.model.group.position;
    out.x = p.x; out.y = p.y; out.z = p.z;
    return true;
  }

  push(others: readonly OtherState[], nowMs: number): void {
    for (const r of this.remotes.values()) r.seen = false;

    for (const o of others) {
      let remote = this.remotes.get(o.id);
      if (!remote) {
        const model = createMechModel("#2f7fd0", this.zoneMaxHp);
        this.scene.add(model.group);
        remote = { model, dead: false, samples: [], seen: true };
        this.remotes.set(o.id, remote);
      }
      remote.seen = true;
      remote.dead = o.dead;
      setMechDamage(remote.model, o.hp, o.dead);
      remote.samples.push({ time: nowMs, x: o.x, y: o.y, z: o.z, yaw: o.yaw });
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
    const renderTime = nowMs - this.delayMs;
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
