import type * as THREE from "three";
import type { AbilityMessage, HealthState, MechState, Shot, TitanMessage, World } from "@rustbucket/shared";
import { createShot } from "@rustbucket/shared";
import { setMechDamage, type MechModel } from "./mechModel";
import { damageDiffers, type RemoteMechs } from "./remoteMechs";
import { ABILITY, EXPLODE, GRENADE, ReplayEvents, SHOT, TITAN } from "./replayEvents";
import { ReplayFrames, createDrawnMech, type Bracket, type DrawnMech } from "./replayFrames";
import { createCameraPose, followPose, keepOutOfWalls, replayCameraPose, type ReplayCameraConfig } from "./replayCamera";

// The kill replay (gate 13b): knocked out by a mech, you see the last few seconds again from over its shoulder,
// then watch it. Every frame of what this screen drew is recorded (replayFrames.ts, replayEvents.ts); the replay
// moves the same models and fires the same effects from that recording. Numbers in data/replay.json.

export interface ReplayConfig {
  keepSeconds: number; // how much is recorded
  sampleHz: number; // recorded frames a second; the replay blends between them
  maxMechs: number; // per frame, a guard well above what the interest range sends
  maxEvents: number;
  playSeconds: number; // how much of the recording is played
  afterSeconds: number; // of that, how much comes after the knockout, so the replay shows you going down
  minKillerSeconds: number; // a killer seen for less than this before the knockout gets no replay
  speed: number;
  slowMotion: { beforeSeconds: number; afterSeconds: number; speed: number }; // around the knockout
  camera: ReplayCameraConfig;
}

export function parseReplay(raw: unknown): ReplayConfig {
  const d = raw as ReplayConfig;
  const positive = (where: string, o: Record<string, unknown>, keys: readonly string[]) => {
    for (const key of keys) if (typeof o?.[key] !== "number" || !((o[key] as number) > 0)) throw new Error(`replay.json: ${where}${key} must be a number above 0`);
  };
  const atLeastZero = (where: string, o: Record<string, unknown>, keys: readonly string[]) => {
    for (const key of keys) if (typeof o?.[key] !== "number" || !((o[key] as number) >= 0)) throw new Error(`replay.json: ${where}${key} must be a number, 0 or more`);
  };
  const top = d as unknown as Record<string, unknown>;
  positive("", top, ["keepSeconds", "sampleHz", "maxMechs", "maxEvents", "playSeconds", "speed"]);
  atLeastZero("", top, ["afterSeconds", "minKillerSeconds"]);
  positive("slowMotion.", d.slowMotion as unknown as Record<string, unknown>, ["speed"]);
  atLeastZero("slowMotion.", d.slowMotion as unknown as Record<string, unknown>, ["beforeSeconds", "afterSeconds"]);
  const camera = d.camera as unknown as Record<string, unknown>;
  positive("camera.", camera, ["sharpness"]);
  atLeastZero("camera.", camera, ["pivotHeightMeters", "backMeters", "lookHeightMeters", "closeMeters", "wallMarginMeters"]);
  for (const key of ["upMeters", "shoulderMeters"]) if (typeof camera[key] !== "number" || !Number.isFinite(camera[key])) throw new Error(`replay.json: camera.${key} must be a number`);
  if (!Number.isInteger(d.maxMechs) || d.maxMechs > 65535) throw new Error("replay.json: maxMechs must be a whole number up to 65535");
  if (!Number.isInteger(d.maxEvents)) throw new Error("replay.json: maxEvents must be a whole number");
  if (d.playSeconds > d.keepSeconds) throw new Error("replay.json: playSeconds cannot be more than keepSeconds");
  if (d.afterSeconds >= d.playSeconds) throw new Error("replay.json: afterSeconds must be less than playSeconds");
  return d;
}

// How fast the recording plays at a moment of it: slower around the knockout, so the hit that did it can be seen.
export function playbackSpeed(timeMs: number, knockoutMs: number, c: ReplayConfig): number {
  const slow = c.slowMotion;
  return timeMs >= knockoutMs - slow.beforeSeconds * 1000 && timeMs < knockoutMs + slow.afterSeconds * 1000 ? slow.speed : c.speed;
}

// How long a stretch of the recording takes on screen, in seconds, with the slow part.
export function screenSeconds(fromMs: number, toMs: number, knockoutMs: number, c: ReplayConfig): number {
  const slow = c.slowMotion;
  const slowMs = Math.max(0, Math.min(toMs, knockoutMs + slow.afterSeconds * 1000) - Math.max(fromMs, knockoutMs - slow.beforeSeconds * 1000));
  const normalMs = Math.max(0, toMs - fromMs - slowMs);
  return (normalMs / c.speed + slowMs / slow.speed) / 1000;
}

