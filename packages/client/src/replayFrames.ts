// The last few seconds of every mech as it was drawn on this screen, for the kill replay (gate 13b). Frames go into a
// fixed ring of typed arrays and the oldest is written over, so recording allocates nothing in the frame loop.

// One mech as drawn: where, which way it faced, how it moved (for its walk), and what state it was in.
export interface DrawnMech {
  x: number; y: number; z: number; yaw: number;
  vx: number; vy: number; vz: number;
  jetting: boolean; running: boolean; ability: boolean; dead: boolean;
  hp: number[];
}

export function createDrawnMech(zones: number): DrawnMech {
  return { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, jetting: false, running: false, ability: false, dead: false, hp: new Array<number>(zones).fill(0) };
}

// Which two frames lie either side of a moment, by age (0 the oldest), and how far from the first to the second.
export interface Bracket {
  a: number;
  b: number;
  t: number;
}

const POSE = 7; // x, y, z, yaw, vx, vy, vz
const JETTING = 1, RUNNING = 2, ABILITY = 4, DEAD = 8;

export class ReplayFrames {
  private times: Float64Array;
  private counts: Uint16Array;
  private ids: Int32Array;
  private poses: Float32Array;
  private flags: Uint8Array;
  private hp: Float32Array;
  private next = 0; // the slot the next frame goes into
  private filled = 0;

  constructor(readonly capacity: number, readonly maxMechs: number, readonly zones: number) {
    this.times = new Float64Array(capacity);
    this.counts = new Uint16Array(capacity);
    this.ids = new Int32Array(capacity * maxMechs);
    this.poses = new Float32Array(capacity * maxMechs * POSE);
    this.flags = new Uint8Array(capacity * maxMechs);
    this.hp = new Float32Array(capacity * maxMechs * zones);
  }

  get size(): number {
    return this.filled;
  }

  // Time of a frame by age, 0 the oldest.
  timeAt(age: number): number {
    return this.times[this.slot(age)]!;
  }

  get newestTime(): number {
    return this.filled > 0 ? this.timeAt(this.filled - 1) : Number.NaN;
  }

  clear(): void {
    this.next = 0;
    this.filled = 0;
  }

