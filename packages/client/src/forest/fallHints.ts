// Which way a tree should fall. The server only says that a tree broke, not what broke it, so the client remembers
// the last few shots and blasts it saw and, when a tree goes, looks for one that passed through its trunk or went off
// beside it: shot from the left, it falls to the right; blown up, it falls away from the blast. A fixed ring of
// entries, written over oldest first, so remembering allocates nothing.

const SIZE = 32;

export class FallHints {
  private kind = new Uint8Array(SIZE); // 0 empty, 1 shot, 2 blast
  private time = new Float64Array(SIZE);
  // Shot: start x, z and direction x, z (unit, on the ground plan) and length. Blast: x, z and radius.
  private data = new Float64Array(SIZE * 5);
  private next = 0;

  constructor(private seconds: number, private shotMeters: number) {}

  shot(now: number, ox: number, oz: number, dx: number, dz: number, length: number): void {
    const flat = Math.hypot(dx, dz);
    if (flat < 1e-6) return;
    // The shot's length is along its 3D direction; on the ground plan it is shorter by the same share.
    this.write(now, 1, ox, oz, dx / flat, dz / flat, length * flat);
  }

  blast(now: number, x: number, z: number, radius: number): void {
    this.write(now, 2, x, z, radius, 0, 0);
  }

  // The way (radians, as atan2(z, x)) a tree at x, z should fall, from the newest hint that fits, or NaN for none.
  directionFor(now: number, x: number, z: number): number {
    for (let k = 1; k <= SIZE; k++) {
      const i = (this.next - k + SIZE) % SIZE;
      if (this.kind[i] === 0 || now - this.time[i]! > this.seconds) continue;
      const d = i * 5;
      const ax = this.data[d]!, az = this.data[d + 1]!;
      if (this.kind[i] === 1) {
        const dx = this.data[d + 2]!, dz = this.data[d + 3]!, length = this.data[d + 4]!;
        const along = (x - ax) * dx + (z - az) * dz;
        if (along < 0 || along > length + this.shotMeters) continue;
        const across = Math.abs((x - ax) * dz - (z - az) * dx);
        if (across <= this.shotMeters) return Math.atan2(dz, dx);
      } else {
        const radius = this.data[d + 2]!;
        const ox = x - ax, oz = z - az;
        if (ox * ox + oz * oz > radius * radius) continue;
        // Right on top of the blast there is no "away": any way will do, so take the next hint or none.
        if (ox * ox + oz * oz > 0.01) return Math.atan2(oz, ox);
      }
    }
    return Number.NaN;
  }

  private write(now: number, kind: number, a: number, b: number, c: number, d: number, e: number): void {
    const i = this.next;
    this.kind[i] = kind;
    this.time[i] = now;
    const at = i * 5;
    this.data[at] = a; this.data[at + 1] = b; this.data[at + 2] = c; this.data[at + 3] = d; this.data[at + 4] = e;
    this.next = (i + 1) % SIZE;
  }
}