// Where in the recording the replay starts: `playSeconds` before its end, or later if the killer only came into view
// later. NaN for no replay: never seen, or seen too briefly to make a clip of.
export function replayStart(knockoutMs: number, killerFirstSeenMs: number, c: ReplayConfig): number {
  if (Number.isNaN(killerFirstSeenMs)) return Number.NaN;
  const start = Math.max(knockoutMs + (c.afterSeconds - c.playSeconds) * 1000, killerFirstSeenMs);
  return knockoutMs - start < c.minKillerSeconds * 1000 ? Number.NaN : start;
}

type Phase = "idle" | "waiting" | "playing";

export class KillReplay {
  readonly frames: ReplayFrames;
  readonly events: ReplayEvents;
  // Your own mech's motion at the moment being played, for its walk, as walkRemote takes it.
  readonly own: DrawnMech;
  // Where the killer is in the replay, for whatever follows the view (the map's detail, the radar).
  readonly focus = { x: 0, y: 0, z: 0 };
  // The recorded effects, fired again as the replay reaches them. Wired to the same functions the live ones use.
  onShot?: (id: number, shot: Shot, weapon: number, hitMech: boolean) => void;
  onExplode?: (x: number, y: number, z: number) => void;
  onGrenade?: (id: number, x: number, y: number, z: number, vx: number, vy: number, vz: number) => void;
  onAbility?: (moment: AbilityMessage) => void;
  onTitan?: (moment: TitanMessage) => void;
  // Your mech goes down in the replay, for the blow-apart. (awayX, awayZ) is the way the killer's blow pushed it.
  onVictimDown?: (model: MechModel, awayX: number, awayZ: number) => void;
  // The replay is over, played out or skipped: time to watch the killer.
  onEnd?: (killerId: number) => void;

  private phase: Phase = "idle";
  private killer = 0;
  private victim = 0;
  private knockoutAt = 0;
  private startAt = 0;
  private endAt = 0;
  private time = 0; // the moment of the recording on screen
  private firedUpTo = 0; // effects up to this moment have been fired
  private shown = 0; // seconds on screen so far
  private total = 0;
  private skipQueued = false;
  private snapCamera = true;
  private lastSampleAt = Number.NEGATIVE_INFINITY;
  private remotes: RemoteMechs | null = null;
  private ownModel: MechModel | null = null;
  private savedHp: number[];
  private savedDead = false;
  private bracket: Bracket = { a: 0, b: 0, t: 0 };
  private drawn: DrawnMech;
  private killerPose: DrawnMech;
  private wanted = createCameraPose();
  private current = createCameraPose();
  private shotOut: Shot = createShot();
  private abilityOut: AbilityMessage = { t: "ability", id: 0, kind: "ram", event: "start", x: 0, y: 0, z: 0 };
  private titanOut: TitanMessage = { t: "titan", event: "stomp", x: 0, y: 0, z: 0 };
  private recordRemote = (id: number, m: DrawnMech) => { if (id !== this.ownId) this.frames.add(id, m); }; // made once
  private ownId = 0;

  constructor(private config: ReplayConfig, zones: number) {
    this.frames = new ReplayFrames(Math.ceil(config.keepSeconds * config.sampleHz) + 2, config.maxMechs, zones);
    this.events = new ReplayEvents(config.maxEvents);
    this.own = createDrawnMech(zones);
    this.drawn = createDrawnMech(zones);
    this.killerPose = createDrawnMech(zones);
    this.savedHp = new Array<number>(zones).fill(0);
  }

  get playing(): boolean {
    return this.phase === "playing";
  }

  // Knocked out, the replay about to start: the recording carries on so the replay can show the moment itself.
  get waiting(): boolean {
    return this.phase === "waiting";
  }

  // Between your knockout and the end of the replay: the view and the clicks belong to the replay.
  get busy(): boolean {
    return this.phase !== "idle";
  }

  // How far through the replay is on screen, 0 to 1.
  get progress(): number {
    return this.phase === "playing" && this.total > 0 ? Math.min(1, this.shown / this.total) : 0;
  }

  // The moment of the recording on screen (the local clock it was recorded on), or null while none plays: the Junk
  // Titan keeps its own recording (titanView.ts) and draws itself at this moment.
  get clock(): number | null {
    return this.phase === "playing" ? this.time : null;
  }

  get killerId(): number {
    return this.killer;
  }

  // How fast the replay runs right now, 1 when none plays: effects can scale their own time by it in slow motion.
  get timeScale(): number {
    return this.phase === "playing" ? playbackSpeed(this.time, this.knockoutAt, this.config) : 1;
  }

