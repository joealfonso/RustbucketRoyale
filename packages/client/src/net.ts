import { SnapshotMemory, decodeServerBinary, encodeInput, type RejoinMessage, type AbilityMessage, type ExplodeMessage, type TitanMessage, GrenadeMessage, HitMessage, InputMessage, MechInput, ServerMessage } from "@rustbucket/shared";

type SnapshotMessage = Extract<ServerMessage, { t: "snapshot" }>;
type ShotMessage = Extract<ServerMessage, { t: "shot" }>;
type RoomMessage = Extract<ServerMessage, { t: "room" }>;
type EliminatedMessage = Extract<ServerMessage, { t: "eliminated" }>;
type ResultMessage = Extract<ServerMessage, { t: "result" }>;

const RETRY_MS = 1000; // between tries to reconnect

// Who this player is in a room, enough to get their mech back.
export interface Session {
  code: string;
  id: number;
  token: string;
}

// The address to come back on: the same server, this room by its code, and nothing else from the first address
// (which may say `create`).
export function rejoinAddress(url: string, roomCode: string): string {
  const address = new URL(url);
  address.search = `?room=${encodeURIComponent(roomCode)}&rejoin`;
  return address.toString();
}

// The browser side of the connection. Sends one input per sim step and hands snapshots and shots to the game.
export class NetClient {
  id = 0;
  open = false;
  onSnapshot?: (snapshot: SnapshotMessage) => void;
  onShot?: (shot: ShotMessage) => void;
  onHit?: (hit: HitMessage) => void;
  onGrenade?: (grenade: GrenadeMessage) => void;
  onExplode?: (explosion: ExplodeMessage) => void;
  onAbility?: (moment: AbilityMessage) => void;
  onTitan?: (moment: TitanMessage) => void; // the Junk Titan's stomps, thrown cars and fall (gate 13c)
  // The newest room message is kept, so a handler attached late (while the map is still being built) still gets it.
  private latestRoom: RoomMessage | null = null;
  private roomHandler?: (room: RoomMessage) => void;
  set onRoom(handler: ((room: RoomMessage) => void) | undefined) {
    this.roomHandler = handler;
    if (handler && this.latestRoom) handler(this.latestRoom);
  }
  onEliminated?: (out: EliminatedMessage) => void;
  onResult?: (result: ResultMessage) => void;
  // `quiet` for props that broke before you joined (the list sent on arrival): no falling, flying or noise.
  onPropDestroyed?: (id: number, quiet: boolean) => void;
  onClose?: (reason: string) => void;
  onNotice?: (text: string) => void;
  // A dropped connection mid game: true while trying to get back to the same mech, false once back.
  onReconnecting?: (trying: boolean) => void;
  // Back too late, the match moved on: the game should join the room afresh.
  onRejoinFailed?: () => void;

  // Resolves with the map to build once the server says hello, or rejects if it never does.
  readonly welcome: Promise<{ seed: number; tier: string; code: string; tuning: boolean }>;
  onTuned?: (file: string, path: string, value: number) => void;
  // The round trip to the server, with the time it held the input before answering taken off.
  rttMs = 0;
  // Set by the game so each input can say how far behind its view of other mechs is.
  viewDelayMs: () => number = () => 0;
  // Set by the game: the mech being watched while knocked out, or 0.
  watchId: () => number = () => 0;
  private sentAt = new Float64Array(256);
  private socket!: WebSocket;
  private memory = new SnapshotMemory(); // what this connection was last sent, which snapshots are changes from
  private rejoinToken = "";
  private roomCode = ""; // from the welcome: a page that made its room has no code in its first address
  private giveUpAt = 0; // while reconnecting, when to stop trying
  private stopped = false; // refused, or gave up: no more tries
  private welcomed: (map: { seed: number; tier: string; code: string; tuning: boolean }) => void = () => {};
  private failed: (reason: Error) => void = () => {};
  // Reused every send so the frame loop does not build a new object each time.
  private message: InputMessage = {
    t: "input", seq: 0, moveX: 0, moveY: 0, aimYaw: 0, aimPitch: 0,
    run: false, jet: false, dash: false, fire: false, grenade: false, slot: 0, interact: false, repair: false, ability: false, targetX: 0, targetY: 0, targetZ: 0,
  };

  // `graceSeconds`: how long the server holds a dropped mech (net.json rejoinGraceSeconds), so how long to keep trying.
  // `resume`: who this tab was in this room before the page reloaded. It tries to get that mech back first, and joins
  // afresh if the server says it is too late.
  constructor(private url: string, private graceSeconds = 20, resume: Session | null = null) {
    this.welcome = new Promise((resolve, reject) => { this.welcomed = resolve; this.failed = reject; });
    if (resume) {
      this.id = resume.id;
      this.rejoinToken = resume.token;
      this.roomCode = resume.code;
    }
    this.connect(resume !== null);
  }

  // Called with every welcome, so the game can keep it for a reload (sessionStorage).
  onSession?: (session: Session) => void;
  private hasWelcome = false;

