import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  FireGate, STEP, ZONE_ARMS, ZONE_COUNT, ZONE_LEGS, ZONE_TORSO, applyDamage, propsInReach, computeShot, createGrenade, createHealth, createMechInput,
  createMechState, createRayHit, createRingNow, createShot, createZoneHit, isDestroyed, isOutsideRing, makeRingSchedule, partToRepair, ringOnLand,
  decodeInput, parseClientMessage, ringAt, rollLoot, itemWeapon, weaponItem, raycastMech, stepGrenade, stepMech, throwGrenade, toMechInput, writeSelf,
  NOISE_KINDS, type BotConfig, type CombatStats, type NoiseKind, type NoiseStats, type PropConfig, type PropInstance, type GrenadeState, type GrenadeStats, type MatchConfig, type MatchState, type MechInput,
  type MechStats, type NetStats, type OtherState, type RingConfig, type RingNow, type RingSchedule, type ServerMessage, type Terrain,
  takenWithE, itemUpgrade, upgradeItem, upgradeScale, applyTune, assignDeep, parseTunable, setNumberAt, TUNABLE_FILES, type TuningRaws, type UpgradeSet,
  makeZonesFor, makeMuzzlesFor, mechStatsFor, rosterIndex, abilityFor, barrageTarget, type Roster, type AbilitySet, type AbilityStats, type BarrageStats, type RailStats,
  type BotDifficulty, type DecoyStats, type PounceStats, type RamStats,
  ITEM_ARMOR_FIRST, ITEM_GRENADE, type DropsConfig, type SupplyDrop,
  type NavGrid, type LootConfig, type PickupState, type WeaponSet, type WeaponStats, type World, type ZoneSet,
  titanHitBoxes, type TitanConfig, type TitanState,
} from "@rustbucket/shared";
import { Bot, type BotTarget } from "./Bot";
import { parseBotAbilities, type BotAbilityStats } from "./botAbilities";
import { AbstractFights, RATINGS, botsNeeded, pickDifficulty, type FarBot } from "./botLod";
import { decoyAlong, spawnDecoys, stepDecoy, type Decoy } from "./decoys";
import { Pathfinder } from "./Pathfinder";
import { activeWeapon, collectSmall, freshLoadout, selectSlot, spillItems, takeUpgrade, takeWeapon, wantsItem } from "./loadout";
import { CAUSE_BARREL, CAUSE_DROP, CAUSE_GRENADE, CAUSE_NONE, CAUSE_RING, abilityCause, clearCauses, knockoutHow, noteCause, weaponCause } from "./knockout";
import { clearTally, createTally, noteLongest, topStats } from "./matchStats";
import { Pickups } from "./Pickups";
import { planDrops } from "./supplyDrops";
import { TITAN_ID, Titan, placeTitan, type TitanHost } from "./Titan";
import type { Player } from "./Player";

const KILL_HEIGHT = -50;
const CHEST_HEIGHT = 1.7; // where splash damage measures to
const BLAST_LIFT = 0.2; // keeps a grenade resting on the floor from blasting from inside it
const SKY_HEIGHT = 500; // above anything a map builds, so a ray down from here finds the ground
const PICKUP_LIFT = 0.5; // a pickup floats this far above whatever it lies on
// A drop looks for the surface under it from this far above where it fell, so ground rising towards the spot (a
// wreck's loot spilling uphill) is found rather than missed. Lower than a mech is tall, so a roof the mech stood
// under is not mistaken for the floor.
const DROP_LOOK_UP = 2;

interface LiveGrenade {
  ownerId: number;
  state: GrenadeState;
}

export interface MapForRoom {
  world: World;
  nav: NavGrid;
  props: PropInstance[];
  propOfBox: Int32Array;
  spawns: [number, number, number][];
  meters: number;
}

// A map and the seed it was built from, which clients need to build the same map.
export interface SeededMap {
  seed: number;
  map: MapForRoom;
}

export interface RoomConfig {
  mech: MechStats;
  bots: BotConfig;
  botAbilities: BotAbilityStats;
  noise: NoiseStats;
  props: PropConfig;
  weapons: WeaponSet;
  loot: LootConfig;
  upgrades: UpgradeSet;
  grenade: GrenadeStats;
  combat: CombatStats;
  net: NetStats;
  match: MatchConfig;
  ring: RingConfig;
  drops: DropsConfig;
  zones: ZoneSet;
  abilities: AbilitySet;
  titan: TitanConfig;
  // Builds the map for a tier and seed. The room asks for a fresh one at the start of every match.
  mapFor: (tier: string, seed: number) => MapForRoom;
  // The real server builds match maps on worker threads (MapPool) through this. With it, the room asks for the next
  // match's map early and starts the countdown once it has arrived, never building one on the tick. Without it
  // (tests, the range) mapFor builds each match's map on the spot.
  mapLater?: (tier: string, seed: number) => Promise<MapForRoom>;
  random?: () => number;
  // Dev only (DEV_TUNING=1): the raw data files, so players in a room can change numbers live. Each room tunes its
  // own copy, so a playtest in one room never changes another.
  tuningRaws?: TuningRaws;
  // The roster mechs (data/roster.json) and the hit boxes measured for them (data/mechKits.json). Without a roster
  // every mech moves, takes damage and is hit like the standard one, which is what most tests want.
  roster?: Roster;
  kitHitboxes?: unknown;
}

// One room: a lobby that runs match after match. Transport free: it only sees parsed messages and a send
// function, so it is easy to test. Every input is processed exactly once, in order, so the client's
// prediction and the server never disagree on history.
export class Room {
  private players = new Map<number, Player>();
  private grenades: LiveGrenade[] = [];
  private nextId = 1;
  private tickCount = 0;
  private shot = createShot();
  private newGrenade = createGrenade();
  private worldHit = createRayHit();
  private zoneHit = createZoneHit();
  private ringNow = createRingNow();
  private lobbyZone = createRingNow();
  private random: () => number;
  private historyLength: number;

  private state: MatchState = "lobby";
  private phaseEndTick = 0;
  private matchStartTick = 0;
  private startedWith = 0;
  private placeCounter = 0;
  private hostId = 0;
  private seed: number;
  private map: MapForRoom;
  private upcoming: { seed: number; map: MapForRoom | null; failed: boolean } | null = null; // with mapLater only
  private startWanted = false; // a countdown is owed as soon as the upcoming map arrives
  private ring: RingSchedule | null = null;
  private drops: SupplyDrop[] = [];
  private dropsLanded = 0; // how many of this match's drops have hit the ground
  private dropsOpened = 0;
  private propHp: Float32Array = new Float32Array(0);
  private destroyedProps: number[] = [];
  private nearBoxes: number[] = []; // reused by propsTouching
  private nearProps: number[] = [];
  private pickups: Pickups;
  private pickupScratch: PickupState[] = [];
  private pendingBlasts: { x: number; y: number; z: number; tick: number; owner: Player | null; damage: number; radius: number; cause: number }[] = [];
  private decoys: Decoy[] = [];
  private decoyHit = createZoneHit();
  private strikeAt = { x: 0, z: 0 };
  private titan: Titan | null = null; // the Junk Titan, from when it wakes up until the next countdown
  private titanHit = createZoneHit();
  private titanHost: TitanHost;

  private botInput = createMechInput();
  private botTargets: BotTarget[] = [];
  private finder: Pathfinder;
  private fixedBots: number | null; // null when the room tops itself up to the tier size
  private fights = new AbstractFights();
  private farBots: FarBot[] = [];
  private anchors: Player[] = []; // the people bots keep full AI near

  private statsFor: (mech: number) => MechStats;
  private zonesFor: (mech: number) => ZoneSet;
  private muzzlesFor: (mech: number) => readonly (readonly number[])[];
  private abilityFor: (mech: number) => AbilityStats | null;

  private tuningRaws: TuningRaws | null = null;
  private tunes: Extract<ServerMessage, { t: "tuned" }>[] = []; // every change so far, replayed to people who join later

  // `botCount` is how many computer players to keep, up to the spawns the people present leave free. `null` means keep
  // the room topped up to its tier's target size. Either way a bot gives up its spawn to a person arriving in the lobby.
  // `difficulty` makes every bot that one, or "mixed" deals each its own by the mix in data/bots.json.
  // `lobby` is the lobby's map when it was built elsewhere (RoomManager has a worker build it); without it the room
  // builds its own with mapFor.
  constructor(
    readonly code: string, readonly tier: string, private config: RoomConfig, botCount: number | null = 0,
    readonly difficulty: BotDifficulty = "mixed", lobby?: SeededMap,
  ) {
    if (config.tuningRaws) {
      this.tuningRaws = JSON.parse(JSON.stringify(config.tuningRaws)) as TuningRaws;
      const own: Record<string, unknown> = { ...config };
      for (const file of TUNABLE_FILES) if (file !== "roster" || config.roster) own[file] = parseTunable(file, this.tuningRaws);
      own.botAbilities = parseBotAbilities(this.tuningRaws.bots);
      this.config = config = own as unknown as RoomConfig;
    }
    // Made from this room's own copies, so tuning in the room reaches each mech's numbers.
    this.statsFor = mechStatsFor(config.mech, config.roster ?? null);
    this.zonesFor = makeZonesFor(config.zones, config.roster ?? null, config.kitHitboxes);
    this.muzzlesFor = makeMuzzlesFor(config.roster ?? null, config.kitHitboxes);
    this.abilityFor = abilityFor(config.abilities, config.roster ?? null);
    this.random = config.random ?? Math.random;
    this.pickups = new Pickups(config.loot.maxPickups);
    this.historyLength = Math.ceil(config.combat.historyMs / (STEP * 1000));
    this.seed = lobby?.seed ?? this.newSeed();
    this.map = lobby?.map ?? config.mapFor(tier, this.seed);
    this.resetProps();
    this.finder = new Pathfinder(this.map.nav, config.bots.path, this.map.world.terrain);
    this.fixedBots = botCount;
    this.titanHost = this.makeTitanHost();
    this.fillBots();
    this.prepareNextMap(); // the lobby usually lasts long enough that the first match never waits
  }

  // Adds or removes bots so people plus bots match the tier's target, or the fixed bot count, within the spawns.
  private fillBots(): void {
    const humans = this.humans().length;
    const target = this.fixedBots === null ? this.config.bots.fill[this.tier] ?? 12 : this.fixedBots + humans;
    const wanted = botsNeeded(target, humans, this.map.spawns.length);
    const bots = [...this.players.values()].filter((p) => p.bot).sort((a, b) => a.id - b.id);
    while (bots.length > wanted) this.players.delete(bots.pop()!.id);
    for (let i = bots.length; i < wanted; i++) this.addBot();
  }

  // People, not bots. A room with only bots left in it is empty.
  get playerCount(): number {
    return this.humans().length;
  }

  private humans(): Player[] {
    return [...this.players.values()].filter((p) => !p.bot && !p.gone);
  }

  private freeSlot(): number {
    const taken = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;
    return slot;
  }

