import type { AbilityMessage, Shot } from "@rustbucket/shared";

// The shots, blasts, grenade throws and ability moments of the last few seconds, as this screen showed them, so the
// kill replay can fire them again through the same effects (gate 13b). A fixed ring: the oldest is written over.

export const SHOT = 0, EXPLODE = 1, GRENADE = 2, ABILITY = 3;

const ABILITY_KINDS: readonly AbilityMessage["kind"][] = ["ram", "pounce", "barrage", "decoy", "rail"];
const ABILITY_EVENTS: readonly AbilityMessage["event"][] = ["start", "hit", "land", "pop"];
const VALUES = 7; // a shot's origin, direction and length; a grenade's position and velocity; a place

export class ReplayEvents {
  private times: Float64Array;
  private kinds: Uint8Array;
  private ids: Int32Array; // who fired, threw or used the ability
  private codes: Int16Array; // the weapon of a shot, or the ability's kind
  private marks: Uint8Array; // a shot that hit a mech, or the ability's event
  private values: Float32Array;
  private next = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.times = new Float64Array(capacity);
    this.kinds = new Uint8Array(capacity);
    this.ids = new Int32Array(capacity);
    this.codes = new Int16Array(capacity);
    this.marks = new Uint8Array(capacity);
    this.values = new Float32Array(capacity * VALUES);
  }

  get size(): number {
    return this.filled;
  }

  clear(): void {
    this.next = 0;
    this.filled = 0;
  }

  shot(timeMs: number, id: number, shot: Shot, weapon: number, hitMech: boolean): void {
    const at = this.push(timeMs, SHOT, id, weapon, hitMech ? 1 : 0);
    this.set(at, shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, shot.length);
  }

  explode(timeMs: number, x: number, y: number, z: number): void {
    const at = this.push(timeMs, EXPLODE, 0, 0, 0);
    this.set(at, x, y, z, 0, 0, 0, 0);
  }

  grenade(timeMs: number, id: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const at = this.push(timeMs, GRENADE, id, 0, 0);
    this.set(at, x, y, z, vx, vy, vz, 0);
  }

  // Decoy ids are left out: only their owner draws them differently, and the owner is the one knocked out.
  ability(timeMs: number, a: AbilityMessage): void {
    const at = this.push(timeMs, ABILITY, a.id, Math.max(0, ABILITY_KINDS.indexOf(a.kind)), Math.max(0, ABILITY_EVENTS.indexOf(a.event)));
    this.set(at, a.x, a.y, a.z, 0, 0, 0, 0);
  }

  // The age (0 the oldest) of the first event later than `fromMs`, or `size` if there is none. Events are kept in
  // arrival order, so a binary search finds it.
  firstAfter(fromMs: number): number {
    let lo = 0, hi = this.filled;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= fromMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  timeAt(age: number): number {
    return this.times[this.slot(age)]!;
  }

  kindAt(age: number): number {
    return this.kinds[this.slot(age)]!;
  }

  idAt(age: number): number {
    return this.ids[this.slot(age)]!;
  }

  weaponAt(age: number): number {
    return this.codes[this.slot(age)]!;
  }

  hitMechAt(age: number): boolean {
    return this.marks[this.slot(age)] === 1;
  }

  // The n-th value of an event: 0-2 a place, 3-5 a direction or velocity, 6 a shot's length.
  valueAt(age: number, n: number): number {
    return this.values[this.slot(age) * VALUES + n]!;
  }

  readShot(age: number, out: Shot): void {
    const v = this.slot(age) * VALUES;
    out.ox = this.values[v]!; out.oy = this.values[v + 1]!; out.oz = this.values[v + 2]!;
    out.dx = this.values[v + 3]!; out.dy = this.values[v + 4]!; out.dz = this.values[v + 5]!;
    out.length = this.values[v + 6]!;
  }

  readAbility(age: number, out: AbilityMessage): void {
    const at = this.slot(age);
    out.id = this.ids[at]!;
    out.kind = ABILITY_KINDS[this.codes[at]!]!;
    out.event = ABILITY_EVENTS[this.marks[at]!]!;
    out.x = this.values[at * VALUES]!; out.y = this.values[at * VALUES + 1]!; out.z = this.values[at * VALUES + 2]!;
    out.ids = undefined;
  }

  private push(timeMs: number, kind: number, id: number, code: number, mark: number): number {
    const at = this.next;
    this.times[at] = timeMs;
    this.kinds[at] = kind;
    this.ids[at] = id;
    this.codes[at] = code;
    this.marks[at] = mark;
    this.next = (this.next + 1) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + 1);
    return at;
  }

  private set(at: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number): void {
    const v = at * VALUES;
    this.values[v] = a; this.values[v + 1] = b; this.values[v + 2] = c;
    this.values[v + 3] = d; this.values[v + 4] = e; this.values[v + 5] = f; this.values[v + 6] = g;
  }

  private slot(age: number): number {
    return (this.next - this.filled + age + this.capacity) % this.capacity;
  }
}
