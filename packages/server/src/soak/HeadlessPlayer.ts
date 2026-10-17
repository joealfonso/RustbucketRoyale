import {
  Predictor, STEP, createMechInput, createRingNow, decodeServerBinary, encodeInput, encodeServerBinary, generateMap,
  ringAt, type BotConfig, type ChunkSet, type PropConfig, type PropInstance, type InputMessage, type MechStats, type RingSchedule, type ServerMessage, type TierSet, type World,
} from "@rustbucket/shared";
import { Bot, type BotTarget } from "../Bot";
import { Pathfinder } from "../Pathfinder";
import type { Room } from "../Room";

type Snapshot = Extract<ServerMessage, { t: "snapshot" }>;

// A pretend person for the soak test. A bot brain does the deciding, but everything else is what a real browser
// does: it builds the map from the seed it is sent, predicts its own mech, sends packed inputs, reads packed snapshots,
// and replays its inputs on each one. If prediction and the server ever drift apart, `worstCorrection` shows it.
export class HeadlessPlayer {
  id = 0;
  bytesReceived = 0;
  worstCorrection = 0;
  corrections = 0;
  places: number[] = []; // every place handed out by an elimination message
  winnerSeen = false;
  private predictor: Predictor | null = null;
  private brain: Bot | null = null;
  private world: World | null = null;
  private props: PropInstance[] = [];
  private seed = -1;
  private tier = "";
  private ring: RingSchedule | null = null;
  private ringNow = createRingNow();
  private last: Snapshot | null = null;
  private input = createMechInput();
  private message: InputMessage = { t: "input", seq: 0, ...createMechInput() };
  private settleSnapshots = 0; // a big jump right after a respawn or a new map is expected, so the next few are not judged
  private wasDead = false;
  private wasCrawling = false;

  constructor(
    private room: Room,
    private mech: MechStats,
    private bots: BotConfig,
    private chunks: ChunkSet,
    private tiers: TierSet,
    private propConfig: PropConfig,
    private random: () => number,
  ) {
    this.id = room.join((m) => this.receive(m)) ?? 0;
  }

  // Everything goes through the packed format and back, exactly as it would over the wire.
  private receive(m: ServerMessage): void {
    const packed = encodeServerBinary(m);
    this.bytesReceived += packed ? packed.length : JSON.stringify(m).length;
    const message = packed ? decodeServerBinary(packed)! : m;

    if (message.t === "welcome" || message.t === "room") this.useMap(message.seed, message.tier);
    if (message.t === "room") { this.ring = message.ring; this.settleSnapshots = 3; }
    if (message.t === "snapshot") this.onSnapshot(message);
    // A destroyed prop leaves this player's world too, as in the browser, or prediction walks into walls that are gone.
    if (message.t === "prop") this.breakProp(message.id);
    if (message.t === "props") for (const id of message.destroyed) this.breakProp(id);
    if (message.t === "eliminated") this.places.push(message.place);
    if (message.t === "result") this.winnerSeen = true;
  }

  private useMap(seed: number, tier: string): void {
    if (seed === this.seed && tier === this.tier) return;
    this.seed = seed;
    this.tier = tier;
    const map = generateMap(seed, tier, this.chunks, this.tiers, this.mech, this.propConfig);
    this.world = map.world;
    this.props = map.props;
    const finder = new Pathfinder(map.nav, this.bots.path);
    if (!this.predictor) {
      this.predictor = new Predictor(this.mech, map.world, ...map.spawns[0]!, Math.PI);
      this.brain = new Bot(this.bots.difficulties.normal!, this.random, this.bots.path, finder);
    } else {
      this.predictor.setWorld(map.world);
      this.brain!.setFinder(finder);
    }
    this.settleSnapshots = 3;
  }

  private breakProp(id: number): void {
    const prop = this.props[id];
    if (prop && this.world) this.world.disable(prop.boxIndex);
  }

  private onSnapshot(snap: Snapshot): void {
    if (!this.predictor) return;
    const error = this.predictor.reconcile(snap.ack, snap.you, STEP);
    // Legs breaking is only known from the snapshot that reports it, so the inputs already predicted at walk speed
    // get one unavoidable correction then, like a respawn.
    if (snap.health.dead !== this.wasDead || snap.you.crawling !== this.wasCrawling) this.settleSnapshots = 3;
    this.wasDead = snap.health.dead;
    this.wasCrawling = snap.you.crawling;
    if (this.settleSnapshots > 0) this.settleSnapshots--;
    else {
      this.worstCorrection = Math.max(this.worstCorrection, error);
      this.corrections++;
    }
    this.last = snap;
  }

  // One client step: think, predict, send.
  step(): void {
    const snap = this.last;
    if (!this.predictor || !this.brain || !this.world || !snap) return;
    const input = this.input;

    const targets: BotTarget[] = snap.others.filter((o) => !o.dead).map((o) => ({ id: o.id, x: o.x, y: o.y, z: o.z }));
    const ring = this.ring && snap.match.state === "active" ? ringAt(this.ring, snap.match.seconds, this.ringNow) : null;
    this.brain.think(this.predictor.state, targets, ring, this.world, STEP, input);
    // The same rules the browser applies before sending.
    if (snap.health.dead || snap.match.state === "countdown") {
      input.moveX = 0; input.moveY = 0; input.run = false; input.jet = false; input.dash = false; input.fire = false; input.grenade = false;
    }
    input.aimYaw = Math.fround(input.aimYaw);
    input.aimPitch = Math.fround(input.aimPitch);
    input.targetX = Math.fround(input.targetX); input.targetY = Math.fround(input.targetY); input.targetZ = Math.fround(input.targetZ);
    // Sticks are whole steps on a keyboard, so round the brain's analogue choice to what keys could send.
    input.moveX = Math.round(input.moveX);
    input.moveY = Math.round(input.moveY);

    const seq = this.predictor.step(input, STEP);
    // Knocked out, it watches the first mech still standing in what it was last sent, like the browser does.
    const watchId = snap.health.dead ? (snap.others.find((o) => !o.dead)?.id ?? 0) : undefined;
    Object.assign(this.message, input, { t: "input", seq, lagMs: 20, watchId });
    this.room.receive(this.id, encodeInput(this.message, input.fire || input.grenade));
  }
}