  private addBot(): void {
    const { net } = this.config;
    const slot = this.freeSlot();
    const id = this.nextId++;
    const mech = this.dealtMech(id);
    this.players.set(id, {
      id, slot, bot: this.newBot(), send: () => {}, gone: false, goneTick: 0, rejoinToken: "", mech, state: this.freshState(slot, mech),
      gate: new FireGate(), grenadeGate: new FireGate(), queue: [], lastSeq: 0, ackTick: 0, lagMs: 0, steps: 0, budget: net.maxMessagesPerSecond,
      hp: createHealth(this.config.zones), loadout: freshLoadout(this.config.weapons, this.config.loot), askedSlot: 0, interactReadyTick: 0, interactHeld: false, lootingId: 0, lootSeconds: 0, looted: false, repairZone: -1, repairSeconds: 0, healthMark: 0, railHpMark: 0, launchX: 0, launchZ: 0, cause: CAUSE_NONE, causeBefore: CAUSE_NONE, tally: createTally(), rammed: [], interested: new Set(), watchId: 0, heard: [], sentPickupIds: [], shotsFired: 0, quietUntil: new Int32Array(NOISE_KINDS.length), dead: false, respawnTick: 0, participant: true, eliminated: false,
      historyTick: new Int32Array(this.historyLength).fill(-1), history: new Float32Array(this.historyLength * 4),
    });
  }

  // Bots, and people who have not picked, are dealt a mech by player number, so a room has all four in it.
  private dealtMech(id: number): number {
    return id % (this.config.roster?.mechs.length ?? 1);
  }

  // A mech standing on its spawn, as the roster mech it is.
  private freshState(slot: number, mech: number) {
    return createMechState(this.statsFor(mech), ...this.spawnFor(slot), Math.PI, mech);
  }

  private newBot(): Bot {
    const difficulty = this.difficulty === "mixed" ? pickDifficulty(this.config.bots, this.random()) : this.difficulty;
    const stats = this.config.bots.difficulties[difficulty] ?? this.config.bots.difficulties.normal!;
    return new Bot(stats, this.random, this.config.bots.path, this.finder, RATINGS[difficulty] ?? 2, this.config.botAbilities);
  }

  // A read-only look at every mech, for the soak test's checks. Not used by the game itself.
  inspect(): { id: number; bot: boolean; rating: number | null; x: number; y: number; z: number; hp: number[]; dead: boolean; eliminated: boolean; participant: boolean }[] {
    return [...this.players.values()].map((p) => ({
      id: p.id, bot: p.bot !== null, rating: p.bot?.rating ?? null, x: p.state.x, y: p.state.y, z: p.state.z, hp: [...p.hp], dead: p.dead, eliminated: p.eliminated, participant: p.participant,
    }));
  }

  // How many decoys are out, for checks: nobody but their owner is told they exist.
  get decoyCount(): number {
    return this.decoys.length;
  }

  // The Junk Titan, for checks and tests. Not used by the game itself.
  get junkTitan(): Titan | null {
    return this.titan;
  }

  get mapMeters(): number {
    return this.map.meters;
  }

  // The current map's ground, for checks: on an island, where its sea begins.
  get mapTerrain(): Terrain | null {
    return this.map.world.terrain;
  }

  get matchState(): MatchState {
    return this.state;
  }

  private newSeed(): number {
    return Math.floor(this.random() * 0x100000000);
  }

  // True when the next match's map has been built and is waiting. Lets the soak start its match at a fixed tick.
  get nextMapReady(): boolean {
    return this.upcoming?.map != null;
  }

  // With mapLater: starts building the next match's map now, on another thread, unless one is already coming.
  // The seed is chosen now, so it is the seed the match will be played on.
  private prepareNextMap(): void {
    if (!this.config.mapLater || this.upcoming) return;
    const upcoming = { seed: this.newSeed(), map: null as MapForRoom | null, failed: false };
    this.upcoming = upcoming;
    this.config.mapLater(this.tier, upcoming.seed).then(
      (map) => { upcoming.map = map; },
      (error: unknown) => {
        // A seed with no valid map, or a crashed worker: the next try asks again with a new seed.
        console.error(`Room ${this.code}: map for seed ${upcoming.seed} failed: ${error instanceof Error ? error.message : String(error)}`);
        upcoming.failed = true;
      },
    );
  }

  // The next match's seed and map, or null while it is still being built.
  private takeNextMap(): { seed: number; map: MapForRoom } | null {
    if (!this.config.mapLater) {
      const seed = this.newSeed();
      return { seed, map: this.config.mapFor(this.tier, seed) };
    }
    if (this.upcoming?.failed) this.upcoming = null;
    this.prepareNextMap();
    const { seed, map } = this.upcoming!;
    if (!map) return null;
    this.upcoming = null;
    return { seed, map };
  }

  // Returns the new player's id, or null if the room is full.
  join(send: (message: ServerMessage) => void): number | null {
    const { net } = this.config;
    if (this.humans().length >= net.maxPlayers) {
      send({ t: "refused", reason: "The room is full." });
      return null;
    }
    const slot = this.freeSlot();

    // Someone arriving while a match is running can only watch it.
    const watching = this.state === "active" || this.state === "results";
    const id = this.nextId++;
    const mech = this.dealtMech(id);
    const player: Player = {
      id, slot, bot: null, send, gone: false, goneTick: 0, rejoinToken: randomBytes(16).toString("hex"), mech, state: this.freshState(slot, mech), gate: new FireGate(), grenadeGate: new FireGate(),
      queue: [], lastSeq: 0, ackTick: 0, lagMs: this.config.combat.defaultLagMs, steps: 0, budget: net.maxMessagesPerSecond, hp: createHealth(this.config.zones), loadout: freshLoadout(this.config.weapons, this.config.loot), askedSlot: 0, interactReadyTick: 0, interactHeld: false, lootingId: 0, lootSeconds: 0, looted: false, repairZone: -1, repairSeconds: 0, healthMark: 0, railHpMark: 0, launchX: 0, launchZ: 0, cause: CAUSE_NONE, causeBefore: CAUSE_NONE, tally: createTally(), rammed: [], interested: new Set(), watchId: 0, heard: [], sentPickupIds: [], shotsFired: 0, quietUntil: new Int32Array(NOISE_KINDS.length),
      dead: watching, respawnTick: 0, participant: !watching, eliminated: watching,
      historyTick: new Int32Array(this.historyLength).fill(-1), history: new Float32Array(this.historyLength * 4),
    };
    this.players.set(id, player);
    if (this.hostId === 0) this.hostId = id;

    // In the lobby a person arriving takes a bot's place. Mid match nothing changes.
    if (this.state === "lobby") this.fillBots();
    this.welcome(player);
    return id;
  }

  // Everything a fresh connection needs to draw this room: who you are, its map, tuning and broken props.
  private welcome(player: Player): void {
    player.send({ t: "welcome", id: player.id, code: this.code, seed: this.seed, tier: this.tier, tuning: this.tuningRaws !== null, rejoin: player.rejoinToken });
    for (const tuned of this.tunes) player.send(tuned);
    if (this.destroyedProps.length > 0) player.send({ t: "props", destroyed: [...this.destroyedProps] });
    this.broadcastRoom();
  }

  // A player whose connection dropped comes back to their own mech, still in the match, if they are in time.
  // Returns their id, or null when there is nothing to come back to (too late, the match moved on, a wrong secret).
  rejoin(id: number, token: string, send: (message: ServerMessage) => void): number | null {
    const player = this.players.get(id);
    if (!player || !player.gone || player.eliminated || !sameSecret(player.rejoinToken, token)) return null;
    player.gone = false;
    player.send = send;
    player.queue.length = 0;
    // The new connection starts with nothing: every mech in view and the pickups near you go again in full.
    player.interested.clear();
    player.sentPickupIds.length = 0;
    this.welcome(player);
    return id;
  }

  // A message for every person in the room.
  tellEveryone(message: ServerMessage): void {
    for (const p of this.players.values()) if (!p.bot) p.send(message);
  }

  // Whether a dropped player's mech is still waiting for them, so the room must not be thrown away yet.
  get holdingForRejoin(): boolean {
    for (const p of this.players.values()) if (p.gone && !p.eliminated) return true;
    return false;
  }

  leave(id: number): void {
    const player = this.players.get(id);
    if (!player) return;
    for (const d of [...this.decoys]) if (d.ownerId === id) this.popDecoy(d, null);
    // Dropping out of a running match: the mech stands and waits for its player to reconnect. If they do not in
    // time it is knocked out and left as a wreck, loot and all, so the fight they were in still has an ending.
    if (this.state === "active" && player.participant && !player.eliminated) {
      player.gone = true;
      player.goneTick = this.tickCount;
      player.send = () => {};
      player.queue.length = 0;
      this.stopLooting(player);
      player.repairZone = -1;
      if (this.hostId === id) this.hostId = this.humans()[0]?.id ?? 0;
      this.broadcastRoom();
      return;
    }
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this.humans()[0]?.id ?? 0;
    if (this.state === "lobby") this.fillBots();
    this.broadcastRoom();
  }

  // Returns false when the client is flooding and should be disconnected.
  // `raw` is either a text message or a packed binary input.
  receive(id: number, raw: string | Uint8Array): boolean {
    const player = this.players.get(id);
    if (!player) return false;

    player.budget -= 1;
    if (player.budget < this.config.net.floodKickBudget) return false;
    if (player.budget < 0) return true; // over the rate: ignore this message

    const message = typeof raw === "string" ? parseClientMessage(raw) : decodeInput(raw);
    if (!message) return true;

    if (message.t === "start") {
      if (id === this.hostId && this.state === "lobby") this.beginCountdown();
      return true;
    }
    if (message.t === "tune") {
      this.tune(message.file, message.path, message.value);
      return true;
    }
    if (message.t === "mech") {
      this.pickMech(player, message.mech);
      return true;
    }

    if (message.lagMs !== undefined) player.lagMs = message.lagMs;
    player.watchId = message.watchId ?? 0;
    if (message.seq <= (player.queue.at(-1)?.seq ?? player.lastSeq)) return true; // replayed or out of order
    if (player.queue.length >= this.config.net.maxQueuedInputs) return true; // client is far ahead, drop the extra

    const input = createMechInput();
    toMechInput(message, input);
    player.queue.push({ seq: message.seq, input });
    return true;
  }

  // A person picked a mech. Before a match it swaps at once, where they stand. Once a match is running they keep
  // the one they have and get the new one at the next spawn, so nobody can swap mid fight.
  private pickMech(player: Player, mech: number): void {
    if (!this.config.roster || mech !== rosterIndex(this.config.roster, mech)) return;
    player.mech = mech;
    if (this.state === "lobby" || this.state === "countdown") player.state.mech = mech;
  }

  // A playtester changed a number. It goes through the same checks as loading the file, then into the live values
  // (keeping every object in place, so bots and everything else holding them see it), and out to everyone here.
  // Refused without DEV_TUNING, or when the value fails the file's checks.
  private tune(file: string, path: string, value: number): void {
    if (!this.tuningRaws) return;
    // The bots' ability block is checked here as well, because the shared check of bots.json does not know it.
    let botAbilities: BotAbilityStats | null = null;
    if (file === "bots") {
      const trial: unknown = JSON.parse(JSON.stringify(this.tuningRaws.bots));
      if (setNumberAt(trial, path, value) === null) return;
      try { botAbilities = parseBotAbilities(trial); } catch { return; }
    }
    const parsed = applyTune(this.tuningRaws, file, path, value);
    if (parsed === null) return;
    assignDeep((this.config as unknown as Record<string, unknown>)[file], parsed);
    if (botAbilities) assignDeep(this.config.botAbilities, botAbilities);
    const message: Extract<ServerMessage, { t: "tuned" }> = { t: "tuned", file, path, value };
    this.tunes.push(message);
    for (const p of this.players.values()) p.send(message);
  }

