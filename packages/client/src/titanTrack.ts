import { TITAN_ACTIONS, type TitanState } from "@rustbucket/shared";

// Where the Titan is drawn this frame and what it is doing, written by TitanTrack.sample.
export interface TitanPose {
  x: number; y: number; z: number;
  yaw: number;
  vx: number; vy: number; vz: number; // how fast it moves where it is drawn, for its walk
  hp: number; // share of full, 0 to 1
  action: number; // index in TITAN_ACTIONS
  seconds: number; // how far into that action, at the moment drawn
}

export function createTitanPose(): TitanPose {
  return { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, hp: 1, action: 0, seconds: 0 };
}

const OFFSET_WINDOW = 40;
const ENDLESS = TITAN_ACTIONS.map((a) => a === "walk" || a === "down");

// The Titan's snapshots, drawn a little in the past like other mechs (remoteMechs.ts): samples on the server's clock,
// blended between the two around the moment drawn. Its action clock is worked out from each sample's own seconds into
// the action, so a stomp seen in the past slams at the same moment into it as on the server. A fixed ring of samples;
// nothing is allocated after it is made.
export class TitanTrack {
  private times: Float64Array;
  private values: Float32Array; // per sample: x, y, z, yaw, hp, action, actionSeconds
  private next = 0;
  private filled = 0;
  private arrivals = new Float64Array(OFFSET_WINDOW);
  private arrivalCount = 0;
  private offset = 0;

  constructor(readonly capacity: number) {
    this.times = new Float64Array(capacity);
    this.values = new Float32Array(capacity * 7);
  }

  get size(): number {
    return this.filled;
  }

  clear(): void {
    this.next = 0;
    this.filled = 0;
    this.arrivalCount = 0;
  }

  // One snapshot's Titan, at server time `serverMs`, arriving at local time `nowMs`.
  push(s: TitanState, serverMs: number, nowMs: number): void {
    this.arrivals[this.arrivalCount % OFFSET_WINDOW] = nowMs - serverMs;
    this.arrivalCount++;
    let best = Infinity;
    for (let i = 0; i < Math.min(this.arrivalCount, OFFSET_WINDOW); i++) best = Math.min(best, this.arrivals[i]!);
    this.offset = best;
    const at = this.next;
    this.times[at] = serverMs;
    const v = at * 7;
    this.values[v] = s.x; this.values[v + 1] = s.y; this.values[v + 2] = s.z; this.values[v + 3] = s.yaw;
    this.values[v + 4] = s.hp; this.values[v + 5] = Math.max(0, TITAN_ACTIONS.indexOf(s.action)); this.values[v + 6] = s.actionSeconds;
    this.next = (this.next + 1) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + 1);
  }

  // The server moment drawn at local time `nowMs`, `delayMs` behind the best the network has managed.
  renderTime(nowMs: number, delayMs: number): number {
    return nowMs - this.offset - delayMs;
  }

  // The Titan as it was at server time `renderMs`. Before the first sample it holds there; past the newest it stands
  // where that one put it while its action clock runs on. False with no samples.
  sample(renderMs: number, out: TitanPose): boolean {
    if (this.filled === 0) return false;
    let i = this.filled - 1;
    while (i > 0 && this.timeAt(i) > renderMs) i--;
    const j = Math.min(i + 1, this.filled - 1);
    const ta = this.timeAt(i), tb = this.timeAt(j);
    const span = tb - ta;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderMs - ta) / span)) : 0;
    const a = this.slot(i) * 7, b = this.slot(j) * 7, v = this.values;
    out.x = v[a]! + (v[b]! - v[a]!) * t;
    out.y = v[a + 1]! + (v[b + 1]! - v[a + 1]!) * t;
    out.z = v[a + 2]! + (v[b + 2]! - v[a + 2]!) * t;
    const turn = Math.atan2(Math.sin(v[b + 3]! - v[a + 3]!), Math.cos(v[b + 3]! - v[a + 3]!));
    out.yaw = v[a + 3]! + turn * t;
    out.hp = v[a + 4]! + (v[b + 4]! - v[a + 4]!) * t;
    const moving = span > 0 && renderMs < tb;
    out.vx = moving ? ((v[b]! - v[a]!) / span) * 1000 : 0;
    out.vy = moving ? ((v[b + 1]! - v[a + 1]!) / span) * 1000 : 0;
    out.vz = moving ? ((v[b + 2]! - v[a + 2]!) / span) * 1000 : 0;
    // The next sample's action began actionSeconds before it was sent: once the moment drawn is past that start, it
    // is that action, so the switch lands on the server's own moment and not on the next snapshot. The same move
    // begun again after the earlier sample (two stomps in a row) counts as a new one; walking and lying down can
    // outlast the wire's clock (it stops at 12.75 s), so those are never taken as begun again.
    const startB = tb - v[b + 6]! * 1000;
    const again = v[b + 5] === v[a + 5] && !ENDLESS[v[a + 5]!] && startB > ta + 1;
    if (j !== i && (v[b + 5] !== v[a + 5] || again) && renderMs >= startB) {
      out.action = v[b + 5]!;
      out.seconds = (renderMs - startB) / 1000;
    } else {
      out.action = v[a + 5]!;
      out.seconds = Math.max(0, v[a + 6]! + (renderMs - ta) / 1000);
    }
    return true;
  }

  private timeAt(age: number): number {
    return this.times[this.slot(age)]!;
  }

  private slot(age: number): number {
    return (this.next - this.filled + age + this.capacity) % this.capacity;
  }
}