  // Once a frame, after everyone is placed. Keeps `sampleHz` frames a second; nothing while the replay plays.
  record(nowMs: number, ownId: number, ownModel: MechModel, mech: Pick<MechState, "vx" | "vy" | "vz" | "jetting" | "running" | "abilityTime">, health: Pick<HealthState, "hp" | "dead">, remotes: RemoteMechs): void {
    if (this.phase === "playing" || nowMs - this.lastSampleAt < 1000 / this.config.sampleHz - 1) return;
    this.lastSampleAt = nowMs;
    this.ownId = ownId;
    this.frames.begin(nowMs);
    const own = this.drawn;
    const g = ownModel.group;
    own.x = g.position.x; own.y = g.position.y; own.z = g.position.z; own.yaw = g.rotation.y;
    own.vx = mech.vx; own.vy = mech.vy; own.vz = mech.vz;
    own.jetting = mech.jetting; own.running = mech.running; own.ability = mech.abilityTime > 0; own.dead = health.dead;
    for (let zone = 0; zone < own.hp.length; zone++) own.hp[zone] = health.hp[zone] ?? 0;
    this.frames.add(ownId, own);
    remotes.forEachDrawn(this.recordRemote);
  }

  // The effects, as they are shown live. Nothing is kept while the replay plays: it would record itself.
  shot(nowMs: number, id: number, shot: Shot, weapon: number, hitMech: boolean): void {
    if (this.phase !== "playing") this.events.shot(nowMs, id, shot, weapon, hitMech);
  }

  explode(nowMs: number, x: number, y: number, z: number): void {
    if (this.phase !== "playing") this.events.explode(nowMs, x, y, z);
  }

  grenade(nowMs: number, id: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    if (this.phase !== "playing") this.events.grenade(nowMs, id, x, y, z, vx, vy, vz);
  }

  ability(nowMs: number, moment: AbilityMessage): void {
    if (this.phase !== "playing") this.events.ability(nowMs, moment);
  }

  titan(nowMs: number, moment: TitanMessage): void {
    if (this.phase !== "playing") this.events.titan(nowMs, moment);
  }

  // You were knocked out. True if a replay will play: there was a killer and it was in view long enough.
  knockedOut(nowMs: number, victimId: number, killerId: number | null): boolean {
    this.cancel();
    if (killerId === null || killerId === victimId) return false;
    const c = this.config;
    const endAt = nowMs + c.afterSeconds * 1000;
    const start = replayStart(nowMs, this.frames.firstSeen(killerId, endAt - c.playSeconds * 1000, nowMs), c);
    if (Number.isNaN(start)) return false;
    this.killer = killerId;
    this.victim = victimId;
    this.knockoutAt = nowMs;
    this.startAt = start;
    this.endAt = endAt;
    this.phase = "waiting";
    return true;
  }

  // Ends the replay at once and goes to watching the killer. Only while it plays: in the fight just before, keys and
  // clicks are still the fight's.
  skip(): void {
    if (this.phase === "playing") this.skipQueued = true;
  }

  // Any key or click skips. Listens on its own, so the game's input needs no idea of it.
  listenForSkip(target: Pick<Window, "addEventListener">): void {
    target.addEventListener("keydown", (e) => { if (!(e as KeyboardEvent).repeat) this.skip(); });
    target.addEventListener("mousedown", () => this.skip());
  }

  // Stops without watching anyone: the match ended, or a new one is starting. Everyone is put back as they are now.
  cancel(): void {
    if (this.phase === "playing") this.handBack();
    this.phase = "idle";
    this.skipQueued = false;
  }

  // Forgets the recording, for a new match on a new map.
  clear(): void {
    this.cancel();
    this.frames.clear();
    this.events.clear();
    this.lastSampleAt = Number.NEGATIVE_INFINITY;
  }

  // Once a frame, after `remotes.update`. True while the replay draws this frame: then the caller leaves the camera,
  // and your own mech's walk (from `own`), to it.
  update(nowMs: number, dt: number, remotes: RemoteMechs, ownModel: MechModel, camera: THREE.PerspectiveCamera, world: Pick<World, "raycast">): boolean {
    if (this.phase === "waiting") {
      if (nowMs < this.endAt) return false;
      this.begin(remotes, ownModel);
    } else if (this.phase !== "playing") {
      return false;
    } else if (this.skipQueued) {
      this.finish();
      return false;
    } else {
      this.time += dt * 1000 * playbackSpeed(this.time, this.knockoutAt, this.config);
      this.shown += dt;
    }
    this.fireUpTo(Math.min(this.time, this.endAt));
    if (this.time >= this.endAt) {
      this.finish();
      return false;
    }
    this.draw(remotes, ownModel, camera, world, dt);
    return true;
  }