  // One server tick. The caller runs this 60 times a second.
  tick(): void {
    const { net } = this.config;
    this.tickCount++;

    if (this.state === "countdown" && this.tickCount >= this.phaseEndTick) this.beginMatch();
    else if (this.state === "results" && this.tickCount >= this.phaseEndTick) this.afterResults();
    else if (this.state === "lobby" && this.startWanted) this.beginCountdown();

    if (this.state === "active" && this.ring) ringAt(this.ring, this.elapsedSeconds(), this.ringNow);
    this.anchors = this.humans().filter((p) => p.participant && !p.dead);
    this.farBots.length = 0;
    this.finder.newTick();
    for (const player of this.players.values()) {
      if (player.respawnTick > 0 && this.tickCount >= player.respawnTick && this.state !== "active") this.respawnForPractice(player);
      if (player.bot) {
        this.runBot(player);
        this.recordHistory(player);
        continue;
      }
      if (player.gone) {
        if (!player.eliminated && this.tickCount - player.goneTick >= net.rejoinGraceSeconds / STEP) this.eliminate(player, null, true);
        // Stands still, so a mech dropped mid jump comes down rather than hanging in the air.
        if (!player.dead) this.processInput(player, Object.assign(this.botInput, createMechInput(), { aimYaw: player.state.bodyYaw }));
        this.recordHistory(player);
        continue;
      }
      player.budget = Math.min(net.maxMessagesPerSecond, player.budget + net.maxMessagesPerSecond * STEP);
      for (let i = 0; i < net.maxInputsPerTick; i++) {
        const next = player.queue.shift();
        if (!next) break;
        this.processInput(player, next.input);
        player.lastSeq = next.seq;
        player.ackTick = this.tickCount;
      }
      this.recordHistory(player);
    }

    this.stepDecoys();
    this.settleFarFights();
    this.stepGrenades();
    this.setOffPendingBlasts();
    if (this.state === "active") this.applyRing();
    if (this.state === "active") this.runDrops();
    if (this.state === "active") this.runTitan();
    if (this.tickCount % net.snapshotEvery === 0) this.broadcastSnapshots();
  }

  // A bot decides what to do this tick, from what it can see, and its input goes through the same path as a person's.
  // It roams and fights in the lobby and between matches too, where nothing does damage, so the room feels alive.
  // Only the countdown holds everyone still.
  private runBot(player: Player): void {
    const input = this.botInput;
    const { lod } = this.config.bots;
    const bot = player.bot!;
    bot.abilityKind = this.abilityFor(player.state.mech)?.kind ?? null;
    bot.body = this.statsFor(player.state.mech);
    let health = 0;
    for (let zone = 0; zone < ZONE_COUNT; zone++) health += player.hp[zone]! + player.loadout.armor[zone]!;
    bot.noteHealth(health);

    const titan = this.titan?.alive && this.state === "active" ? this.titan : null;
    bot.keepOutOf(titan?.x ?? 0, titan?.z ?? 0, titan ? this.config.titan.botKeepOutMeters : 0);

    if (this.state === "countdown" || player.dead) {
      Object.assign(input, createMechInput(), { aimYaw: player.state.bodyYaw });
      this.processInput(player, input);
      return;
    }

    if ((this.tickCount + player.slot) % this.config.bots.loot.refreshTicks === 0) {
      this.aimBotAtLoot(player);
      bot.needsRepair = partToRepair(player.hp, this.config.zones) >= 0;
    }

    // A bot with nobody near is not worth thinking about every tick. It thinks and moves a few times a second,
    // heads for where it is going, and never looks for targets. Two such bots that meet fight on paper.
    if (!this.nearAnyPerson(player, lod.fullRangeMeters)) {
      this.farBots.push({ id: player.id, x: player.state.x, z: player.state.z, rating: bot.rating });
      if ((this.tickCount + player.slot) % lod.cheapEveryTicks !== 0) return;
      this.botTargets.length = 0;
      const dt = lod.cheapEveryTicks * STEP;
      bot.think(player.state, this.botTargets, this.botZone(player), this.map.world, dt, input);
      input.fire = false; input.grenade = false; input.dash = false; input.ability = false;
      this.processInput(player, input, dt);
      return;
    }

    this.botTargets.length = 0;
    for (const other of this.players.values()) {
      if (other === player || !other.participant || other.dead) continue;
      this.botTargets.push({ id: other.id, x: other.state.x, y: other.state.y, z: other.state.z });
    }
    // Decoys look like any mech to a bot, so it chases and shoots them. Its own are not worth fooling itself with.
    for (const d of this.decoys) if (d.ownerId !== player.id) this.botTargets.push({ id: d.id, x: d.state.x, y: d.state.y, z: d.state.z });
    // The Titan is one more thing to shoot, aimed at high up its body. Being the nearest is what makes it the target.
    if (titan) this.botTargets.push({ id: TITAN_ID, x: titan.x, y: titan.y, z: titan.z, aimHeight: this.config.titan.aimHeight });
    this.warnOfLasers(player);
    bot.think(player.state, this.botTargets, this.botZone(player), this.map.world, STEP, input);
    this.processInput(player, input);
  }

  // Tells a bot about any Rail Shot laser it stands under: a Longshot charging, the bot ahead of it within range and
  // within railLaserWidth of the line it faces. The side to run to is away from that line.
  private warnOfLasers(player: Player): void {
    const width = this.config.botAbilities?.railLaserWidth ?? 0;
    const me = player.state;
    for (const other of this.players.values()) {
      if (other === player || other.dead) continue;
      const rail = this.abilityFor(other.state.mech);
      if (rail?.kind !== "rail" || other.state.abilityTime <= 0) continue;
      const s = other.state;
      const fx = -Math.sin(s.bodyYaw), fz = -Math.cos(s.bodyYaw);
      const rx = me.x - s.x, rz = me.z - s.z;
      const along = rx * fx + rz * fz;
      const across = rx * -fz + rz * fx; // positive to the laser's left
      if (along <= 0 || along > rail.range || Math.abs(across) > width) continue;
      const away = across >= 0 ? 1 : -1;
      // One laser is one charge: the tick it started on, which stays put for the whole charge, tells charges apart.
      const startTick = this.tickCount - Math.round((rail.chargeSeconds - s.abilityTime) / STEP);
      player.bot!.laserOn(other.id * 1_000_000 + startTick, -fz * away, fx * away, s.abilityTime);
    }
  }

  // With nobody to fight, a bot goes for the nearest thing worth having: a pickup it would take, or a full wreck.
  private aimBotAtLoot(player: Player): void {
    const bot = player.bot!;
    const { x, z } = player.state;
    let range = this.config.bots.loot.searchMeters;
    const pickup = this.pickups.nearest(x, z, range, (p) => wantsItem(player.loadout, p.item, this.config.loot));
    let goalX = 0, goalZ = 0, found = false;
    if (pickup) { goalX = pickup.x; goalZ = pickup.z; range = Math.hypot(pickup.x - x, pickup.z - z); found = true; }
    const wreck = this.nearestWreck(player, range);
    if (wreck) { goalX = wreck.state.x; goalZ = wreck.state.z; found = true; }
    // Nothing lying about: a supply drop that has not opened yet pulls bots from a long way off.
    const drop = found ? null : this.dropWaiting(x, z);
    if (drop) { goalX = drop.x; goalZ = drop.z; found = true; }
    if (found) bot.setLootGoal(goalX, goalZ, wreck !== null);
    else bot.clearLootGoal();
  }

  // ---- supply drops

  // Lands and opens this match's supply drops on the match clock, the same clock the clients draw them by.
  private runDrops(): void {
    const elapsed = this.elapsedSeconds();
    const config = this.config.drops;
    while (this.dropsLanded < this.drops.length && this.drops[this.dropsLanded]!.landAt <= elapsed) {
      const d = this.drops[this.dropsLanded++]!;
      // Landing is a blast nobody owns: it flattens props and hurts whoever stood underneath, and everyone near hears it.
      this.blast(d.x, d.y, d.z, config.impact.damage, config.impact.radius, null, CAUSE_DROP);
    }
    while (this.dropsOpened < this.dropsLanded && this.drops[this.dropsOpened]!.landAt + config.openSeconds <= elapsed) {
      this.openDrop(this.drops[this.dropsOpened++]!);
    }
  }

  // The lid blows off and the best loot in the match lands in a ring round the crate.
  private openDrop(d: SupplyDrop): void {
    this.spillContents(d.x, d.y, d.z, this.config.drops.contents, this.config.drops.spillMeters);
  }

  // A ring of loot round a spot, from a list of kinds: a supply drop's lid blowing off, or the fallen Junk Titan.
  private spillContents(cx: number, cy: number, cz: number, contents: readonly string[], spillMeters: number): void {
    const weapons = this.config.weapons.weapons.length;
    const start = this.config.weapons.start;
    const turn = this.random() * Math.PI * 2;
    contents.forEach((kind, i) => {
      let item = ITEM_GRENADE;
      if (kind === "upgrade") item = upgradeItem(Math.floor(this.random() * this.config.upgrades.upgrades.length));
      else if (kind === "armor") item = ITEM_ARMOR_FIRST + Math.floor(this.random() * 3);
      else if (kind === "weapon") item = weaponItem((start + 1 + Math.floor(this.random() * (weapons - 1))) % weapons);
      const angle = turn + (i / contents.length) * Math.PI * 2;
      const x = cx + Math.cos(angle) * spillMeters, z = cz + Math.sin(angle) * spillMeters;
      this.pickups.add(item, x, this.surfaceBelow(x, z, cy + 1) + PICKUP_LIFT, z);
    });
    this.makeNoise(null, "explosion", cx, cz);
  }

  // ---- the Junk Titan

  // It wakes on its tiers at its time in the match, announced to everyone, then walks and fights every tick.
  private runTitan(): void {
    const config = this.config.titan;
    if (!this.titan) {
      const elapsed = this.elapsedSeconds();
      if (!config.tiers.includes(this.tier) || !this.ring || elapsed < config.appearSeconds) return;
      const at = placeTitan(config, this.ring, elapsed, this.map, this.players.values(), this.random);
      this.titan = new Titan(config, this.map.world, this.finder, this.config.bots.path, this.map.meters, this.titanHost, titanHitBoxes(config, this.config.kitHitboxes ?? null), at.x, at.z);
      this.tellEveryone({ t: "notice", text: config.announce });
      this.makeNoise(null, "explosion", at.x, at.z);
    }
    this.titan.step(STEP, this.ringNow);
  }

  // What the Titan does goes through the room's own rules: armor, knockouts, props, loot, who hears what.
  private makeTitanHost(): TitanHost {
    return {
      mechs: () => this.players.values(),
      hurt: (target, zoneDamage, cause) => this.titanHurts(target, zoneDamage, cause),
      smashProps: (x, y, z, radius, height) => this.smashPropsAt(x, y, z, radius, height, null),
      blast: (x, y, z, damage, radius, cause) => this.blast(x, y, z, damage, radius, null, cause),
      spill: (x, y, z, contents, spillMeters) => this.spillContents(x, y, z, contents, spillMeters),
      sendNear: (x, z, message) => this.sendNear(x, z, message),
      sendNearEither: (x1, z1, x2, z2, message) => this.sendNearEither(x1, z1, x2, z2, message),
      tellEveryone: (message) => this.tellEveryone(message),
      noise: (kind, x, z) => this.makeNoise(null, kind, x, z),
    };
  }

