import {
  FireGate, FIRE_NONE, FIRE_SECONDARY, STEP, altSpin, createAltFireState, createAltShot, stepAltFire, type AltShot, ZONE_ARMS, ZONE_COUNT, ZONE_LEGS, ZONE_TORSO, applyDamage, propsInReach, computeShot, createGrenade, createHealth, createMechInput,
  createMechState, createRayHit, createRingNow, createShot, createZoneHit, isDestroyed, isOutsideRing, makeRingSchedule, partToRepair, ringOnLand,
  decodeInput, parseClientMessage, ringAt, rollLoot, itemWeapon, weaponItem, raycastMech, stepGrenade, stepMech, throwGrenade, toMechInput, writeSelf,
  NOISE_KINDS, type BotConfig, type CombatStats, type NoiseKind, type NoiseStats, type PropConfig, type PropInstance, type GrenadeState, type GrenadeStats, type MatchConfig, type MatchState, type MechInput,
  type MechStats, type NetStats, type OtherState, type RingConfig, type RingNow, type RingSchedule, type ServerMessage, type ShotMessage, type Terrain,
  takenWithE, itemUpgrade, upgradeItem, upgradeScale, applyTune, assignDeep, parseTunable, setNumberAt, TUNABLE_FILES, type TuningRaws, type UpgradeSet,
  makeZonesFor, makeMuzzlesFor, mechStatsFor, rosterIndex, abilityFor, barrageTarget, type Roster, type AbilitySet, type AbilityStats, type BarrageStats, type RailStats,
  type BotDifficulty, type DecoyStats, type PounceStats, type RamStats,
  ITEM_ARMOR_FIRST, ITEM_GRENADE, type DropsConfig, type SupplyDrop,
  type NavGrid, type LootConfig, type PickupState, type WeaponSet, type WeaponStats, type World, type ZoneSet,
  titanHitBoxes, type TitanConfig, type TitanState,
  dropping, hangAtSpot, planDropSpots, releaseDrop,
  HURT_PLATE, hurtKind, SURFACE_NUDGE, flightSteps, fromMechFrame, toMechFrame, type RivetMessage, type RivetStats,
} from "@rustbucket/shared";
import { Flights, type Landing, type Rivet } from "./flights";
import { Bot, type BotTarget } from "./Bot";
import { parseBotAbilities, type BotAbilityStats } from "./botAbilities";
import type { DropPlan } from "./botDrop";
import type { DropConfig } from "./dropConfig";
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

