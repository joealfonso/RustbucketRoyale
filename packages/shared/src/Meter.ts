// A resource that drains while used, waits, then refills. Used for jet fuel and run stamina.
// When it hits empty it locks until it has refilled past unlockFraction, so jets do not flutter at zero.
export class Meter {
  value: number;
  locked = false;
  regenTimer = 0; // public so prediction can copy it from a server snapshot

  constructor(public max: number) {
    this.value = max;
  }

  get fraction(): number {
    return this.max > 0 ? this.value / this.max : 0;
  }

  get canUse(): boolean {
    return !this.locked && this.value > 0;
  }

  drain(amount: number, regenDelay: number): void {
    this.value = Math.max(0, this.value - amount);
    this.regenTimer = regenDelay;
    if (this.value <= 0) this.locked = true;
  }

  regen(perSecond: number, dt: number, unlockFraction: number): void {
    if (this.regenTimer > 0) {
      this.regenTimer -= dt;
      return;
    }
    this.value = Math.min(this.max, this.value + perSecond * dt);
    if (this.locked && this.fraction >= unlockFraction) this.locked = false;
  }

  // The debug panel can change max live, so keep value inside it.
  setMax(max: number): void {
    this.max = max;
    this.value = Math.min(this.value, max);
  }
}
