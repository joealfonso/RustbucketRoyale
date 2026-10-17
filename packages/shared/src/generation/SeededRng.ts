// The only source of randomness allowed in map generation. A small 32 bit generator (mulberry32) built
// from integer operations only, so every browser and CPU gets the same numbers from the same seed.
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  // A 32 bit unsigned integer.
  next32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  // An integer from 0 up to but not including `bound`. The tiny bias of a plain remainder does not matter for a map.
  nextInt(bound: number): number {
    return this.next32() % bound;
  }

  // Shuffles in place.
  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const swap = items[i]!;
      items[i] = items[j]!;
      items[j] = swap;
    }
  }
}

// A new seed for retry number `attempt`, so every machine retries the same way.
export function deriveSeed(seed: number, attempt: number): number {
  const rng = new SeededRng((seed ^ Math.imul(attempt + 1, 0x9e3779b1)) >>> 0);
  rng.next32();
  return rng.next32();
}