  // A stomp: each zone takes its share, armor first, as with any hit. Nobody is credited: the Titan knocks mechs out on
  // its own (killerMech -1 on the knockout card).
  private titanHurts(target: Player, zoneDamage: readonly number[], cause: number): void {
    if (target.dead || !target.participant) return;
    const zones = this.zonesFor(target.state.mech);
    let total = 0;
    for (let zone = 0; zone < ZONE_COUNT; zone++) total += applyDamage(target.hp, zones, zone, zoneDamage[zone] ?? 0, target.loadout.armor);
    this.hurt(target, cause, null, total);
    if (isDestroyed(target.hp)) this.eliminate(target, null);
  }

  // Damage to the Titan, already scaled for where it landed. It counts for the attacker's "titanDamage" stat, and the
  // attacker gets a hit marker like any hit (targetId TITAN_ID). Returns what it took.
  private hurtTitan(by: Player | null, amount: number, zone: number, x: number, y: number, z: number): number {
    const titan = this.titan;
    if (!titan || this.state !== "active") return 0;
    const wasAlive = titan.alive;
    const taken = titan.damage(amount, by?.id ?? 0);
    if (!by || taken <= 0) return taken;
    by.tally.titanDamage += taken;
    by.send({ t: "hit", targetId: TITAN_ID, zone, damage: taken, killed: wasAlive && !titan.alive, x, y, z });
    return taken;
  }

  // A ram or a pounce that reaches the Titan's body hurts it too, once per use.
  private abilityOnTitan(player: Player, reach: number, damage: number): void {
    const titan = this.titan;
    if (!titan || this.state !== "active" || player.rammed.includes(TITAN_ID)) return;
    const s = player.state;
    if (titan.blastShare(s.x, s.y + CHEST_HEIGHT, s.z, reach) <= 0) return;
    player.rammed.push(TITAN_ID);
    this.hurtTitan(player, damage, -1, s.x, s.y + CHEST_HEIGHT, s.z);
  }

  // The nearest drop that has been announced and not yet opened, within the pull of bots, or null.
  private dropWaiting(x: number, z: number): SupplyDrop | null {
    const config = this.config.drops;
    const elapsed = this.elapsedSeconds();
    let best: SupplyDrop | null = null, bestDistance = config.botPullMeters;
    for (let i = this.dropsOpened; i < this.drops.length; i++) {
      const d = this.drops[i]!;
      if (d.landAt - elapsed > config.announceSeconds) break;
      const distance = Math.hypot(d.x - x, d.z - z);
      if (distance < bestDistance) { best = d; bestDistance = distance; }
    }
    return best;
  }

  // The nearest wreck that still has something in it, within range of a mech, or null.
  private nearestWreck(player: Player, range: number): Player | null {
    let best: Player | null = null;
    let bestDistance = range;
    for (const other of this.players.values()) {
      if (other === player || !other.dead || !other.participant || other.looted) continue;
      const d = Math.hypot(other.state.x - player.state.x, other.state.z - player.state.z);
      if (d <= bestDistance) { best = other; bestDistance = d; }
    }
    return best;
  }

  private nearAnyPerson(bot: Player, range: number): boolean {
    for (const p of this.anchors) if (Math.hypot(p.state.x - bot.state.x, p.state.z - bot.state.z) <= range) return true;
    return false;
  }

  // Works out the fights between far away bots, a few times a second.
  private settleFarFights(): void {
    const { lod } = this.config.bots;
    if (this.tickCount % lod.cheapEveryTicks !== 0 || this.state === "countdown") return;
    for (const { winnerId, loserId } of this.fights.update(this.farBots, lod.cheapEveryTicks * STEP, lod, this.random)) {
      const winner = this.players.get(winnerId), loser = this.players.get(loserId);
      if (!winner || !loser || winner.dead || loser.dead) continue;
      // A fight on paper has no shots, so each side is taken to have been hurt by the other's gun in hand.
      noteCause(loser, weaponCause(Math.max(0, activeWeapon(winner.loadout))));
      noteCause(winner, weaponCause(Math.max(0, activeWeapon(loser.loadout))));
      for (let zone = 0; zone < ZONE_COUNT; zone++) {
        const max = this.config.zones.zones[zone]!.hp;
        applyDamage(loser.hp, this.config.zones, zone, lod.abstractLoserDamage * max);
        applyDamage(winner.hp, this.config.zones, zone, lod.abstractWinnerDamage * max);
      }
      if (isDestroyed(loser.hp)) this.eliminate(loser, winner);
    }
  }