const NO_PLAYERS: readonly Player[] = [];

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
  // The drop-in that starts every match (data/drop.json). Null starts matches on the ground, which the tests of
  // fights and loot are built around.
  drop: DropConfig | null;
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
  private altShot = createAltShot();
  // Secondary fire so far, by everyone: trigger pulls (all, and by kind), mechs hit by a pierce past the first, and pins.
  // For tests and the soak.
  readonly secondaryCount = { shots: 0, windup: 0, slug: 0, charge: 0, detonate: 0, pierced: 0, pinned: 0 };
  // What rivets have done so far (gate 18b), for tests and the soak.
  readonly projectileCount = { rivetsStuck: 0, rivetsPopped: 0 };
  private flights = new Flights();
  private landedScratch: Landing[] = [];
  private poppingScratch: Rivet[] = [];
  private targetPose = { x: 0, y: 0, z: 0, yaw: 0 }; // where findTarget's mech stood, rewound
  private frame = { x: 0, y: 0, z: 0 }; // scratch for mech frame turns
  private hpBefore = [0, 0, 0]; // a victim's hit points before splash, to tell it how bad the hit was
  private pierced: Player[] = []; // mechs one piercing shot has already gone through
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
  private landed: Player[] = []; // the mechs on the ground this tick, the only ones the Titan knows about
  private dropPlan: DropPlan | null = null; // this match's map and first circle, for bots choosing where to land
  private dropSpots: { x: number; z: number }[] = []; // where each slot hangs before this match's drop-in

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
      gate: new FireGate(), grenadeGate: new FireGate(), alt: createAltFireState(), queue: [], lastSeq: 0, ackTick: 0, lagMs: 0, steps: 0, budget: net.maxMessagesPerSecond,
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
  inspect(): { id: number; bot: boolean; rating: number | null; x: number; y: number; z: number; hp: number[]; dead: boolean; eliminated: boolean; participant: boolean; dropPhase: number; dropTime: number; dropSpot: { x: number; z: number } | null }[] {
    return [...this.players.values()].map((p) => ({
      id: p.id, bot: p.bot !== null, rating: p.bot?.rating ?? null, x: p.state.x, y: p.state.y, z: p.state.z, hp: [...p.hp], dead: p.dead, eliminated: p.eliminated, participant: p.participant,
      dropPhase: p.state.dropPhase, dropTime: p.state.dropTime, dropSpot: p.bot?.dropSpot ?? null,
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
      id, slot, bot: null, send, gone: false, goneTick: 0, rejoinToken: rejoinSecret(), mech, state: this.freshState(slot, mech), gate: new FireGate(), grenadeGate: new FireGate(), alt: createAltFireState(),
      queue: [], lastSeq: 0, ackTick: 0, lagMs: this.config.combat.defaultLagMs, steps: 0, budget: net.maxMessagesPerSecond, hp: createHealth(this.config.zones), loadout: freshLoadout(this.config.weapons, this.config.loot), askedSlot: 0, interactReadyTick: 0, interactHeld: false, lootingId: 0, lootSeconds: 0, looted: false, repairZone: -1, repairSeconds: 0, healthMark: 0, railHpMark: 0, launchX: 0, launchZ: 0, cause: CAUSE_NONE, causeBefore: CAUSE_NONE, tally: createTally(), rammed: [], interested: new Set(), watchId: 0, heard: [], sentPickupIds: [], shotsFired: 0, quietUntil: new Int32Array(NOISE_KINDS.length),
      dead: watching, respawnTick: 0, participant: !watching, eliminated: watching,
      historyTick: new Int32Array(this.historyLength).fill(-1), history: new Float32Array(this.historyLength * 4),
    };
    this.players.set(id, player);
    if (this.hostId === 0) this.hostId = id;
    if (this.state === "countdown") this.placeForDrop(player);

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
      // A tier with no ring in ring.json (offline practice's shooting range) cannot hold a match, so it stays a lobby.
      if (id === this.hostId && this.state === "lobby" && this.config.ring.tiers[this.tier]) this.beginCountdown();
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
    this.landFlights();
    this.popRivets();
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

    // Diving in: nothing to think about but where to land. A bot far from everyone steers a few times a second, like
    // its walking, but it still dives and lands.
    if (dropping(player.state)) {
      const far = !this.nearAnyPerson(player, lod.fullRangeMeters);
      if (far && (this.tickCount + player.slot) % lod.cheapEveryTicks !== 0) return;
      const dt = far ? lod.cheapEveryTicks * STEP : STEP;
      if (this.dropPlan) bot.thinkDrop(player.state, this.dropPlan, this.statsFor(player.state.mech), dt, input);
      else Object.assign(input, createMechInput(), { aimYaw: player.state.bodyYaw });
      this.processInput(player, input, dt);
      return;
    }

    if ((this.tickCount + player.slot) % this.config.bots.loot.refreshTicks === 0) {
      this.aimBotAtLoot(player);
      this.aimBotAtPrey(player);
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
      input.fire = false; input.altFire = false; input.grenade = false; input.dash = false; input.ability = false;
      player.alt.charge = 0; // or letting go of the button would fire it
      this.processInput(player, input, dt);
      return;
    }

    this.botTargets.length = 0;
    for (const other of this.players.values()) {
      if (other === player || !other.participant || other.dead || dropping(other.state)) continue;
      this.botTargets.push({ id: other.id, x: other.state.x, y: other.state.y, z: other.state.z, person: other.bot === null });
    }
    // Decoys look like any mech to a bot, so it chases and shoots them. Its own are not worth fooling itself with.
    for (const d of this.decoys) if (d.ownerId !== player.id) this.botTargets.push({ id: d.id, x: d.state.x, y: d.state.y, z: d.state.z });
    // The Titan is one more thing to shoot, aimed at high up its body. Being the nearest is what makes it the target.
    if (titan) this.botTargets.push({ id: TITAN_ID, x: titan.x, y: titan.y, z: titan.z, aimHeight: this.config.titan.aimHeight });
    this.warnOfLasers(player);
    const weapon = this.config.weapons.weapons[activeWeapon(player.loadout)] ?? null;
    bot.secondary = weapon?.secondary ?? null;
    bot.weapon = weapon;
    bot.alt = player.alt;
    const range = this.config.botAbilities?.secondary.detonateMaxRange ?? 0;
    bot.rivetsReady = weapon?.projectile.kind === "rivet" ? this.rivetsToDetonate(player, weapon.projectile, range) : 0;
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
    const { loot } = this.config.bots;
    let range = bot.hasLootGoal ? loot.keepMeters : loot.searchMeters;
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

  // The nearest other living mech within the hunting range, bot or person, seen or not.
  private aimBotAtPrey(player: Player): void {
    const { x, z } = player.state;
    let best: Player | null = null;
    let bestDistance = this.config.bots.hunt.searchMeters;
    for (const other of this.players.values()) {
      if (other === player || !other.participant || other.dead || dropping(other.state)) continue;
      const distance = Math.hypot(other.state.x - x, other.state.z - z);
      if (distance < bestDistance) { best = other; bestDistance = distance; }
    }
    const bot = player.bot!;
    bot.personDistanceScale = this.config.bots.hunt.personDistanceScale;
    if (best) bot.setHuntGoal(best.state.x, best.state.z);
    else bot.clearHuntGoal();
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
    // A mech still diving in is out of its reach and beneath its notice.
    this.landed.length = 0;
    for (const p of this.players.values()) if (!dropping(p.state)) this.landed.push(p);
    if (!this.titan) {
      const elapsed = this.elapsedSeconds();
      if (!config.tiers.includes(this.tier) || !this.ring || elapsed < config.appearSeconds) return;
      const at = placeTitan(config, this.ring, elapsed, this.map, this.landed, this.random);
      this.titan = new Titan(config, this.map.world, this.finder, this.config.bots.path, this.map.meters, this.titanHost, titanHitBoxes(config, this.config.kitHitboxes ?? null), at.x, at.z);
      this.tellEveryone({ t: "notice", text: config.announce });
      this.makeNoise(null, "explosion", at.x, at.z);
    }
    this.titan.step(STEP, this.ringNow);
  }

  // What the Titan does goes through the room's own rules: armor, knockouts, props, loot, who hears what.
  private makeTitanHost(): TitanHost {
    return {
      mechs: () => this.landed,
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
    this.noteHp(target);
    for (let zone = 0; zone < ZONE_COUNT; zone++) total += applyDamage(target.hp, zones, zone, zoneDamage[zone] ?? 0, target.loadout.armor);
    this.hurt(target, cause, null, total);
    this.sendHurt(target, -1, 0, 0, this.splashKind(target)); // a stomp comes up through the feet
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
    this.phaseEndTick = this.tickCount + Math.ceil(this.config.match.countdownSeconds / STEP);
    this.dropsLanded = 0;
    this.dropsOpened = 0;
    this.grenades = [];
    this.flights.clear();
    this.pickups.clear();
    for (const player of [...this.players.values()]) if (player.gone) this.players.delete(player.id);
    this.dropSpots = [];
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
      this.placeForDrop(player);
      player.bot?.forgetDrop();
      player.queue.length = 0;
    }
    this.dropPlan = this.makeDropPlan(this.ring);
    this.state = "countdown";
    this.broadcastRoom();
  }

  // Hanging at this mech's spot (by its slot) at the tier's height, until the match goes live. Spots come from the
  // match seed (shared dropSpots.ts, so offline practice puts its mechs in the same places); a mech joining in the
  // countdown with a higher slot plans further spots without moving anyone already placed.
  private placeForDrop(player: Player): void {
    const drop = this.config.drop;
    const altitude = drop?.altitudeMeters[this.tier];
    if (!drop || altitude === undefined) return;
    if (player.slot >= this.dropSpots.length) {
      let count = player.slot + 1;
      for (const p of this.players.values()) count = Math.max(count, p.slot + 1);
      this.dropSpots = planDropSpots(this.seed, count, this.map.world, this.map.meters, drop.spots);
    }
    const spot = this.dropSpots[player.slot]!;
    hangAtSpot(player.state, spot.x, spot.z, this.map.world, altitude);
  }

  // What bots choose a landing spot from. Null without a drop-in.
  private makeDropPlan(ring: RingSchedule): DropPlan | null {
    const drop = this.config.drop;
    const first = ring.stages[0] ?? ring.initial;
    if (!drop) return null;
    return {
      world: this.map.world, propOfBox: this.map.propOfBox, props: this.map.props, scenery: this.config.props.types.map((t) => t.scenery === true),
      cx: first.cx, cz: first.cz, radius: first.radius, half: this.map.meters / 2, taken: [], stats: drop.bots,
    };
  }

  private beginMatch(): void {
    // Everyone hanging starts to fall and steer.
    this.state = "active";
    for (const p of this.players.values()) releaseDrop(p.state);
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

  // Offline practice's R key (client localRoom.ts): back on your spawn at once, whole, as a knockout outside a match
  // brings you back after its wait. Only outside a match, where nothing can be lost, and never during the countdown,
  // when everyone hangs over their drop spot.
  respawn(id: number): void {
    const player = this.players.get(id);
    if (player && (this.state === "lobby" || this.state === "results")) this.respawnForPractice(player);
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
      // Up in the air the ring cannot touch it yet. Every spot it can glide to is inside the first circle anyway.
      if (dropping(player.state) || !isOutsideRing(ring, player.state.x, player.state.z)) continue;
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
      input.moveX = 0; input.moveY = 0; input.run = false; input.jet = false; input.dash = false; input.fire = false; input.altFire = false; input.grenade = false; input.ability = false;
    }
    // Diving in, or stunned by the landing: no weapons, grenades, ability, looting or repair, whatever the client asks.
    // Steering the dive is still allowed. (The shared step already ignores jets, dash and the ability here.)
    const held = dropping(player.state) || player.state.dropTime > 0;
    if (held) { input.fire = false; input.altFire = false; input.grenade = false; input.ability = false; input.interact = false; input.repair = false; }
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
    this.stepTriggers(player, input, dt);
    if (input.grenade) this.tryThrow(player, input);
    if (!player.dead && player.participant && this.state !== "countdown" && !held) {
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

  // Both triggers, every step: the same shared step the shooter's client runs, so rate, heat, spin and charge are
  // checked here whatever the client claims. A charge held through death or the drop is simply lost.
  private stepTriggers(player: Player, input: MechInput, dt: number): void {
    const alt = player.alt;
    if (player.dead) { alt.heat = 0; alt.overheat = 0; alt.windup = 0; alt.charge = 0; }
    // The same rule as the client's: a charge held when the guns go away (knocked out, diving, landing stun, the
    // countdown) is thrown away unfired. Letting go of the button would otherwise fire it on the next step.
    if (player.dead || dropping(player.state) || player.state.dropTime > 0 || this.state === "countdown") alt.charge = 0;
    const weaponIndex = activeWeapon(player.loadout);
    const weapon = this.config.weapons.weapons[weaponIndex];
    if (!weapon) return;
    const shot = this.altShot;
    if (!stepAltFire(alt, player.gate, input, weapon, player.steps * STEP, dt, upgradeScale(player.loadout, this.config.upgrades, "fireRate"), shot)) return;
    if (shot.detonate) {
      this.secondaryCount.shots++; this.secondaryCount.detonate++;
      this.detonate(player);
      return;
    }
    // A mech with two guns fires them in turn; every pellet of one pull leaves the same muzzle.
    const muzzles = this.muzzlesFor(player.state.mech);
    const muzzle = muzzles[player.shotsFired++ % muzzles.length]!;
    // A scattergun fires several pellets with one pull. Each is its own shot, with its own spread and its own hit.
    if (shot.mode === FIRE_SECONDARY) { this.secondaryCount.shots++; this.secondaryCount[weapon.secondary.kind]++; }
    for (let i = 0; i < shot.weapon.pellets; i++) this.firePellet(player, input, shot.weapon, weaponIndex, muzzle, shot);
    this.makeNoise(player, "shot", player.state.x, player.state.z);
  }

  // `alt` says what kind of shot this is; FIRE_NONE in it is a plain shot with nothing extra.
  private firePellet(player: Player, input: MechInput, weapon: WeaponStats, weaponIndex: number, muzzle: readonly number[], alt: AltShot | null = null): void {
    // The aim point is only a direction hint, so it cannot send a shot faster or from anywhere but the barrel.
    // A broken arm still fires, just nowhere near where it is pointed.
    const spread = player.hp[ZONE_ARMS]! <= 0 ? this.config.zones.brokenArmsSpreadMultiplier : 1;
    computeShot(player.state, input.targetX, input.targetY, input.targetZ, weapon, this.random, this.shot, spread, muzzle);
    const s = this.shot;
    const projectile = weapon.projectile;

    // How far the shot goes: the nearest wall, unless a mech is in the way.
    let reach = weapon.maxAimDistance;
    let hitBox = -1;
    // The surface a rivet sticks to: the wall or ground, or facing back along the shot.
    let nx = -s.dx, ny = -s.dy, nz = -s.dz;
    let hitWorld = false;
    if (this.map.world.raycast(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.worldHit)) {
      reach = this.worldHit.distance; hitBox = this.worldHit.index; hitWorld = true;
      nx = this.worldHit.normalX; ny = this.worldHit.normalY; nz = this.worldHit.normalZ;
    }

    // Shots do damage in the lobby too, so there is something to practise on. Only the countdown is safe.
    let target = this.state !== "countdown" ? this.findTarget(player, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach) : null;
    if (target) reach = this.zoneHit.distance;
    // The Titan, when it stands nearer than any mech the shot met. It is too slow to need rewinding for lag.
    let titanHit = this.state === "active" && this.titan?.raycast(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.titanHit) === true;
    if (titanHit) { target = null; reach = this.titanHit.distance; }
    const flying = projectile.kind !== "hitscan";
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
      // Too big to ride: a rivet sticks where it hit.
      if (flying) this.launch(player, weaponIndex, "world", 0, reach, 0, -s.dx, -s.dy, -s.dz);
    } else if (target && flying) {
      const damage = weapon.damage * this.shieldFactor(target, s.dx, s.dz);
      this.launch(player, weaponIndex, "mech", target.id, reach, damage, -s.dx, -s.dy, -s.dz);
    } else if (target) {
      this.shotHits(player, target, weapon, weaponIndex, reach, alt);
      // A full charge goes on through: the next mech along the same line, up to the wall, as many times as it pierces.
      const pierce = alt?.pierce ?? 0;
      if (pierce > 0) {
        const wall = hitBox >= 0 ? this.worldHit.distance : weapon.maxAimDistance;
        this.pierced.length = 0;
        this.pierced.push(target);
        let left = pierce;
        while (left > 0) {
          const next = this.findTarget(player, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, wall, this.pierced);
          if (!next) { reach = wall; break; }
          reach = this.zoneHit.distance;
          this.shotHits(player, next, weapon, weaponIndex, reach, alt);
          this.secondaryCount.pierced++;
          this.pierced.push(next);
          left--;
        }
      }
    } else if (flying && this.state !== "countdown") {
      const prop = hitBox >= 0 ? this.map.propOfBox[hitBox]! : -1;
      if (prop >= 0) this.launch(player, weaponIndex, "prop", prop, reach, 0, nx, ny, nz);
      else if (hitWorld) this.launch(player, weaponIndex, "world", 0, reach, 0, nx, ny, nz);
    } else if (hitBox >= 0 && this.state !== "countdown") {
      const prop = this.map.propOfBox[hitBox]!;
      if (prop >= 0) this.damageProp(prop, weapon.damage, player);
    }

    const message: ShotMessage = {
      t: "shot", id: player.id, ox: s.ox, oy: s.oy, oz: s.oz, dx: s.dx, dy: s.dy, dz: s.dz, length: reach, hitMech: target !== null || decoy !== null || titanHit,
    };
    if (alt?.mode === FIRE_SECONDARY) {
      message.alt = alt.share;
      if (alt.pierce > 0) message.pierce = true;
    }
    this.sendNear(s.ox, s.oz, message, player);
  }

  // Damage from one shot to one mech at `reach` along this.shot, with the zone in this.zoneHit, and the pin if the
  // shot carries one.
  private shotHits(player: Player, target: Player, weapon: WeaponStats, weaponIndex: number, reach: number, alt: AltShot | null): void {
    const s = this.shot;
    const damage = weapon.damage * this.shieldFactor(target, s.dx, s.dz);
    const zone = this.zoneHit.zone;
    const before = target.hp[zone]!;
    const taken = applyDamage(target.hp, this.zonesFor(target.state.mech), zone, damage, target.loadout.armor);
    this.hurt(target, weaponCause(weaponIndex), player, taken);
    this.tellHurt(target, zone, s.ox + s.dx * reach, s.oy + s.dy * reach, s.oz + s.dz * reach, hurtKind(before, target.hp[zone]!));
    if (alt && alt.mode !== FIRE_NONE && alt.pinSeconds > 0) {
      target.state.pinTime = Math.max(target.state.pinTime, alt.pinSeconds);
      target.state.pinSpeed = alt.pinSpeedShare;
      this.secondaryCount.pinned++;
    }
    const killed = !target.dead && isDestroyed(target.hp);
    player.send({
      t: "hit", targetId: target.id, zone: this.zoneHit.zone, damage: taken, killed,
      x: s.ox + s.dx * reach, y: s.oy + s.dy * reach, z: s.oz + s.dz * reach,
    });
    if (killed) this.eliminate(target, player);
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
  // `skip`: mechs a piercing shot has already gone through.
  private findTarget(shooter: Player, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number, skip: readonly Player[] = NO_PLAYERS): Player | null {
    // Rewind by what this shooter actually saw, never more than the cap, so the shot lands where they aimed.
    const lagMs = Math.min(shooter.lagMs, this.config.combat.lagCompensationMs);
    const rewindTicks = Math.min(this.historyLength - 1, Math.round(lagMs / (STEP * 1000)));
    const wanted = this.tickCount - rewindTicks;
    let best: Player | null = null;
    let bestDistance = reach;
    let bestZone = -1;

    for (const target of this.players.values()) {
      // A mech still in the air cannot be hit: the drop is safe, the landing is not.
      if (target === shooter || target.dead || !target.participant || dropping(target.state) || skip.includes(target)) continue;
      const index = ((wanted % this.historyLength) + this.historyLength) % this.historyLength;
      const old = target.historyTick[index] === wanted;
      const x = old ? target.history[index * 4]! : target.state.x;
      const y = old ? target.history[index * 4 + 1]! : target.state.y;
      const z = old ? target.history[index * 4 + 2]! : target.state.z;
      const yaw = old ? target.history[index * 4 + 3]! : target.state.bodyYaw;

      const zones = this.zonesFor(target.state.mech);
      if (raycastMech(ox, oy, oz, dx, dy, dz, bestDistance, x, y, z, yaw, zones, this.zoneHit)) {
        const pose = this.targetPose;
        pose.x = x; pose.y = y; pose.z = z; pose.yaw = yaw;
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
  // `rivet` is the id of the rivet popping, 0 for anything else.
  private blast(x: number, y: number, z: number, damage: number, radius: number, owner: Player | null, cause: number, rivet = 0): void {
    const bx = x, by = y + BLAST_LIFT, bz = z;
    const message: ServerMessage = rivet > 0 ? { t: "explode", x, y, z, rivet } : { t: "explode", x, y, z };
    this.sendNear(x, z, message, owner ?? undefined);
    this.makeNoise(owner, "explosion", x, z);
    if (this.state === "countdown") return;

    for (const target of this.players.values()) {
      if (target.dead || !target.participant || dropping(target.state)) continue;
      const dx = target.state.x - bx, dy = target.state.y + CHEST_HEIGHT - by, dz = target.state.z - bz;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= radius) continue;
      if (distance > 0.5 && this.map.world.raycast(bx, by, bz, dx / distance, dy / distance, dz / distance, distance - 0.5, this.worldHit)) continue;

      const amount = damage * (1 - distance / radius);
      let total = 0;
      this.noteHp(target);
      for (let zone = 0; zone < ZONE_COUNT; zone++) total += applyDamage(target.hp, this.zonesFor(target.state.mech), zone, amount, target.loadout.armor);
      this.hurt(target, cause, owner, total);
      const t = target.state;
      this.splashFrom(target, bx, by, bz, t.x, t.y, t.z, t.bodyYaw);
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

  // ---- rivets (gate 18b)

  // Files a rivet shot to land when its projectile gets there, `reach` along this.shot. What it hit was settled now:
  // `hit` and `target` (a mech's or prop's id), the damage a mech takes, the surface's facing.
  private launch(player: Player, weaponIndex: number, hit: Landing["hit"], target: number, reach: number, damage: number, nx: number, ny: number, nz: number): void {
    const s = this.shot;
    const weapon = this.config.weapons.weapons[weaponIndex]!;
    const steps = flightSteps(reach, weapon);
    // Off the surface a touch, so a rivet's blast does not start inside the wall it is stuck in.
    const x = s.ox + s.dx * reach + nx * SURFACE_NUDGE, y = s.oy + s.dy * reach + ny * SURFACE_NUDGE, z = s.oz + s.dz * reach + nz * SURFACE_NUDGE;
    const landing: Landing = {
      owner: player.id, weapon: weaponIndex, tick: this.tickCount + steps, hit, target, zone: this.zoneHit.zone, damage,
      x, y, z, nx, ny, nz, lx: 0, ly: 0, lz: 0,
    };
    if (hit === "mech") {
      const pose = this.targetPose;
      toMechFrame(x, y, z, pose.x, pose.y, pose.z, pose.yaw, this.frame);
      landing.lx = this.frame.x; landing.ly = this.frame.y; landing.lz = this.frame.z;
    }
    this.flights.launch(landing);
  }

  private landFlights(): void {
    for (const l of this.flights.landed(this.tickCount, this.landedScratch)) {
      const weapon = this.config.weapons.weapons[l.weapon];
      if (!weapon) continue;
      const owner = this.players.get(l.owner) ?? null;
      if (weapon.projectile.kind === "rivet") this.landRivet(l, owner, weapon.projectile);
    }
  }

  // Where on a mech a landing struck, now: it rides the mech's body. Into this.frame.
  private onMech(target: Player, l: { lx: number; ly: number; lz: number }): { x: number; y: number; z: number } {
    const t = target.state;
    fromMechFrame(l.lx, l.ly, l.lz, t.x, t.y, t.z, t.bodyYaw, this.frame);
    return this.frame;
  }

  // A rivet's own hit on a mech, at the zone settled when it was fired.
  private landDamage(owner: Player | null, target: Player, l: Landing, x: number, y: number, z: number): void {
    if (target.dead || !target.participant || dropping(target.state) || l.damage <= 0) return;
    const before = target.hp[l.zone]!;
    const taken = applyDamage(target.hp, this.zonesFor(target.state.mech), l.zone, l.damage, target.loadout.armor);
    this.hurt(target, weaponCause(l.weapon), owner, taken);
    this.sendHurt(target, l.zone, l.lx, l.ly, hurtKind(before, target.hp[l.zone]!));
    const killed = isDestroyed(target.hp);
    owner?.send({ t: "hit", targetId: target.id, zone: l.zone, damage: taken, killed, x, y, z });
    if (killed) this.eliminate(target, owner);
  }

  // A rivet sticks: to the world where it hit, or riding the mech it hit. One past its owner's cap pops the oldest now.
  private landRivet(l: Landing, owner: Player | null, rivet: RivetStats): void {
    let x = l.x, y = l.y, z = l.z;
    const carrier = l.hit === "mech" ? this.players.get(l.target) : undefined;
    if (carrier) {
      ({ x, y, z } = this.onMech(carrier, l));
      this.landDamage(owner, carrier, l, x, y, z);
    }
    if (l.hit === "prop") {
      const weapon = this.config.weapons.weapons[l.weapon]!;
      this.damageProp(l.target, weapon.damage, owner);
    }
    if (this.flights.stuckBy(l.owner) >= rivet.maxStuck) {
      const oldest = this.flights.oldestOf(l.owner)!;
      this.flights.remove(oldest);
      this.popRivet(oldest);
    }
    const on = carrier ? carrier.id : 0;
    const stuck = this.flights.stick(l.owner, l.weapon, this.tickCount + Math.round(rivet.fuseSeconds / STEP), on, l.lx, l.ly, l.lz, x, y, z);
    this.projectileCount.rivetsStuck++;
    const message: RivetMessage = { t: "rivet", event: "stick", owner: l.owner, id: stuck.id, x, y, z, fuse: rivet.fuseSeconds };
    if (on) { message.on = on; message.lx = l.lx; message.ly = l.ly; message.lz = l.lz; }
    else { message.nx = l.nx; message.ny = l.ny; message.nz = l.nz; }
    this.sendNear(x, z, message, owner ?? undefined);
  }

  // Every rivet whose fuse is out pops with its small blast, wherever it is now.
  private popRivets(): void {
    for (const r of this.flights.popping(this.tickCount, this.poppingScratch)) this.popRivet(r);
  }

  private popRivet(r: Rivet): void {
    const weapon = this.config.weapons.weapons[r.weapon];
    if (weapon?.projectile.kind !== "rivet") return;
    const carrier = r.on ? this.players.get(r.on) : undefined;
    const { x, y, z } = carrier ? this.onMech(carrier, r) : r;
    this.projectileCount.rivetsPopped++;
    this.blast(x, y, z, weapon.projectile.blastDamage, weapon.projectile.blastRadius, this.players.get(r.owner) ?? null, weaponCause(r.weapon), r.id);
  }

  // Right-click on a rivet gun: everything of yours that has stuck pops at once. Rivets still flying stick as usual.
  private detonate(player: Player): void {
    const s = player.state;
    const message: RivetMessage = { t: "rivet", event: "detonate", owner: player.id, id: 0, x: s.x, y: s.y, z: s.z };
    this.sendNear(s.x, s.z, message, player);
    for (const r of [...this.flights.popping(this.tickCount, this.poppingScratch, player.id)]) this.popRivet(r);
  }

  // How many of a bot's own rivets ride other mechs between a safe distance from it and `range`: worth popping now.
  private rivetsToDetonate(player: Player, rivet: RivetStats, range: number): number {
    let count = 0;
    for (const r of this.flights.rivets) {
      if (r.owner !== player.id || r.on === 0 || r.on === player.id) continue;
      const carrier = this.players.get(r.on);
      if (!carrier || carrier.dead) continue;
      const distance = Math.hypot(carrier.state.x - player.state.x, carrier.state.z - player.state.z);
      if (distance > rivet.blastRadius + 1 && distance <= range) count++;
    }
    return count;
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
      const zone = this.zoneHit.zone;
      const before = target.hp[zone]!;
      const taken = applyDamage(target.hp, this.zonesFor(target.state.mech), zone, rail.damage * this.shieldFactor(target, s.dx, s.dz), target.loadout.armor);
      this.hurt(target, abilityCause(rail.kind), player, taken);
      this.tellHurt(target, zone, s.ox + s.dx * reach, s.oy + s.dy * reach, s.oz + s.dz * reach, hurtKind(before, target.hp[zone]!));
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
      if (target === player || target.dead || !target.participant || dropping(target.state) || player.rammed.includes(target.id)) continue;
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
      if (target === player || target.dead || !target.participant || dropping(target.state)) continue;
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
    this.noteHp(target);
    const total = applyDamage(target.hp, zones, ZONE_ARMS, damage / 2, target.loadout.armor) + applyDamage(target.hp, zones, ZONE_TORSO, damage / 2, target.loadout.armor);
    this.hurt(target, cause, attacker, total);
    const a = attacker.state;
    this.splashFrom(target, a.x, a.y + CHEST_HEIGHT, a.z, t.x, t.y, t.z, t.bodyYaw);
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

  // Tells the victim where it was hit, for the dots on its damage diagram. A shot's point is turned into the frame of
  // the pose findTarget hit (rewound by the shooter's lag), so it lands where the boxes were struck.
  private tellHurt(target: Player, zone: number, wx: number, wy: number, wz: number, kind: number): void {
    const pose = this.targetPose;
    toMechFrame(wx, wy, wz, pose.x, pose.y, pose.z, pose.yaw, this.frame);
    this.sendHurt(target, zone, this.frame.x, this.frame.y, kind);
  }

  // Splash, from a point in the world (a blast's centre, a rammer's chest), turned into the victim's frame as it
  // stands. The diagram puts the spread on the side the hit came from.
  private splashFrom(target: Player, wx: number, wy: number, wz: number, mx: number, my: number, mz: number, yaw: number): void {
    toMechFrame(wx, wy, wz, mx, my, mz, yaw, this.frame);
    this.sendHurt(target, -1, this.frame.x, this.frame.y, this.splashKind(target));
  }

  private sendHurt(target: Player, zone: number, lx: number, ly: number, kind: number): void {
    if (target.bot) return; // nobody is looking at a bot's diagram
    target.send({ t: "hurt", zone, x: Math.round(lx * 100) / 100, y: Math.round(ly * 100) / 100, kind });
  }

  private noteHp(target: Player): void {
    for (let zone = 0; zone < ZONE_COUNT; zone++) this.hpBefore[zone] = target.hp[zone]!;
  }

  // The worst splash did to any zone since noteHp. Only zones it actually hurt count, so a part broken earlier does not
  // make every later blast read as breaking something.
  private splashKind(target: Player): number {
    let worst = HURT_PLATE;
    for (let zone = 0; zone < ZONE_COUNT; zone++) {
      const before = this.hpBefore[zone]!;
      if (before > 0) worst = Math.max(worst, hurtKind(before, target.hp[zone]!));
    }
    return worst;
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
    const item = rollLoot(this.config.loot, this.config.weapons, this.config.upgrades.upgrades.length, type.id, this.random, this.tier);
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

  // How wound up the gun in a player's hands is, for other clients to see and hear (altFire.ts altSpin).
  private spinOf(p: Player): number {
    const weapon = this.config.weapons.weapons[activeWeapon(p.loadout)];
    return weapon && !p.dead ? altSpin(p.alt, weapon) : 0;
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
        weapon: Math.max(0, activeWeapon(p.loadout)), armor: p.loadout.armor.map(Math.ceil), upgrades: p.loadout.upgrades, mech: p.state.mech, ability: p.state.abilityTime > 0, dropPhase: p.state.dropPhase,
        pinned: p.state.pinTime > 0, overheated: p.alt.overheat > 0, spin: this.spinOf(p),
      });
    }
    // A decoy is drawn exactly as its owner is right now, damage and all, so nothing on it gives it away but how it
    // moves: a smoking Arbiter beside two clean copies would be easy to pick out.
    for (const d of this.decoys) {
      const owner = this.players.get(d.ownerId);
      if (!owner) continue;
      const s = d.state;
      everyone.push({
        id: d.id, x: s.x, y: s.y, z: s.z, yaw: s.bodyYaw, running: s.running, jetting: s.jetting, dead: false, looted: false, repairing: false, dropPhase: 0,
        bot: owner.bot !== null, hp: owner.hp.map(Math.ceil), weapon: Math.max(0, activeWeapon(owner.loadout)), armor: owner.loadout.armor.map(Math.ceil),
        upgrades: owner.loadout.upgrades, mech: s.mech, ability: false, pinned: false, overheated: owner.alt.overheat > 0, spin: this.spinOf(owner),
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
        t: "snapshot", tick: this.tickCount, ack: player.lastSeq, ackAgeMs: (this.tickCount - player.ackTick) * STEP * 1000, you: writeSelf(player.state, player.alt),
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

// 16 random bytes as hex, for a dropped player to prove who they were. Web Crypto, so a room runs in Node and in a
// browser (offline practice, client localRoom.ts) alike.
function rejoinSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// Compares two rejoin secrets in the same time however much of them matches: every character is looked at, so how
// long a wrong guess takes says nothing about how much of it was right.
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let differ = 0;
  for (let i = 0; i < a.length; i++) differ |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differ === 0;
}
