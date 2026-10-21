import type { PickupState } from "@rustbucket/shared";

// Everything lying on the ground in one room. Ids keep counting up through a match, so a client never mixes up an
// old pickup with a new one. If there are ever too many, the oldest goes.
export class Pickups {
  private items = new Map<number, PickupState>();
  private nextId = 1;

  constructor(private max: number) {}

  get count(): number {
    return this.items.size;
  }

  add(item: number, x: number, y: number, z: number): PickupState {
    if (this.items.size >= this.max) this.items.delete(this.items.keys().next().value!);
    const pickup = { id: this.nextId++ & 0xffff, item, x, y, z };
    this.items.set(pickup.id, pickup);
    return pickup;
  }

  get(id: number): PickupState | undefined {
    return this.items.get(id);
  }

  remove(id: number): void {
    this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }

  // The nearest pickup within range that `wanted` accepts, or null.
  nearest(x: number, z: number, range: number, wanted: (p: PickupState) => boolean): PickupState | null {
    let best: PickupState | null = null;
    let bestDistance = range;
    for (const p of this.items.values()) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d <= bestDistance && wanted(p)) { best = p; bestDistance = d; }
    }
    return best;
  }

  // Every pickup within range, for a snapshot.
  near(x: number, z: number, range: number, out: PickupState[]): PickupState[] {
    out.length = 0;
    for (const p of this.items.values()) if (Math.hypot(p.x - x, p.z - z) <= range) out.push(p);
    return out;
  }

  // Every pickup within range of a spot, for walking over.
  *within(x: number, z: number, range: number): Generator<PickupState> {
    for (const p of [...this.items.values()]) if (Math.hypot(p.x - x, p.z - z) <= range) yield p;
  }
}
