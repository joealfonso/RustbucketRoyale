// How far a blast the server reported reaches. The explode message carries only a spot, so the client works out
// what went off from what it saw just before: a barrel broken right there, or a mortar strike called on that spot.
// Anything else is a grenade. Guessing costs nothing here: a wrong guess only draws a slightly wrong size.

const REMEMBERED = 8; // more barrels or strikes than this at once and the oldest is forgotten
const BARREL_REACH = 1.5; // metres a blast can be from where a barrel stood, or past a strike's spread, and still be it

interface Mark { x: number; z: number; reach: number; until: number; radius: number }

export class BlastSizes {
  private barrels: Mark[] = [];
  private strikes: Mark[] = [];
  private nextBarrel = 0;
  private nextStrike = 0;

  constructor(private grenadeRadius: number, private barrelRadius: number) {
    for (let i = 0; i < REMEMBERED; i++) {
      this.barrels.push({ x: 0, z: 0, reach: 0, until: -1, radius: 0 });
      this.strikes.push({ x: 0, z: 0, reach: 0, until: -1, radius: 0 });
    }
  }

  // A barrel broke here, at `now` seconds. It goes off a beat later, so it is remembered for `seconds`.
  barrel(x: number, z: number, now: number, seconds: number): void {
    const m = this.barrels[this.nextBarrel]!;
    this.nextBarrel = (this.nextBarrel + 1) % REMEMBERED;
    m.x = x; m.z = z; m.reach = BARREL_REACH; m.until = now + seconds; m.radius = this.barrelRadius;
  }

  // A strike was called here: shells land within `spread` metres of it for `seconds`, each reaching `radius`.
  strike(x: number, z: number, spread: number, now: number, seconds: number, radius: number): void {
    const m = this.strikes[this.nextStrike]!;
    this.nextStrike = (this.nextStrike + 1) % REMEMBERED;
    m.x = x; m.z = z; m.reach = spread + BARREL_REACH; m.until = now + seconds; m.radius = radius;
  }

  radiusAt(x: number, z: number, now: number): number {
    for (const m of this.barrels) if (now <= m.until && Math.hypot(x - m.x, z - m.z) <= m.reach) return m.radius;
    for (const m of this.strikes) if (now <= m.until && Math.hypot(x - m.x, z - m.z) <= m.reach) return m.radius;
    return this.grenadeRadius;
  }
}
