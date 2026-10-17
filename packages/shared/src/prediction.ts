import type { MechInput } from "./MechInput";
import { createMechInput } from "./MechInput";
import { createMechState, stepMech, type MechState } from "./mechStep";
import { readSelf } from "./mechWire";
import type { SelfState } from "./protocol";
import type { MechStats } from "./stats";
import type { Box } from "./world";

// Must be larger than the most inputs that can be in flight, about two seconds at 60 Hz.
const HISTORY = 256;

// Client side prediction. The client steps its own mech at once with the same code as the server,
// remembers each input, and when a server snapshot arrives it rewinds to the server's state and
// replays every input the server has not processed yet. With matching code the correction is near zero.
export class Predictor {
  readonly state: MechState;
  seq = 0;
  // How far the replay moved the mech. The renderer fades this out instead of snapping.
  correctionX = 0;
  correctionY = 0;
  correctionZ = 0;

  private ring: MechInput[] = [];

  constructor(private stats: MechStats, private boxes: readonly Box[], x: number, y: number, z: number, yaw: number) {
    this.state = createMechState(stats, x, y, z, yaw);
    for (let i = 0; i < HISTORY; i++) this.ring.push(createMechInput());
  }

  // Steps the mech one tick with this input and returns its sequence number.
  step(input: MechInput, dt: number): number {
    this.seq++;
    Object.assign(this.ring[this.seq % HISTORY]!, input);
    stepMech(this.state, input, this.stats, dt, this.boxes);
    return this.seq;
  }

  // Returns how far the mech moved, in metres, because of the correction.
  reconcile(ack: number, server: SelfState, dt: number): number {
    const beforeX = this.state.x, beforeY = this.state.y, beforeZ = this.state.z;
    readSelf(this.state, server);

    // If the history was overwritten the replay would be wrong, so trust the server and move on.
    if (this.seq - ack < HISTORY) {
      for (let s = ack + 1; s <= this.seq; s++) {
        stepMech(this.state, this.ring[s % HISTORY]!, this.stats, dt, this.boxes);
      }
    }

    this.correctionX = beforeX - this.state.x;
    this.correctionY = beforeY - this.state.y;
    this.correctionZ = beforeZ - this.state.z;
    return Math.hypot(this.correctionX, this.correctionY, this.correctionZ);
  }
}