  // Starts a frame, writing over the oldest once the ring is full. Times must not go backwards.
  begin(timeMs: number): void {
    this.times[this.next] = timeMs;
    this.counts[this.next] = 0;
    this.next = (this.next + 1) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + 1);
  }

  // Adds a mech to the frame just begun. Past maxMechs the rest are left out: the interest range keeps the count far
  // below that, so this is only a guard.
  add(id: number, m: DrawnMech): void {
    if (this.filled === 0) return;
    const frame = (this.next + this.capacity - 1) % this.capacity;
    const count = this.counts[frame]!;
    if (count >= this.maxMechs) return;
    const at = frame * this.maxMechs + count;
    this.ids[at] = id;
    const p = at * POSE;
    this.poses[p] = m.x; this.poses[p + 1] = m.y; this.poses[p + 2] = m.z; this.poses[p + 3] = m.yaw;
    this.poses[p + 4] = m.vx; this.poses[p + 5] = m.vy; this.poses[p + 6] = m.vz;
    this.flags[at] = (m.jetting ? JETTING : 0) | (m.running ? RUNNING : 0) | (m.ability ? ABILITY : 0) | (m.dead ? DEAD : 0);
    for (let zone = 0; zone < this.zones; zone++) this.hp[at * this.zones + zone] = m.hp[zone] ?? 0;
    this.counts[frame] = count + 1;
  }

  // How many mechs a frame holds, by age.
  countAt(age: number): number {
    return this.counts[this.slot(age)]!;
  }

  // The id of the n-th mech in a frame, by age.
  idAt(age: number, n: number): number {
    return this.ids[this.slot(age) * this.maxMechs + n]!;
  }

  // The frames either side of `timeMs`. Before the oldest or after the newest it holds on that frame (t 0).
  // False with nothing recorded.
  bracket(timeMs: number, out: Bracket): boolean {
    if (this.filled === 0) return false;
    let lo = 0, hi = this.filled - 1;
    if (timeMs <= this.timeAt(lo)) { out.a = out.b = lo; out.t = 0; return true; }
    if (timeMs >= this.timeAt(hi)) { out.a = out.b = hi; out.t = 0; return true; }
    // The newest frame at or before timeMs. Frames are in time order, so a binary search over ages finds it.
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= timeMs) lo = mid;
      else hi = mid;
    }
    const span = this.timeAt(hi) - this.timeAt(lo);
    out.a = lo; out.b = hi;
    out.t = span > 0 ? (timeMs - this.timeAt(lo)) / span : 0;
    return true;
  }

  // Where mech `id` sits in a frame (by age), or -1 if it was not in that frame.
  find(age: number, id: number): number {
    const frame = this.slot(age);
    const count = this.counts[frame]!;
    const base = frame * this.maxMechs;
    for (let n = 0; n < count; n++) if (this.ids[base + n] === id) return n;
    return -1;
  }

  // Mech `id` at a moment, blended between the frames either side. A mech in only one of them is held where that one
  // has it. The flags and hit points come from the nearer frame, as they do not blend. False if it is in neither.
  sample(timeMs: number, id: number, bracket: Bracket, out: DrawnMech): boolean {
    if (!this.bracket(timeMs, bracket)) return false;
    return this.sampleIn(bracket, id, out);
  }

  // As `sample`, with the bracket already found: the replay looks up many mechs at one moment.
  sampleIn(bracket: Bracket, id: number, out: DrawnMech): boolean {
    const na = this.find(bracket.a, id);
    const nb = this.find(bracket.b, id);
    if (na < 0 && nb < 0) return false;
    const atA = na >= 0 ? this.slot(bracket.a) * this.maxMechs + na : -1;
    const atB = nb >= 0 ? this.slot(bracket.b) * this.maxMechs + nb : -1;
    const from = atA >= 0 ? atA : atB;
    const to = atB >= 0 ? atB : atA;
    const t = atA >= 0 && atB >= 0 ? bracket.t : 0;
    const pa = from * POSE, pb = to * POSE;
    out.x = this.blend(pa, pb, 0, t); out.y = this.blend(pa, pb, 1, t); out.z = this.blend(pa, pb, 2, t);
    // The short way round, so a mech turning through ±PI does not spin the long way.
    let turn = this.poses[pb + 3]! - this.poses[pa + 3]!;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    out.yaw = this.poses[pa + 3]! + turn * t;
    out.vx = this.blend(pa, pb, 4, t); out.vy = this.blend(pa, pb, 5, t); out.vz = this.blend(pa, pb, 6, t);
    const state = t < 0.5 ? from : to;
    const flags = this.flags[state]!;
    out.jetting = (flags & JETTING) !== 0;
    out.running = (flags & RUNNING) !== 0;
    out.ability = (flags & ABILITY) !== 0;
    out.dead = (flags & DEAD) !== 0;
    for (let zone = 0; zone < this.zones; zone++) out.hp[zone] = this.hp[state * this.zones + zone]!;
    return true;
  }

  // The time of the first frame from `fromMs` to `toMs` that holds mech `id`, or NaN if none does.
  firstSeen(id: number, fromMs: number, toMs: number): number {
    for (let age = 0; age < this.filled; age++) {
      const time = this.timeAt(age);
      if (time < fromMs) continue;
      if (time > toMs) break;
      if (this.find(age, id) >= 0) return time;
    }
    return Number.NaN;
  }

  private blend(pa: number, pb: number, i: number, t: number): number {
    return this.poses[pa + i]! + (this.poses[pb + i]! - this.poses[pa + i]!) * t;
  }

  private slot(age: number): number {
    return (this.next - this.filled + age + this.capacity) % this.capacity;
  }
}
