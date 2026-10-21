import type { AbilityStats } from "./abilities";
import type { MechInput } from "./MechInput";
import { createMechInput } from "./MechInput";
import { createMechState, startPull, stepMech, type MechState } from "./mechStep";
import { readSelf } from "./mechWire";
import type { SelfState } from "./protocol";
import type { MechStats } from "./stats";
import type { World } from "./world";

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
  // Pulls to start right after a given step (gate 18b: your own reel), by seq in the same ring as the inputs. Stored
  // as where to and how, so a replay from a corrected state starts the pull from there, as the server did.
  private pulls: { seq: number; x: number; y: number; z: number; speed: number; seconds: number; stop: number; lift: number }[] = [];

  // `statsFor` gives the stats of a roster mech: the mech number comes with every snapshot, so a replay always
  // steps with the stats of the mech the server was stepping. `abilityFor` does the same for its Q ability.
  constructor(
    private statsFor: (mech: number) => MechStats, private world: World, x: number, y: number, z: number, yaw: number,
    private abilityFor: (mech: number) => AbilityStats | null = () => null,
  ) {
    this.state = createMechState(statsFor(0), x, y, z, yaw);
    for (let i = 0; i < HISTORY; i++) {
      this.ring.push(createMechInput());
      this.pulls.push({ seq: -1, x: 0, y: 0, z: 0, speed: 0, seconds: 0, stop: 0, lift: 0 });
    }
  }

  // A new match brings a new map. The mech keeps its history, the next snapshot puts it in the right place.
  setWorld(world: World): void {
    this.world = world;
  }

  // Called after every predicted step, replays included, for what the server does to the world right after it steps
  // a mech: a ram smashing the props it drives into.
  afterStep: ((state: MechState) => void) | null = null;

  // Steps the mech one tick with this input and returns its sequence number.
  step(input: MechInput, dt: number): number {
    this.seq++;
    Object.assign(this.ring[this.seq % HISTORY]!, input);
    stepMech(this.state, input, this.statsFor(this.state.mech), dt, this.world, this.abilityFor(this.state.mech));
    this.afterStep?.(this.state);
    this.startPullFor(this.seq);
    return this.seq;
  }

  // Starts a pull (mechStep.ts startPull) right after step `seq` is stepped, now and in every replay of it, which is
  // when the server starts it. `seq` must be later than the current one.
  pullAfter(seq: number, x: number, y: number, z: number, speed: number, seconds: number, stop: number, lift: number): void {
    Object.assign(this.pulls[seq % HISTORY]!, { seq, x, y, z, speed, seconds, stop, lift });
  }

  private startPullFor(seq: number): void {
    const p = this.pulls[seq % HISTORY]!;
    if (p.seq === seq) startPull(this.state, p.x, p.y, p.z, p.speed, p.seconds, p.stop, p.lift);
  }

  // Returns how far the mech moved, in metres, because of the correction.
  reconcile(ack: number, server: SelfState, dt: number): number {
    const beforeX = this.state.x, beforeY = this.state.y, beforeZ = this.state.z;
    readSelf(this.state, server);

    // If the history was overwritten the replay would be wrong, so trust the server and move on.
    if (this.seq - ack < HISTORY) {
      for (let s = ack + 1; s <= this.seq; s++) {
        stepMech(this.state, this.ring[s % HISTORY]!, this.statsFor(this.state.mech), dt, this.world, this.abilityFor(this.state.mech));
        this.afterStep?.(this.state);
        this.startPullFor(s);
      }
    }

    this.correctionX = beforeX - this.state.x;
    this.correctionY = beforeY - this.state.y;
    this.correctionZ = beforeZ - this.state.z;
    return Math.hypot(this.correctionX, this.correctionY, this.correctionZ);
  }
}
