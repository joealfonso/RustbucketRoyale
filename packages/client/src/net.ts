import type { ExplodeMessage, GrenadeMessage, HitMessage, InputMessage, MechInput, ServerMessage } from "@rustbucket/shared";

type SnapshotMessage = Extract<ServerMessage, { t: "snapshot" }>;
type ShotMessage = Extract<ServerMessage, { t: "shot" }>;
type RoomMessage = Extract<ServerMessage, { t: "room" }>;
type EliminatedMessage = Extract<ServerMessage, { t: "eliminated" }>;
type ResultMessage = Extract<ServerMessage, { t: "result" }>;

// The browser side of the connection. Sends one input per sim step and hands snapshots and shots to the game.
export class NetClient {
  id = 0;
  open = false;
  onSnapshot?: (snapshot: SnapshotMessage) => void;
  onShot?: (shot: ShotMessage) => void;
  onHit?: (hit: HitMessage) => void;
  onGrenade?: (grenade: GrenadeMessage) => void;
  onExplode?: (explosion: ExplodeMessage) => void;
  // The newest room message is kept, so a handler attached late (while the map is still being built) still gets it.
  private latestRoom: RoomMessage | null = null;
  private roomHandler?: (room: RoomMessage) => void;
  set onRoom(handler: ((room: RoomMessage) => void) | undefined) {
    this.roomHandler = handler;
    if (handler && this.latestRoom) handler(this.latestRoom);
  }
  onEliminated?: (out: EliminatedMessage) => void;
  onResult?: (result: ResultMessage) => void;
  onClose?: (reason: string) => void;

  // Resolves with the map to build once the server says hello, or rejects if it never does.
  readonly welcome: Promise<{ seed: number; tier: string; code: string }>;
  private socket: WebSocket;
  // Reused every send so the frame loop does not build a new object each time.
  private message: InputMessage = {
    t: "input", seq: 0, moveX: 0, moveY: 0, aimYaw: 0, aimPitch: 0,
    run: false, jet: false, dash: false, fire: false, grenade: false, targetX: 0, targetY: 0, targetZ: 0,
  };

  constructor(url: string) {
    let welcomed: (map: { seed: number; tier: string; code: string }) => void = () => {};
    let failed: (reason: Error) => void = () => {};
    this.welcome = new Promise((resolve, reject) => { welcomed = resolve; failed = reject; });
    this.socket = new WebSocket(url);
    this.socket.onopen = () => { this.open = true; };
    this.socket.onclose = () => { this.open = false; failed(new Error("The server closed the connection.")); this.onClose?.("The server closed the connection."); };
    this.socket.onerror = () => { failed(new Error(`Could not reach the server at ${url}.`)); this.onClose?.(`Could not reach the server at ${url}.`); };
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.t === "welcome") { this.id = message.id; welcomed({ seed: message.seed, tier: message.tier, code: message.code }); }
      else if (message.t === "snapshot") this.onSnapshot?.(message);
      else if (message.t === "shot") this.onShot?.(message);
      else if (message.t === "room") { this.latestRoom = message; this.roomHandler?.(message); }
      else if (message.t === "eliminated") this.onEliminated?.(message);
      else if (message.t === "result") this.onResult?.(message);
      else if (message.t === "hit") this.onHit?.(message);
      else if (message.t === "grenade") this.onGrenade?.(message);
      else if (message.t === "explode") this.onExplode?.(message);
      else if (message.t === "refused") { failed(new Error(message.reason)); this.onClose?.(message.reason); }
    };
  }

  sendStart(): void {
    if (this.open) this.socket.send(JSON.stringify({ t: "start" }));
  }

  sendInput(seq: number, input: MechInput): void {
    if (!this.open) return;
    const m = this.message;
    m.seq = seq;
    m.moveX = input.moveX; m.moveY = input.moveY;
    m.aimYaw = input.aimYaw; m.aimPitch = input.aimPitch;
    m.run = input.run; m.jet = input.jet; m.dash = input.dash; m.fire = input.fire; m.grenade = input.grenade;
    m.targetX = input.targetX; m.targetY = input.targetY; m.targetZ = input.targetZ;
    this.socket.send(JSON.stringify(m));
  }
}