  // The area a bot wanders in: the live ring during a match. Otherwise a circle round the nearest person, so the room
  // is full of activity where you are, not out of sight across the map.
  private botZone(bot: Player): RingNow {
    if (this.state === "active" && this.ring) return this.ringNow;
    const zone = this.lobbyZone;
    let nearest: Player | null = null;
    let best = Infinity;
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const d = Math.hypot(p.state.x - bot.state.x, p.state.z - bot.state.z);
      if (d < best) { best = d; nearest = p; }
    }
    zone.cx = nearest ? nearest.state.x : 0;
    zone.cz = nearest ? nearest.state.z : 0;
    zone.radius = nearest ? 70 : this.map.meters * 0.45;
    return zone;
  }

  // ---- match flow

  // Swaps in the next map, puts everyone on a spawn, and starts the countdown. If the map is still being built the
  // room stays as it is (lobby or results) and tries again each tick, so a slow machine holds the countdown back
  // rather than stalling every room in the process.
  private beginCountdown(): void {
    const next = this.takeNextMap();
    this.startWanted = next === null;
    if (!next) return;
    this.seed = next.seed;
    this.map = next.map;
    this.resetProps();
    this.pendingBlasts = [];
    this.decoys = [];
    this.titan = null;
    this.finder = new Pathfinder(this.map.nav, this.config.bots.path, this.map.world.terrain);
    for (const p of this.players.values()) p.bot?.setFinder(this.finder);
    this.fillBots();
    this.ring = makeRingSchedule(this.config.ring, this.tier, this.map.meters, this.random, ringOnLand(this.map.world.terrain));
    this.drops = planDrops(this.config.drops, this.tier, this.ring, this.map, this.random);
    this.dropsLanded = 0;
    this.dropsOpened = 0;
    this.grenades = [];
    this.pickups.clear();
    for (const player of [...this.players.values()]) if (player.gone) this.players.delete(player.id);
    for (const player of this.players.values()) {
      player.participant = true;
      player.eliminated = false;
      player.dead = false;
      player.hp = createHealth(this.config.zones);
      player.loadout = freshLoadout(this.config.weapons, this.config.loot);
      player.askedSlot = 0;
      player.looted = false;
      this.stopLooting(player);
      clearCauses(player);
      clearTally(player.tally);
      player.state = this.freshState(player.slot, player.mech);
      player.queue.length = 0;
    }
    this.state = "countdown";
    this.phaseEndTick = this.tickCount + Math.ceil(this.config.match.countdownSeconds / STEP);
    this.broadcastRoom();
  }

  private beginMatch(): void {
    this.state = "active";
    this.matchStartTick = this.tickCount;
    this.startedWith = this.players.size;
    this.placeCounter = this.players.size;
    this.broadcastRoom();
  }

  private elapsedSeconds(): number {
    return (this.tickCount - this.matchStartTick) * STEP;
  }

  private alivePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.participant && !p.eliminated);
  }

  // Someone is out. Records their place, tells the room, and checks whether the match is over.
  private eliminate(player: Player, killer: Player | null, left = false): void {
    // Outside a running match nothing is lost: a destroyed mech just comes back in a few seconds.
    if (this.state !== "active") {
      this.knockOutForPractice(player);
      return;
    }
    if (player.eliminated) return;
    player.eliminated = true;
    player.dead = true;
    player.hp[ZONE_COUNT - 1] = 0;
    const place = this.placeCounter--;
    const alive = this.alivePlayers().length;
    // Someone who walked out was not knocked out by anything, so they get no card.
    const message: ServerMessage = {
      t: "eliminated", id: player.id, killerId: killer?.id ?? null, place, alive, ...(left ? { left: true } : { how: knockoutHow(player, killer, this.config.weapons) }),
    };
    for (const p of this.players.values()) p.send(message);
    this.checkMatchOver();
  }

  private knockOutForPractice(player: Player): void {
    if (player.dead) return;
    player.dead = true;
    player.hp[ZONE_COUNT - 1] = 0;
    player.respawnTick = this.tickCount + Math.ceil(this.config.combat.respawnSeconds / STEP);
  }

  private respawnForPractice(player: Player): void {
    player.state = this.freshState(player.slot, player.mech);
    player.hp = createHealth(this.config.zones);
    player.loadout = freshLoadout(this.config.weapons, this.config.loot);
    player.looted = false;
    player.dead = false;
    player.respawnTick = 0;
  }

  private checkMatchOver(): void {
    if (this.state !== "active") return;
    const alive = this.alivePlayers();
    // A match that began with one player runs until they fall or time runs out, so a solo test is not over at once.
    const over = this.startedWith >= 2 ? alive.length <= 1 : alive.length === 0;
    if (over) this.endMatch(alive.length === 1 ? alive[0]! : null);
  }

  private endMatch(winner: Player | null): void {
    this.state = "results";
    this.phaseEndTick = this.tickCount + Math.ceil(this.config.match.resultsSeconds / STEP);
    const message: ServerMessage = { t: "result", winnerId: winner?.id ?? null, stats: topStats([...this.players.values()]) };
    for (const p of this.players.values()) p.send(message);
    this.broadcastRoom();
    this.prepareNextMap();
  }

  private afterResults(): void {
    if (this.config.match.autoNextMatch && this.players.size > 0) this.beginCountdown();
    else {
      this.state = "lobby";
      this.broadcastRoom();
    }
  }

  // Everyone outside the ring takes its damage on every zone, every tick.
  private applyRing(): void {
    if (!this.ring) return;
    const elapsed = this.elapsedSeconds();
    const ring = this.ringNow;
    if (elapsed >= this.config.match.matchSeconds) {
      // Time is up. The healthiest survivor wins.
      const alive = this.alivePlayers();
      const health = (p: Player) => p.hp.reduce((a, b) => a + b, 0);
      alive.sort((a, b) => health(b) - health(a));
      this.endMatch(alive[0] ?? null);
      return;
    }
    // The same circle the clients draw, worked out from the same schedule and the match clock.
    ringAt(this.ring, elapsed, ring);
    for (const player of this.alivePlayers()) {
      if (!isOutsideRing(ring, player.state.x, player.state.z)) continue;
      noteCause(player, CAUSE_RING);
      for (let zone = 0; zone < ZONE_COUNT; zone++) applyDamage(player.hp, this.config.zones, zone, ring.damagePerSecond * STEP);
      if (isDestroyed(player.hp)) this.eliminate(player, null);
    }
  }

  // ---- movement and combat

  private processInput(player: Player, input: MechInput, dt = STEP): void {
    // A destroyed or frozen mech can look around but not move, jet, or fire.
    // Players watch from the lobby phases too, and everyone stands still during the countdown.
    if (player.dead || this.state === "countdown") {
      input.moveX = 0; input.moveY = 0; input.run = false; input.jet = false; input.dash = false; input.fire = false; input.grenade = false; input.ability = false;
    }
    const dashBefore = player.state.dashTime;
    const ability = this.abilityFor(player.state.mech);
    // Hit while charging a Rail Shot: the charge breaks and the shot is lost (the cooldown is still spent).
    const hp = player.hp[0]! + player.hp[1]! + player.hp[2]!;
    if (ability?.kind === "rail" && player.state.abilityTime > 0 && hp < player.railHpMark) player.state.abilityTime = 0;
    player.railHpMark = hp;
    const abilityBefore = player.state.abilityTime, cooldownBefore = player.state.abilityCooldown;
    if (abilityBefore <= 0) { player.launchX = player.state.x; player.launchZ = player.state.z; }
    player.state.crawling = player.hp[ZONE_LEGS]! <= 0;
    player.state.fuelScale = upgradeScale(player.loadout, this.config.upgrades, "fuel");
    player.state.speedScale = upgradeScale(player.loadout, this.config.upgrades, "speed");
    stepMech(player.state, input, this.statsFor(player.state.mech), dt, this.map.world, ability);
    if (ability) this.afterAbilityStep(player, input, ability, abilityBefore, cooldownBefore);
    player.steps += Math.round(dt / STEP);
    const footsteps = this.footstepShare(player.state);
    if (player.state.running) this.makeNoise(player, "run", player.state.x, player.state.z, player.quietUntil, footsteps);
    if (player.state.jetting) this.makeNoise(player, "jets", player.state.x, player.state.z);
    if (dashBefore <= 0 && player.state.dashTime > 0) this.makeNoise(player, "dash", player.state.x, player.state.z, player.quietUntil, footsteps);

    // Weapons switch when the client asks for a different slot than last time, not every step it keeps asking:
    // the server can change the weapon in hand itself (taking one into an empty slot), and an input already on its
    // way from before that must not switch it straight back.
    if (input.slot !== player.askedSlot) {
      player.askedSlot = input.slot;
      if (!player.dead && selectSlot(player.loadout, input.slot)) player.gate.holdUntil(player.steps * STEP + this.config.loot.switchSeconds);
    }
    if (input.fire) this.tryShoot(player, input);
    if (input.grenade) this.tryThrow(player, input);
    if (!player.dead && player.participant && this.state !== "countdown") {
      this.interact(player, input.interact, dt);
      this.walkOver(player);
      this.repair(player, input, dt);
    } else {
      player.interactHeld = false;
      this.stopLooting(player);
      this.stopRepair(player);
    }
    if (player.state.y < KILL_HEIGHT && !player.dead) this.fellOffMap(player);
  }

  // Outside a running match nothing can be lost, so a fall just puts you back on your spawn.
  private fellOffMap(player: Player): void {
    if (this.state === "active") this.eliminate(player, null);
    else player.state = this.freshState(player.slot, player.mech);
  }

  private tryShoot(player: Player, input: MechInput): void {
    const weaponIndex = activeWeapon(player.loadout);
    const weapon = this.config.weapons.weapons[weaponIndex];
    if (!weapon || !player.gate.tryFire(player.steps * STEP, weapon.shotsPerSecond * upgradeScale(player.loadout, this.config.upgrades, "fireRate"))) return;
    // A mech with two guns fires them in turn; every pellet of one pull leaves the same muzzle.
    const muzzles = this.muzzlesFor(player.state.mech);
    const muzzle = muzzles[player.shotsFired++ % muzzles.length]!;
    // A scattergun fires several pellets with one pull. Each is its own shot, with its own spread and its own hit.
    for (let i = 0; i < weapon.pellets; i++) this.firePellet(player, input, weapon, weaponIndex, muzzle);
    this.makeNoise(player, "shot", player.state.x, player.state.z);
  }

  private firePellet(player: Player, input: MechInput, weapon: WeaponStats, weaponIndex: number, muzzle: readonly number[]): void {
    // The aim point is only a direction hint, so it cannot send a shot faster or from anywhere but the barrel.
    // A broken arm still fires, just nowhere near where it is pointed.
    const spread = player.hp[ZONE_ARMS]! <= 0 ? this.config.zones.brokenArmsSpreadMultiplier : 1;
    computeShot(player.state, input.targetX, input.targetY, input.targetZ, weapon, this.random, this.shot, spread, muzzle);
    const s = this.shot;

    // How far the shot goes: the nearest wall, unless a mech is in the way.
    let reach = weapon.maxAimDistance;
    let hitBox = -1;
    if (this.map.world.raycast(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.worldHit)) { reach = this.worldHit.distance; hitBox = this.worldHit.index; }

    // Shots do damage in the lobby too, so there is something to practise on. Only the countdown is safe.
    let target = this.state !== "countdown" ? this.findTarget(player, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach) : null;
    if (target) reach = this.zoneHit.distance;
    // The Titan, when it stands nearer than any mech the shot met. It is too slow to need rewinding for lag.
    let titanHit = this.state === "active" && this.titan?.raycast(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.titanHit) === true;
    if (titanHit) { target = null; reach = this.titanHit.distance; }
    // A decoy in front of everything else takes the shot and bursts. No damage and no hit marker: the pop is the tell.
    const decoy = decoyAlong(this.decoys, player.id, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.zonesFor, this.decoyHit);
    if (decoy) {
      reach = this.decoyHit.distance;
      target = null;
      titanHit = false;
      this.popDecoy(decoy, player);
    } else if (titanHit) {
      const zone = this.titanHit.zone;
      this.hurtTitan(player, weapon.damage * this.titan!.zoneMultiplier(zone), zone, s.ox + s.dx * reach, s.oy + s.dy * reach, s.oz + s.dz * reach);
    } else if (target) {
      const damage = weapon.damage * this.shieldFactor(target, s.dx, s.dz);
      const taken = applyDamage(target.hp, this.zonesFor(target.state.mech), this.zoneHit.zone, damage, target.loadout.armor);
      this.hurt(target, weaponCause(weaponIndex), player, taken);
      const killed = !target.dead && isDestroyed(target.hp);
      player.send({
        t: "hit", targetId: target.id, zone: this.zoneHit.zone, damage: taken, killed,
        x: s.ox + s.dx * reach, y: s.oy + s.dy * reach, z: s.oz + s.dz * reach,
      });
      if (killed) this.eliminate(target, player);
    } else if (hitBox >= 0 && this.state !== "countdown") {
      const prop = this.map.propOfBox[hitBox]!;
      if (prop >= 0) this.damageProp(prop, weapon.damage, player);
    }

    const message: ServerMessage = {
      t: "shot", id: player.id, ox: s.ox, oy: s.oy, oz: s.oz, dx: s.dx, dy: s.dy, dz: s.dz, length: reach, hitMech: target !== null || decoy !== null || titanHit,
    };
    this.sendNear(s.ox, s.oz, message, player);
  }

  // A ramming mech has its shield out in front: a shot coming at it head on, against the charge, does only part of
  // its damage. Grenade splash goes round the shield and is left alone.
  private shieldFactor(target: Player, dx: number, dz: number): number {
    const ability = this.abilityFor(target.state.mech);
    if (ability?.kind !== "ram" || target.state.abilityTime <= 0) return 1;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return 1;
    const along = (dx * target.state.abilityX + dz * target.state.abilityZ) / length;
    // A shot travelling against the charge (cosine below -shieldFrontCosine) hits the shield.
    return along < -ability.shieldFrontCosine ? ability.frontDamageMultiplier : 1;
  }

  // Finds the nearest living mech along the shot, checked at where it stood a moment ago, because
  // the shooter was looking at a slightly old picture. Result zone and distance are left in this.zoneHit.
  private findTarget(shooter: Player, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number): Player | null {
    // Rewind by what this shooter actually saw, never more than the cap, so the shot lands where they aimed.
    const lagMs = Math.min(shooter.lagMs, this.config.combat.lagCompensationMs);
    const rewindTicks = Math.min(this.historyLength - 1, Math.round(lagMs / (STEP * 1000)));
    const wanted = this.tickCount - rewindTicks;
    let best: Player | null = null;
    let bestDistance = reach;
    let bestZone = -1;

    for (const target of this.players.values()) {
      if (target === shooter || target.dead || !target.participant) continue;
      const index = ((wanted % this.historyLength) + this.historyLength) % this.historyLength;
      const old = target.historyTick[index] === wanted;
      const x = old ? target.history[index * 4]! : target.state.x;
      const y = old ? target.history[index * 4 + 1]! : target.state.y;
      const z = old ? target.history[index * 4 + 2]! : target.state.z;
      const yaw = old ? target.history[index * 4 + 3]! : target.state.bodyYaw;

      const zones = this.zonesFor(target.state.mech);
      if (raycastMech(ox, oy, oz, dx, dy, dz, bestDistance, x, y, z, yaw, zones, this.zoneHit)) {
        best = target;
        bestDistance = this.zoneHit.distance;
        bestZone = this.zoneHit.zone;
      }
    }
    if (best) {
      this.zoneHit.distance = bestDistance;
      this.zoneHit.zone = bestZone;
    }
    return best;
  }

  private tryThrow(player: Player, input: MechInput): void {
    const { grenade } = this.config;
    if (player.loadout.grenades <= 0 || player.hp[ZONE_ARMS]! <= 0) return; // no arm to throw with
    if (!player.grenadeGate.tryFire(player.steps * STEP, 1 / grenade.cooldownSeconds)) return;
    player.loadout.grenades--;
    throwGrenade(player.state, input.targetX, input.targetY, input.targetZ, grenade, this.newGrenade);
    const g = this.newGrenade;
    this.grenades.push({ ownerId: player.id, state: { ...g } });
    const message: ServerMessage = { t: "grenade", id: player.id, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz };
    this.sendNear(g.x, g.z, message, player);
  }

  private stepGrenades(): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const live = this.grenades[i]!;
      if (!stepGrenade(live.state, this.config.grenade, STEP, this.map.world)) continue;
      this.grenades.splice(i, 1);
      this.explode(live);
    }
  }

  private explode(live: LiveGrenade): void {
    const g = live.state;
    const { grenade } = this.config;
    this.blast(g.x, g.y, g.z, grenade.damage, grenade.blastRadius, this.players.get(live.ownerId) ?? null, CAUSE_GRENADE);
  }

  // Splash hits every zone of everyone in range, so a close blast wrecks parts and makes a story. Walls block it,
  // props in range take damage too (so barrels set each other off), and it does nothing during the countdown.
  private blast(x: number, y: number, z: number, damage: number, radius: number, owner: Player | null, cause: number): void {
    const { zones } = this.config;
    const bx = x, by = y + BLAST_LIFT, bz = z;
    const message: ServerMessage = { t: "explode", x, y, z };
    this.sendNear(x, z, message, owner ?? undefined);
    this.makeNoise(owner, "explosion", x, z);
    if (this.state === "countdown") return;

    for (const target of this.players.values()) {
      if (target.dead || !target.participant) continue;
      const dx = target.state.x - bx, dy = target.state.y + CHEST_HEIGHT - by, dz = target.state.z - bz;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= radius) continue;
      if (distance > 0.5 && this.map.world.raycast(bx, by, bz, dx / distance, dy / distance, dz / distance, distance - 0.5, this.worldHit)) continue;

      const amount = damage * (1 - distance / radius);
      let total = 0;
      for (let zone = 0; zone < ZONE_COUNT; zone++) total += applyDamage(target.hp, this.zonesFor(target.state.mech), zone, amount, target.loadout.armor);
      this.hurt(target, cause, owner, total);
      const killed = isDestroyed(target.hp);
      owner?.send({ t: "hit", targetId: target.id, zone: -1, damage: total, killed, x: target.state.x, y: target.state.y + CHEST_HEIGHT, z: target.state.z });
      if (killed) this.eliminate(target, owner);
    }

    // The Titan is too big for walls to shelter it: it takes its share of any blast that reaches its body.
    const titanShare = this.titan?.blastShare(bx, by, bz, radius) ?? 0;
    if (titanShare > 0) this.hurtTitan(owner, damage * titanShare * this.config.titan.blastMultiplier, -1, this.titan!.x, this.titan!.y + this.config.titan.aimHeight, this.titan!.z);

    // Measured to the nearest height on the prop, so a blast at the foot of a 12 m pine hits its trunk, not a point
    // 6 m up. Looked up through the world's grid: a large map has thousands of trees.
    const count = this.propsTouching(bx - radius, bz - radius, bx + radius, bz + radius);
    for (let i = 0; i < count; i++) {
      const prop = this.map.props[this.nearProps[i]!]!;
      const box = this.map.world.boxes[prop.boxIndex]!;
      const distance = Math.hypot(prop.x - bx, Math.max(box.minY, Math.min(by, box.maxY)) - by, prop.z - bz);
      if (distance < radius) this.damageProp(prop.id, damage * (1 - distance / radius), owner);
    }

    for (const d of [...this.decoys]) {
      const dx = d.state.x - bx, dy = d.state.y + CHEST_HEIGHT - by, dz = d.state.z - bz;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= radius) continue;
      if (distance > 0.5 && this.map.world.raycast(bx, by, bz, dx / distance, dy / distance, dz / distance, distance - 0.5, this.worldHit)) continue;
      this.popDecoy(d, owner);
    }
  }

  // ---- abilities

  // What a ram or a leap does to everyone else. The movement itself is in the shared mech step, so the client
  // predicts it; hits, damage and shoves are the server's alone.
  private afterAbilityStep(player: Player, input: MechInput, ability: AbilityStats, timeBefore: number, cooldownBefore: number): void {
    const s = player.state;
    // The cooldown only jumps up on the step the ability starts. Watching it rather than the active time also catches
    // a ram that a wall stops on its very first step.
    const started = s.abilityCooldown > cooldownBefore;
    if (started && ability.kind === "barrage") this.callStrike(player, input, ability);
    else if (started && ability.kind === "decoy") this.dropDecoys(player, ability);
    else if (started) {
      player.rammed.length = 0;
      this.sendNear(s.x, s.z, { t: "ability", id: player.id, kind: ability.kind, event: "start", x: s.x, y: s.y, z: s.z }, player);
      this.makeNoise(player, "dash", s.x, s.z);
    }
    if (ability.kind === "ram") {
      // Includes the step the charge ends on, which is often the one that reached the wall or the target.
      if (started || timeBefore > 0) this.ramContact(player, ability);
    } else if (ability.kind === "pounce" && timeBefore > 0 && s.abilityTime <= 0 && s.grounded) {
      this.slam(player, ability);
    } else if (ability.kind === "rail" && timeBefore > 0 && s.abilityTime <= 0) {
      this.fireRail(player, input, ability);
    }
  }

  // The Rail Shot goes off at the end of its charge, along wherever the mech aims now, from its gun: one ray, no
  // spread, to the first wall, rock or mech within range. Everyone near either end sees the beam.
  private fireRail(player: Player, input: MechInput, rail: RailStats): void {
    const muzzle = this.muzzlesFor(player.state.mech)[0]!;
    const weapon = this.config.weapons.weapons[activeWeapon(player.loadout)] ?? this.config.weapons.weapons[0]!;
    computeShot(player.state, input.targetX, input.targetY, input.targetZ, weapon, this.random, this.shot, 0, muzzle);
    const s = this.shot;
    let reach = rail.range;
    let hitBox = -1;
    if (this.map.world.raycast(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.worldHit)) { reach = this.worldHit.distance; hitBox = this.worldHit.index; }
    let target = this.findTarget(player, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach);
    if (target) reach = this.zoneHit.distance;
    const titanHit = this.state === "active" && this.titan?.raycast(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.titanHit) === true;
    if (titanHit) {
      target = null;
      reach = this.titanHit.distance;
      const zone = this.titanHit.zone;
      this.hurtTitan(player, rail.damage * this.titan!.zoneMultiplier(zone), zone, s.ox + s.dx * reach, s.oy + s.dy * reach, s.oz + s.dz * reach);
    } else if (target) {
      const taken = applyDamage(target.hp, this.zonesFor(target.state.mech), this.zoneHit.zone, rail.damage * this.shieldFactor(target, s.dx, s.dz), target.loadout.armor);
      this.hurt(target, abilityCause(rail.kind), player, taken);
      noteLongest(player.tally, "longestRailShot", reach);
      const killed = !target.dead && isDestroyed(target.hp);
      player.send({ t: "hit", targetId: target.id, zone: this.zoneHit.zone, damage: taken, killed, x: s.ox + s.dx * reach, y: s.oy + s.dy * reach, z: s.oz + s.dz * reach });
      if (killed) this.eliminate(target, player);
    } else if (hitBox >= 0) {
      const prop = this.map.propOfBox[hitBox]!;
      if (prop >= 0) this.damageProp(prop, rail.damage, player);
    }
    const ex = s.ox + s.dx * reach, ey = s.oy + s.dy * reach, ez = s.oz + s.dz * reach;
    this.sendNearEither(s.ox, s.oz, ex, ez, { t: "ability", id: player.id, kind: "rail", event: "hit", x: ex, y: ey, z: ez }, player);
    this.makeNoise(player, "explosion", player.state.x, player.state.z);
  }

  // A ram hits each mech it passes through once, shoving it along the charge, and smashes any prop it drives into.
  private ramContact(player: Player, ram: RamStats): void {
    const s = player.state;
    const height = this.statsFor(s.mech).height;
    for (const target of this.players.values()) {
      if (target === player || target.dead || !target.participant || player.rammed.includes(target.id)) continue;
      const t = target.state;
      if (Math.hypot(t.x - s.x, t.z - s.z) > ram.hitRadius || Math.abs(t.y - s.y) > height) continue;
      player.rammed.push(target.id);
      // Topped up to the knockback along the charge rather than added, so a mech running into the ram is still sent
      // flying the same distance and one already moving away does not get double.
      const along = t.vx * s.abilityX + t.vz * s.abilityZ;
      if (along < ram.knockback) {
        t.vx += s.abilityX * (ram.knockback - along);
        t.vz += s.abilityZ * (ram.knockback - along);
      }
      t.vy = Math.max(t.vy, ram.pop); // a little air, so it slides instead of grinding to a halt on its feet
      this.sendNear(t.x, t.z, { t: "ability", id: player.id, kind: "ram", event: "hit", x: t.x, y: t.y, z: t.z }, player);
      this.abilityDamage(player, target, ram.damage, abilityCause(ram.kind));
    }
    this.popDecoysAround(s.x, s.y, s.z, ram.hitRadius, height, player);
    this.abilityOnTitan(player, ram.hitRadius, ram.damage);

    this.smashProps(player, ram.hitRadius, height);
  }

  // A pounce comes down blade first: everyone near the landing spot takes the slam, and what stands there breaks. A
  // leap that ends against a trunk lands at its foot, so the tree goes down with it.
  private slam(player: Player, pounce: PounceStats): void {
    const s = player.state;
    const height = this.statsFor(s.mech).height;
    this.sendNear(s.x, s.z, { t: "ability", id: player.id, kind: "pounce", event: "land", x: s.x, y: s.y, z: s.z }, player);
    this.makeNoise(player, "smash", s.x, s.z);
    noteLongest(player.tally, "longestPounce", Math.hypot(s.x - player.launchX, s.z - player.launchZ));
    for (const target of this.players.values()) {
      if (target === player || target.dead || !target.participant) continue;
      const t = target.state;
      if (Math.hypot(t.x - s.x, t.z - s.z) > pounce.slamRadius || Math.abs(t.y - s.y) > height) continue;
      this.abilityDamage(player, target, pounce.damage, abilityCause(pounce.kind));
    }
    this.popDecoysAround(s.x, s.y, s.z, pounce.slamRadius, height, player);
    this.abilityOnTitan(player, pounce.slamRadius, pounce.damage);
    this.smashProps(player, pounce.slamRadius, height);
  }

  // Every prop within reach of a ram or a slam, at about the mech's height, is smashed outright with all its
  // remaining hit points: a charge or a blade goes through cover, it does not chip at it. Trees too.
  // The rule is shared (propsInReach), because the rammer's own client applies it in prediction too.
  private smashProps(player: Player, radius: number, height: number): void {
    this.smashPropsAt(player.state.x, player.state.y, player.state.z, radius, height, player);
  }

  // The same round any spot: the Junk Titan walks through props and its stomp breaks everything round its feet.
  private smashPropsAt(x: number, y: number, z: number, radius: number, height: number, by: Player | null): void {
    const count = propsInReach(this.map.world, this.map.propOfBox, x, y, z, radius, height, this.nearBoxes, this.nearProps);
    for (let i = 0; i < count; i++) {
      const id = this.nearProps[i]!;
      if (this.propHp[id]! > 0) this.damageProp(id, this.propHp[id]!, by);
    }
  }

  // Mortar Strike. The warning goes up at the target at once, for whoever is near it and whoever is near the
  // Cataclysm (who sees it called in); the launch is loud, so the Cataclysm shows on radar. The shells come down
  // later whatever happens to the Cataclysm meanwhile, and are still its kills.
  private callStrike(player: Player, input: MechInput, strike: BarrageStats): void {
    const s = player.state;
    const at = this.strikeAt;
    barrageTarget(s.x, s.z, input.targetX, input.targetZ, s.abilityX, s.abilityZ, strike, at);
    const y = this.groundAt(at.x, at.z, input.targetY);
    const message: ServerMessage = { t: "ability", id: player.id, kind: "barrage", event: "start", x: at.x, y, z: at.z };
    this.sendNearEither(at.x, at.z, s.x, s.z, message, player);
    this.makeNoise(player, "shot", s.x, s.z);
    for (let i = 0; i < strike.shells; i++) {
      const r = strike.spreadMeters * Math.sqrt(this.random()), angle = this.random() * Math.PI * 2;
      const x = at.x + Math.cos(angle) * r, z = at.z + Math.sin(angle) * r;
      const tick = this.tickCount + Math.round((strike.delaySeconds + i * strike.shellSeconds) / STEP);
      this.pendingBlasts.push({ x, y: this.groundAt(x, z, y), z, tick, owner: player, damage: strike.damage, radius: strike.blastRadius, cause: abilityCause(strike.kind) });
    }
  }

  // The height of whatever is under a spot, from a ray straight down, or `fallback` where there is nothing.
  private groundAt(x: number, z: number, fallback: number): number {
    if (this.map.world.raycast(x, SKY_HEIGHT, z, 0, -1, 0, SKY_HEIGHT * 2, this.worldHit)) return SKY_HEIGHT - this.worldHit.distance;
    return fallback;
  }

  // The top of whatever is under a spot, looking down from a little above `fromY`: a floor, a roof the mech stood on,
  // or the hillside. Never under the hillside, even where a slope rises above where the ray starts.
  private surfaceBelow(x: number, z: number, fromY: number): number {
    const top = fromY + DROP_LOOK_UP;
    const surface = this.map.world.raycast(x, top, z, 0, -1, 0, SKY_HEIGHT * 2, this.worldHit) ? top - this.worldHit.distance : fromY;
    return Math.max(surface, this.map.world.groundAt(x, z));
  }

  // Decoy Drones. Only the owner is told, with the decoys' ids so it can draw its own see-through: a start message to
  // anyone else would let a client read which Arbiters are fake. Everyone else just sees more Arbiters.
  private dropDecoys(player: Player, decoy: DecoyStats): void {
    const s = player.state;
    const fresh = spawnDecoys(s, player.id, this.statsFor(s.mech), decoy, () => this.nextId++);
    this.decoys.push(...fresh);
    const ids = fresh.map((d) => d.id);
    player.send({ t: "ability", id: player.id, kind: "decoy", event: "start", x: s.x, y: s.y, z: s.z, ids });
    this.makeNoise(player, "dash", s.x, s.z);
  }

  private stepDecoys(): void {
    for (const d of [...this.decoys]) {
      const owner = this.players.get(d.ownerId);
      if (!owner || !stepDecoy(d, this.statsFor(d.state.mech), this.map.world, STEP, owner.state.x, owner.state.z)) {
        this.popDecoy(d, null);
        continue;
      }
      // Footsteps on the radar like the real thing. The owner is the source, so it does not hear its own decoys.
      if (d.state.running) this.makeNoise(owner, "run", d.state.x, d.state.z, d.quietUntil, this.footstepShare(d.state));
    }
  }

  // Shot, blasted, rammed, slammed, out of time or left without its owner: the decoy bursts where it stands, with a
  // crash anyone near can hear.
  private popDecoy(decoy: Decoy, by: Player | null): void {
    if (!this.removeDecoy(decoy)) return;
    const { x, y, z } = decoy.state;
    this.sendNear(x, z, { t: "ability", id: decoy.id, kind: "decoy", event: "pop", x, y, z }, by ?? undefined);
    this.makeNoise(null, "smash", x, z);
  }

  private removeDecoy(decoy: Decoy): boolean {
    const index = this.decoys.indexOf(decoy);
    if (index < 0) return false;
    this.decoys.splice(index, 1);
    // Ids are never reused, so a gone decoy's would only pile up in everyone's view list.
    for (const p of this.players.values()) p.interested.delete(decoy.id);
    return true;
  }

  // Every decoy within reach of a ram or a slam, at about the same height, the same test the mechs get.
  private popDecoysAround(x: number, y: number, z: number, radius: number, height: number, by: Player): void {
    for (const d of [...this.decoys]) {
      if (d.ownerId === by.id) continue;
      if (Math.hypot(d.state.x - x, d.state.z - z) <= radius && Math.abs(d.state.y - y) <= height) this.popDecoy(d, by);
    }
  }

  // Rams and slams land on the upper body, half on the arms and half on the torso: a shield bash and a blade cut
  // both strike high. Legs are left out so crippling a mech stays the job of aimed shots. Armor and each mech's own
  // toughness count as they do for a shot.
  private abilityDamage(attacker: Player, target: Player, damage: number, cause: number): void {
    const zones = this.zonesFor(target.state.mech);
    const t = target.state;
    const total = applyDamage(target.hp, zones, ZONE_ARMS, damage / 2, target.loadout.armor) + applyDamage(target.hp, zones, ZONE_TORSO, damage / 2, target.loadout.armor);
    this.hurt(target, cause, attacker, total);
    const killed = isDestroyed(target.hp);
    attacker.send({ t: "hit", targetId: target.id, zone: -1, damage: total, killed, x: t.x, y: t.y + CHEST_HEIGHT, z: t.z });
    if (killed) this.eliminate(target, attacker);
  }

  // Notes what hurt a mech, for its knockout card, and the damage for its attacker's match tally. Hurting yourself
  // with your own grenade is a cause but not a score.
  private hurt(target: Player, cause: number, by: Player | null, taken: number): void {
    noteCause(target, cause);
    if (by && by !== target) by.tally.mostDamage += taken;
  }

  // ---- pickups

  // Grenades and plates are collected just by walking over them, when they are any use.
  private walkOver(player: Player): void {
    for (const p of this.pickups.within(player.state.x, player.state.z, this.config.loot.pickupRadius)) {
      if (itemWeapon(p.item) >= 0) continue;
      if (collectSmall(player.loadout, p.item, this.config.loot)) this.pickups.remove(p.id);
    }
  }

  // E does one of two things. A press takes the nearest weapon in reach. Held beside a wreck, it loots it: that takes
  // a couple of seconds, is loud, and starts again if you let go or step away. Ranges are checked here, never
  // trusted from the client.
  private interact(player: Player, held: boolean, dt: number): void {
    const { loot } = this.config;
    const pressed = held && !player.interactHeld;
    player.interactHeld = held;
    if (!held) return this.stopLooting(player);
    if (pressed && this.tickCount >= player.interactReadyTick) {
      player.interactReadyTick = this.tickCount + Math.round(loot.interactCooldownSeconds / STEP);
      if (this.takeInReach(player)) return this.stopLooting(player);
    }

    const wreck = this.nearestWreck(player, loot.interactRange);
    if (!wreck) return this.stopLooting(player);
    if (wreck.id !== player.lootingId) { player.lootingId = wreck.id; player.lootSeconds = 0; }
    player.lootSeconds += dt * upgradeScale(player.loadout, this.config.upgrades, "lootSpeed");
    this.makeNoise(player, "loot", player.state.x, player.state.z);
    if (player.lootSeconds < loot.wreckLootSeconds) return;
    this.spill(wreck);
    this.stopLooting(player);
  }

  // F held, standing still, fixes the worst part back to running order (not new) after a few seconds. Moving, firing,
  // jetting, letting go or taking any damage at all starts it over. It is loud, so repairing is a gamble.
  private repair(player: Player, input: MechInput, dt: number): void {
    const { zones } = this.config;
    let health = 0;
    for (let zone = 0; zone < ZONE_COUNT; zone++) health += player.hp[zone]! + player.loadout.armor[zone]!;
    const hurt = health < player.healthMark;
    player.healthMark = health;
    const still = input.moveX === 0 && input.moveY === 0 && !input.fire && !input.jet && !input.dash && !input.grenade;
    const zone = partToRepair(player.hp, zones);
    if (!input.repair || !still || hurt || zone < 0) return this.stopRepair(player);

    if (zone !== player.repairZone) { player.repairZone = zone; player.repairSeconds = 0; }
    player.repairSeconds += dt * upgradeScale(player.loadout, this.config.upgrades, "repairSpeed");
    this.makeNoise(player, "repair", player.state.x, player.state.z);
    if (player.repairSeconds < zones.repairSeconds) return;
    player.hp[zone] = zones.zones[zone]!.hp * zones.repairToFraction;
    this.stopRepair(player);
  }

  private stopRepair(player: Player): void {
    player.repairZone = -1;
    player.repairSeconds = 0;
  }

  private stopLooting(player: Player): void {
    player.lootingId = 0;
    player.lootSeconds = 0;
  }

  // The nearest weapon or upgrade in reach that can be taken (not an upgrade already fitted). What it replaces drops
  // at your feet.
  private takeInReach(player: Player): boolean {
    const l = player.loadout;
    const pickup = this.pickups.nearest(player.state.x, player.state.z, this.config.loot.interactRange,
      (p) => takenWithE(p.item) && (itemUpgrade(p.item) < 0 || !l.upgrades.includes(itemUpgrade(p.item))));
    if (!pickup) return false;
    this.pickups.remove(pickup.id);
    const { x, z } = player.state;
    if (itemUpgrade(pickup.item) >= 0) {
      const dropped = takeUpgrade(l, pickup.item);
      if (dropped !== null && dropped >= 0) this.pickups.add(upgradeItem(dropped), x, this.surfaceBelow(x, z, player.state.y) + PICKUP_LIFT, z);
      return true;
    }
    const dropped = takeWeapon(l, pickup.item);
    if (dropped >= 0) this.pickups.add(weaponItem(dropped), x, this.surfaceBelow(x, z, player.state.y) + PICKUP_LIFT, z);
    player.gate.holdUntil(player.steps * STEP + this.config.loot.switchSeconds);
    return true;
  }

  // A looted wreck throws everything it carried on the ground round it, in a ring, and its plates come off.
  private spill(wreck: Player): void {
    const items = spillItems(wreck.loadout);
    const start = this.random() * Math.PI * 2;
    const r = this.config.loot.spillRadius;
    items.forEach((item, i) => {
      const angle = start + (i / items.length) * Math.PI * 2;
      let x = wreck.state.x + Math.cos(angle) * r, z = wreck.state.z + Math.sin(angle) * r;
      // A wreck at an island's wading limit keeps its loot on the near side of it, where it can be picked up.
      if (this.map.world.terrain && !this.map.world.terrain.mayMove(wreck.state.x, wreck.state.z, x, z)) { x = wreck.state.x; z = wreck.state.z; }
      this.pickups.add(item, x, this.surfaceBelow(x, z, wreck.state.y) + PICKUP_LIFT, z);
    });
    wreck.looted = true;
    wreck.loadout = { slots: [-1, -1], active: 0, grenades: 0, armor: [0, 0, 0], upgrades: [-1, -1] };
  }

  // ---- props

  private resetProps(): void {
    this.propHp = new Float32Array(this.map.props.length);
    this.map.props.forEach((p) => { this.propHp[p.id] = this.config.props.types[p.type]!.hp; });
    this.destroyedProps = [];
  }

  // A prop that runs out of hit points is gone: its box leaves the world, everyone in the room is told (collision has
  // to match for everyone's prediction), it makes a loud crash, and a barrel goes off a moment later.
  private damageProp(id: number, amount: number, by: Player | null): void {
    if (this.propHp[id]! <= 0) return;
    this.propHp[id] = this.propHp[id]! - amount;
    if (this.propHp[id]! > 0) return;

    const prop = this.map.props[id]!;
    const type = this.config.props.types[prop.type]!;
    if (by) {
      by.tally.propsSmashed++;
      if (type.scenery) by.tally.treesFelled++; // the pine is the only scenery prop
      if (type.explodes) by.tally.barrelsSetOff++;
    }
    this.map.world.disable(prop.boxIndex);
    this.destroyedProps.push(id);
    const message: ServerMessage = { t: "prop", id };
    for (const p of this.players.values()) if (!p.bot) p.send(message);
    this.makeNoise(by, "smash", prop.x, prop.z);
    const item = rollLoot(this.config.loot, this.config.weapons, this.config.upgrades.upgrades.length, type.id, this.random);
    // Its box is already out of the world, so the drop finds the ground the prop stood on.
    if (item !== null) {
      const x = prop.x + (this.random() - 0.5), z = prop.z + (this.random() - 0.5);
      this.pickups.add(item, x, this.surfaceBelow(x, z, prop.y) + PICKUP_LIFT, z);
    }
    if (type.explodes) {
      const delay = Math.round(this.config.props.barrelBlast.delaySeconds / STEP);
      const { damage, radius } = this.config.props.barrelBlast;
      this.pendingBlasts.push({ x: prop.x, y: this.surfaceBelow(prop.x, prop.z, prop.y), z: prop.z, tick: this.tickCount + delay, owner: by, damage, radius, cause: CAUSE_BARREL });
    }
  }

  // The props still standing whose boxes touch a rectangle, into this.nearProps. Returns how many.
  private propsTouching(minX: number, minZ: number, maxX: number, maxZ: number): number {
    const boxes = this.map.world.query(minX, minZ, maxX, maxZ, this.nearBoxes);
    let count = 0;
    for (let i = 0; i < boxes; i++) {
      const id = this.map.propOfBox[this.nearBoxes[i]!]!;
      if (id >= 0 && this.propHp[id]! > 0) this.nearProps[count++] = id;
    }
    return count;
  }

  // Barrels go off a beat after they break, so a chain of them ripples rather than all going at once. Mortar shells
  // wait here too.
  private setOffPendingBlasts(): void {
    for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
      const b = this.pendingBlasts[i]!;
      if (this.tickCount < b.tick) continue;
      this.pendingBlasts.splice(i, 1);
      this.blast(b.x, b.y, b.z, b.damage, b.radius, b.owner, b.cause);
    }
  }

  private recordHistory(player: Player): void {
    const index = this.tickCount % this.historyLength;
    player.historyTick[index] = this.tickCount;
    player.history[index * 4] = player.state.x;
    player.history[index * 4 + 1] = player.state.y;
    player.history[index * 4 + 2] = player.state.z;
    player.history[index * 4 + 3] = player.state.bodyYaw;
  }

  private spawnFor(slot: number): [number, number, number] {
    const { spawns } = this.map;
    return spawns[slot % spawns.length]!;
  }

  // ---- messages out

  private broadcastRoom(): void {
    const message: ServerMessage = {
      t: "room", code: this.code, tier: this.tier, state: this.state, seed: this.seed, hostId: this.hostId,
      players: this.humans().length, ring: this.state === "lobby" ? null : this.ring, matchSeconds: this.config.match.matchSeconds,
      drops: this.state === "lobby" ? null : this.drops,
      difficulty: this.difficulty,
    };
    for (const p of this.players.values()) p.send(message);
  }

  private progress(): { state: MatchState; seconds: number; alive: number; total: number } {
    let seconds = 0;
    if (this.state === "countdown" || this.state === "results") seconds = Math.max(0, (this.phaseEndTick - this.tickCount) * STEP);
    else if (this.state === "active") seconds = this.elapsedSeconds();
    const alive = this.state === "lobby" ? this.players.size : this.alivePlayers().length;
    return { state: this.state, seconds, alive, total: this.state === "lobby" ? this.players.size : this.startedWith || this.players.size };
  }

  // Pickups lie still, so the list near someone rarely changes. It is sent only when it does: a new one appears, one
  // is taken, or one comes into or goes out of range. Snapshots arrive in order, so the client keeps the last list.
  private pickupsChanged(player: Player, near: readonly PickupState[]): PickupState[] | null {
    const sent = player.sentPickupIds;
    if (near.length === sent.length && near.every((p, i) => p.id === sent[i])) return null;
    sent.length = 0;
    for (const p of near) sent.push(p.id);
    return [...near];
  }

  // Something made a sound. Everyone within earshot hears it, at a spot a little off the real one, and bots go to look.
  // A mech makes at most one pulse of each kind every so often, so holding the jets is one pulse a beat, not sixty.
  // `quiet` is whose pulse timer to use, normally the source's own; a decoy has its own, so its footsteps and its
  // owner's are heard separately. `share` scales how far it carries: footsteps in water are muffled.
  private makeNoise(source: Player | null, kind: NoiseKind, x: number, z: number, quiet = source?.quietUntil, share = 1): void {
    const { noise } = this.config;
    const k = NOISE_KINDS.indexOf(kind);
    if (quiet) {
      if (this.tickCount < quiet[k]!) return;
      quiet[k] = this.tickCount + Math.round(noise.pulseSeconds / STEP);
    }
    const radius = noise.loudness[kind] * share;
    for (const p of this.players.values()) {
      if (p === source) continue;
      const ear = p.bot ? p.state : this.viewFrom(p);
      const distance = Math.hypot(ear.x - x, ear.z - z);
      if (distance > radius * upgradeScale(p.loadout, this.config.upgrades, "hearing")) continue;
      const off = Math.min(noise.fuzzMaxMeters, distance * noise.fuzzFraction) * Math.sqrt(this.random());
      const angle = this.random() * Math.PI * 2;
      const fx = x + Math.cos(angle) * off, fz = z + Math.sin(angle) * off;
      if (p.bot) {
        if (!p.dead) p.bot.hear(fx, fz, noise.botInvestigateSeconds);
      } else if (p.heard.length < 32) {
        p.heard.push({ x: fx, z: fz, kind: k });
      }
    }
  }

  // How far footsteps carry from a mech standing here: muffled while it wades, in full on dry ground.
  private footstepShare(s: { x: number; y: number; z: number }): number {
    return this.map.world.terrain?.wading(s.x, s.y, s.z) ? this.config.noise.wadingFootsteps : 1;
  }

  // Where a client is looking from: its own mech, or while knocked out the mech it is watching (or, if it has not
  // said, the nearest one still standing). Both what it is sent and which events reach it are measured from here.
  private viewFrom(player: Player): { x: number; z: number } {
    if (!player.dead && player.participant) return player.state;
    const watched = this.players.get(player.watchId);
    if (watched && !watched.dead && watched.participant) return watched.state;
    let best: Player | null = null;
    let bestDistance = Infinity;
    for (const p of this.players.values()) {
      if (p === player || p.dead || !p.participant) continue;
      const d = Math.hypot(p.state.x - player.state.x, p.state.z - player.state.z);
      if (d < bestDistance) { bestDistance = d; best = p; }
    }
    return best ? best.state : player.state;
  }

  // Sends something that happened at a spot only to the people close enough to care, and to whoever caused it.
  private sendNear(x: number, z: number, message: ServerMessage, source?: Player): void {
    const range = this.config.net.interestRange * this.config.net.interestLeaveFactor;
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const view = this.viewFrom(p);
      if (p === source || Math.hypot(view.x - x, view.z - z) <= range) p.send(message);
    }
  }

  // The same, for something seen at two spots at once: sent once to anyone near either.
  private sendNearEither(x1: number, z1: number, x2: number, z2: number, message: ServerMessage, source?: Player): void {
    const range = this.config.net.interestRange * this.config.net.interestLeaveFactor;
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const view = this.viewFrom(p);
      if (p === source || Math.hypot(view.x - x1, view.z - z1) <= range || Math.hypot(view.x - x2, view.z - z2) <= range) p.send(message);
    }
  }

  // Whether a client is near enough the Titan to be sent it, with the same give at the edge as for mechs, so it does
  // not flicker in and out. Its place in the interest list is TITAN_ID.
  private seesTitan(player: Player, view: { x: number; z: number }, titan: TitanState): boolean {
    const { interestRange, interestLeaveFactor } = this.config.net;
    const wasInView = player.interested.has(TITAN_ID);
    const near = Math.hypot(titan.x - view.x, titan.z - view.z) <= (wasInView ? interestRange * interestLeaveFactor : interestRange);
    if (near) player.interested.add(TITAN_ID);
    else player.interested.delete(TITAN_ID);
    return near;
  }

  private broadcastSnapshots(): void {
    const { interestRange, interestLeaveFactor } = this.config.net;
    const everyone: OtherState[] = [];
    for (const p of this.players.values()) {
      if (!p.participant) continue; // spectators have no mech to draw
      everyone.push({
        id: p.id, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.state.bodyYaw,
        running: p.state.running, jetting: p.state.jetting, dead: p.dead, looted: p.looted, repairing: p.repairZone >= 0, bot: p.bot !== null, hp: p.hp.map(Math.ceil),
        weapon: Math.max(0, activeWeapon(p.loadout)), armor: p.loadout.armor.map(Math.ceil), upgrades: p.loadout.upgrades, mech: p.state.mech, ability: p.state.abilityTime > 0,
      });
    }
    // A decoy is drawn exactly as its owner is right now, damage and all, so nothing on it gives it away but how it
    // moves: a smoking Arbiter beside two clean copies would be easy to pick out.
    for (const d of this.decoys) {
      const owner = this.players.get(d.ownerId);
      if (!owner) continue;
      const s = d.state;
      everyone.push({
        id: d.id, x: s.x, y: s.y, z: s.z, yaw: s.bodyYaw, running: s.running, jetting: s.jetting, dead: false, looted: false, repairing: false,
        bot: owner.bot !== null, hp: owner.hp.map(Math.ceil), weapon: Math.max(0, activeWeapon(owner.loadout)), armor: owner.loadout.armor.map(Math.ceil),
        upgrades: owner.loadout.upgrades, mech: s.mech, ability: false,
      });
    }
    const match = this.progress();
    // One copy per snapshot round: messages can be held on to (lag simulation, tests), so it is never written again.
    const titan = this.titan ? this.titan.state({ x: 0, y: 0, z: 0, yaw: 0, hp: 0, action: "walk", actionSeconds: 0 }) : null;
    for (const player of this.players.values()) {
      if (player.bot) continue;
      // Each client gets mechs within the interest range of where it is looking from, and a mech already in view
      // stays until it is clearly further off, so one standing right on the edge does not flicker in and out.
      const view = this.viewFrom(player);
      const others: OtherState[] = [];
      for (const o of everyone) {
        if (o.id === player.id) continue;
        const distance = Math.hypot(o.x - view.x, o.z - view.z);
        const wasInView = player.interested.has(o.id);
        const near = distance <= (wasInView ? interestRange * interestLeaveFactor : interestRange);
        if (near) player.interested.add(o.id);
        else { player.interested.delete(o.id); continue; }
        others.push(o);
      }
      player.send({
        t: "snapshot", tick: this.tickCount, ack: player.lastSeq, ackAgeMs: (this.tickCount - player.ackTick) * STEP * 1000, you: writeSelf(player.state),
        health: { hp: player.hp.map(Math.ceil), dead: player.dead, respawnIn: player.dead && this.state !== "active" ? Math.max(0, (player.respawnTick - this.tickCount) * STEP) : 0 }, match,
        others, noises: player.heard.splice(0),
        loadout: {
          ...player.loadout, slots: [player.loadout.slots[0], player.loadout.slots[1]], armor: player.loadout.armor.map(Math.ceil),
          upgrades: [player.loadout.upgrades[0], player.loadout.upgrades[1]],
        },
        looting: player.lootingId ? player.lootSeconds / this.config.loot.wreckLootSeconds : 0,
        repairing: player.repairZone >= 0 ? player.repairSeconds / this.config.zones.repairSeconds : 0,
        pickups: this.pickupsChanged(player, this.pickups.near(view.x, view.z, interestRange, this.pickupScratch)),
        titan: titan && this.seesTitan(player, view, titan) ? titan : null,
      });
    }
  }
}

// Compares two rejoin secrets in the same time however much of them matches.
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