  // Opens a socket. On a rejoin it first says who this was, before anything else is sent.
  private connect(rejoin: boolean): void {
    const url = this.url;
    const socket = new WebSocket(rejoin ? rejoinAddress(url, this.roomCode) : url);
    this.socket = socket;
    this.memory = new SnapshotMemory(); // a new connection starts from nothing on both sides
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (rejoin) socket.send(JSON.stringify({ t: "rejoin", id: this.id, token: this.rejoinToken } satisfies RejoinMessage));
      this.open = true;
    };
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.open = false;
      if (this.stopped) return;
      // Dropped after joining: try to get back to the same mech while the server still holds it.
      if (this.hasWelcome && this.rejoinToken) {
        if (this.giveUpAt === 0) { this.giveUpAt = performance.now() + this.graceSeconds * 1000; this.onReconnecting?.(true); }
        if (performance.now() < this.giveUpAt) { setTimeout(() => this.connect(true), RETRY_MS); return; }
        this.stopped = true;
        this.onRejoinFailed?.();
        return;
      }
      this.failed(new Error("The server closed the connection."));
      this.onClose?.("The server closed the connection.");
    };
    // A failed try while reconnecting is followed by its close, which tries again.
    socket.onerror = () => {
      if (this.hasWelcome) return;
      this.failed(new Error(`Could not reach the server at ${url}.`));
      this.onClose?.(`Could not reach the server at ${url}.`);
    };
    socket.onmessage = (event) => {
      // Snapshots and shots arrive packed, everything else as text.
      const message = event.data instanceof ArrayBuffer ? decodeServerBinary(new Uint8Array(event.data), this.memory) : (JSON.parse(event.data as string) as ServerMessage);
      if (!message) return;
      if (message.t === "welcome") {
        const back = this.hasWelcome;
        this.hasWelcome = true;
        this.id = message.id;
        this.rejoinToken = message.rejoin;
        this.roomCode = message.code;
        this.onSession?.({ code: message.code, id: message.id, token: message.rejoin });
        if (back) { this.giveUpAt = 0; this.onReconnecting?.(false); }
        else this.welcomed({ seed: message.seed, tier: message.tier, code: message.code, tuning: message.tuning });
      }
      else if (message.t === "tuned") this.onTuned?.(message.file, message.path, message.value);
      else if (message.t === "notice") this.onNotice?.(message.text);
      else if (message.t === "snapshot") this.onSnapshot?.(message);
      else if (message.t === "shot") this.onShot?.(message);
      else if (message.t === "room") { this.latestRoom = message; this.roomHandler?.(message); }
      else if (message.t === "eliminated") this.onEliminated?.(message);
      else if (message.t === "result") this.onResult?.(message);
      else if (message.t === "prop") this.onPropDestroyed?.(message.id, false);
      else if (message.t === "props") for (const id of message.destroyed) this.onPropDestroyed?.(id, true);
      else if (message.t === "hit") this.onHit?.(message);
      else if (message.t === "grenade") this.onGrenade?.(message);
      else if (message.t === "explode") this.onExplode?.(message);
      else if (message.t === "ability") this.onAbility?.(message);
      else if (message.t === "titan") this.onTitan?.(message);
      else if (message.t === "refused") {
        if (message.rejoinFailed && !this.hasWelcome) {
          // A reloaded page that was too late: just join the room.
          this.rejoinToken = "";
          this.connect(false);
          return;
        }
        this.stopped = true;
        if (message.rejoinFailed) { this.onRejoinFailed?.(); return; }
        this.failed(new Error(message.reason));
        this.onClose?.(message.reason);
      }
    };
  }

  // Dev only: asks the server to change one number in a data file for this room.
  sendTune(file: string, path: string, value: number): void {
    if (this.open) this.socket.send(JSON.stringify({ t: "tune", file, path, value }));
  }

  sendMech(mech: number): void {
    if (this.open) this.socket.send(JSON.stringify({ t: "mech", mech }));
  }

  sendStart(): void {
    if (this.open) this.socket.send(JSON.stringify({ t: "start" }));
  }

  // Call for every snapshot: works out the round trip from when the acknowledged input was sent.
  noteSnapshot(ack: number, ackAgeMs: number, nowMs: number): void {
    if (ack <= 0) return;
    const sample = nowMs - this.sentAt[ack & 255]! - ackAgeMs;
    if (sample < 0 || sample > 2000) return;
    this.rttMs = this.rttMs === 0 ? sample : this.rttMs + (sample - this.rttMs) * 0.2;
  }

  sendInput(seq: number, input: MechInput): void {
    if (!this.open) return;
    this.sentAt[seq & 255] = performance.now();
    const m = this.message;
    m.seq = seq;
    m.lagMs = this.rttMs + this.viewDelayMs();
    const watching = this.watchId();
    m.watchId = watching > 0 ? watching : undefined;
    m.moveX = input.moveX; m.moveY = input.moveY;
    m.aimYaw = input.aimYaw; m.aimPitch = input.aimPitch;
    m.run = input.run; m.jet = input.jet; m.dash = input.dash; m.fire = input.fire; m.grenade = input.grenade; m.slot = input.slot; m.interact = input.interact; m.repair = input.repair; m.ability = input.ability;
    m.targetX = input.targetX; m.targetY = input.targetY; m.targetZ = input.targetZ;
    // The aim point only matters on a step that shoots, throws or pounces, so it is left out of the rest.
    this.socket.send(encodeInput(m, input.fire || input.grenade).buffer as ArrayBuffer);
  }
}