  private begin(remotes: RemoteMechs, ownModel: MechModel): void {
    this.phase = "playing";
    this.remotes = remotes;
    this.ownModel = ownModel;
    for (let zone = 0; zone < this.savedHp.length; zone++) this.savedHp[zone] = ownModel.hp[zone] ?? 0;
    this.savedDead = ownModel.dead;
    remotes.beginReplay();
    this.time = this.startAt;
    this.firedUpTo = this.startAt;
    this.shown = 0;
    this.total = screenSeconds(this.startAt, this.endAt, this.knockoutAt, this.config);
    this.snapCamera = true;
    this.skipQueued = false;
  }

  private finish(): void {
    this.handBack();
    this.phase = "idle";
    this.skipQueued = false;
    this.onEnd?.(this.killer);
  }

  private handBack(): void {
    this.remotes?.endReplay();
    if (this.ownModel) setMechDamage(this.ownModel, this.savedHp, this.savedDead);
    this.remotes = null;
    this.ownModel = null;
  }

  private fireUpTo(toMs: number): void {
    const events = this.events;
    for (let age = events.firstAfter(this.firedUpTo); age < events.size && events.timeAt(age) <= toMs; age++) {
      const kind = events.kindAt(age);
      if (kind === SHOT) {
        events.readShot(age, this.shotOut);
        this.onShot?.(events.idAt(age), this.shotOut, events.weaponAt(age), events.hitMechAt(age));
      } else if (kind === EXPLODE) {
        this.onExplode?.(events.valueAt(age, 0), events.valueAt(age, 1), events.valueAt(age, 2));
      } else if (kind === GRENADE) {
        this.onGrenade?.(events.idAt(age), events.valueAt(age, 0), events.valueAt(age, 1), events.valueAt(age, 2), events.valueAt(age, 3), events.valueAt(age, 4), events.valueAt(age, 5));
      } else if (kind === ABILITY) {
        events.readAbility(age, this.abilityOut);
        this.onAbility?.(this.abilityOut);
      } else if (kind === TITAN) {
        events.readTitan(age, this.titanOut);
        this.onTitan?.(this.titanOut);
      }
    }
    this.firedUpTo = toMs;
  }

  private draw(remotes: RemoteMechs, ownModel: MechModel, camera: THREE.PerspectiveCamera, world: Pick<World, "raycast">, dt: number): void {
    const frames = this.frames;
    const bracket = this.bracket;
    if (!frames.bracket(this.time, bracket)) return;
    remotes.hideAll();
    // Everyone in either frame around this moment: one arriving or leaving shows for the frame it is in.
    for (let side = 0; side < 2; side++) {
      const age = side === 0 ? bracket.a : bracket.b;
      if (side === 1 && bracket.b === bracket.a) break;
      for (let n = 0; n < frames.countAt(age); n++) {
        const id = frames.idAt(age, n);
        if (id === this.victim || (side === 1 && frames.find(bracket.a, id) >= 0)) continue;
        if (frames.sampleIn(bracket, id, this.drawn)) remotes.showRecorded(id, this.drawn);
      }
    }
    const killerSeen = frames.sampleIn(bracket, this.killer, this.killerPose);
    const k = this.killerPose;
    const ownSeen = frames.sampleIn(bracket, this.victim, this.own);
    if (ownSeen) {
      ownModel.group.position.set(this.own.x, this.own.y, this.own.z);
      ownModel.group.rotation.y = this.own.yaw;
      if (damageDiffers(ownModel, this.own)) {
        const wasDead = ownModel.dead;
        setMechDamage(ownModel, this.own.hp, this.own.dead);
        if (this.own.dead && !wasDead) this.onVictimDown?.(ownModel, killerSeen ? this.own.x - k.x : 0, killerSeen ? this.own.z - k.z : 0);
      }
    }
    // The killer can drop out of a frame (out of range a moment); the camera then holds where it was.
    if (!killerSeen) return;
    this.focus.x = k.x; this.focus.y = k.y; this.focus.z = k.z;
    const target = ownSeen ? this.own : k;
    replayCameraPose(k.x, k.y, k.z, k.yaw, target.x, target.y, target.z, this.config.camera, this.wanted);
    followPose(this.current, this.wanted, this.snapCamera ? 1 : 1 - Math.exp(-this.config.camera.sharpness * dt));
    this.snapCamera = false;
    keepOutOfWalls(this.current, world, this.config.camera.wallMarginMeters);
    camera.position.set(this.current.x, this.current.y, this.current.z);
    camera.lookAt(this.current.lookX, this.current.lookY, this.current.lookZ);
  }
}
