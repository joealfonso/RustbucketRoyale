import {
  FireGate, STEP, ZONE_ARMS, ZONE_COUNT, ZONE_LEGS, ZONE_TORSO, applyDamage, computeShot, createGrenade, createHealth, createMechInput,
  createMechState, createRayHit, createRingNow, createShot, createZoneHit, isDestroyed, isOutsideRing, makeRingSchedule, partToRepair,
  decodeInput, parseClientMessage, ringAt, rollLoot, itemWeapon, weaponItem, raycastMech, stepGrenade, stepMech, throwGrenade, toMechInput, writeSelf,
  NOISE_KINDS, type BotConfig, type CombatStats, type NoiseKind, type NoiseStats, type PropConfig, type PropInstance, type GrenadeState, type GrenadeStats, type MatchConfig, type MatchState, type MechInput,
  type MechStats, type NetStats, type OtherState, type RingConfig, type RingNow, type RingSchedule, type ServerMessage,
  takenWithE, itemUpgrade, upgradeItem, upgradeScale, applyTune, assignDeep, parseTunable, setNumberAt, TUNABLE_FILES, type TuningRaws, type UpgradeSet,
  makeZonesFor, makeMuzzlesFor, mechStatsFor, rosterIndex, abilityFor, barrageTarget, type Roster, type AbilitySet, type AbilityStats, type BarrageStats,
  type BotDifficulty, type DecoyStats, type PounceStats, type RamStats,
  type NavGrid, type LootConfig, type PickupState, type WeaponSet, type WeaponStats, type World, type ZoneSet,
} from "@rustbucket/shared";
import { Bot, type BotTarget } from "./Bot";
import { parseBotAbilities, type BotAbilityStats } from "./botAbilities";
import { AbstractFights, RATINGS, botsNeeded, pickDifficulty, type FarBot } from "./botLod";
import { decoyAlong, spawnDecoys, stepDecoy, type Decoy } from "./decoys";
import { Pathfinder } from "./Pathfinder";
import { activeWeapon, collectSmall, freshLoadout, selectSlot, spillItems, takeUpgrade, takeWeapon, wantsItem } from "./loadout";
import { Pickups } from "./Pickups";
import type { Player } from "./Player";

const KILL_HEIGHT = -50;
const CHEST_HEIGHT = 1.7; // where splash damage measures to
const BLAST_LIFT = 0.2; // keeps a grenade resting on the floor from blasting from inside it
const SKY_HEIGHT = 500; // above anything a map builds, so a ray down from here finds the ground

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
  zones: ZoneSet;
  abilities: AbilitySet;
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
  private propHp: Float32Array = new Float32Array(0);
  private destroyedProps: number[] = [];
  private pickups: Pickups;
  private pickupScratch: PickupState[] = [];
  private pendingBlasts: { x: number; y: number; z: number; tick: number; owner: Player | null; damage: number; radius: number }[] = [];
  private decoys: Decoy[] = [];
  private decoyHit = createZoneHit();
  private strikeAt = { x: 0, z: 0 };

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
    this.finder = new Pathfinder(this.map.nav, config.bots.path);
    this.fixedBots = botCount;
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
    return [...this.players.values()].filter((p) => !p.bot);
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
      id, slot, bot: this.newBot(), send: () => {}, mech, state: this.freshState(slot, mech),
      gate: new FireGate(), grenadeGate: new FireGate(), queue: [], lastSeq: 0, ackTick: 0, lagMs: 0, steps: 0, budget: net.maxMessagesPerSecond,
      hp: createHealth(this.config.zones), loadout: freshLoadout(this.config.weapons, this.config.loot), askedSlot: 0, interactReadyTick: 0, interactHeld: false, lootingId: 0, lootSeconds: 0, looted: false, repairZone: -1, repairSeconds: 0, healthMark: 0, rammed: [], interested: new Set(), watchId: 0, heard: [], sentPickupIds: [], shotsFired: 0, quietUntil: new Int32Array(NOISE_KINDS.length), dead: false, respawnTick: 0, participant: true, eliminated: false,
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

  get mapMeters(): number {
    return this.map.meters;
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
      id, slot, bot: null, send, mech, state: this.freshState(slot, mech), gate: new FireGate(), grenadeGate: new FireGate(),
      queue: [], lastSeq: 0, ackTick: 0, lagMs: this.config.combat.defaultLagMs, steps: 0, budget: net.maxMessagesPerSecond, hp: createHealth(this.config.zones), loadout: freshLoadout(this.config.weapons, this.config.loot), askedSlot: 0, interactReadyTick: 0, interactHeld: false, lootingId: 0, lootSeconds: 0, looted: false, repairZone: -1, repairSeconds: 0, healthMark: 0, rammed: [], interested: new Set(), watchId: 0, heard: [], sentPickupIds: [], shotsFired: 0, quietUntil: new Int32Array(NOISE_KINDS.length),
      dead: watching, respawnTick: 0, participant: !watching, eliminated: watching,
      historyTick: new Int32Array(this.historyLength).fill(-1), history: new Float32Array(this.historyLength * 4),
    };
    this.players.set(id, player);
    if (this.hostId === 0) this.hostId = id;

    // In the lobby a person arriving takes a bot's place. Mid match nothing changes.
    if (this.state === "lobby") this.fillBots();
    send({ t: "welcome", id, code: this.code, seed: this.seed, tier: this.tier, tuning: this.tuningRaws !== null });
    for (const tuned of this.tunes) send(tuned);
    if (this.destroyedProps.length > 0) send({ t: "props", destroyed: [...this.destroyedProps] });
    this.broadcastRoom();
    return id;
  }

  leave(id: number): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    for (const d of [...this.decoys]) if (d.ownerId === id) this.popDecoy(d, null);
    if (this.hostId === id) this.hostId = this.humans()[0]?.id ?? 0;
    if (this.state === "lobby") this.fillBots();
    // Walking out of a running match counts as being knocked out.
    if (this.state === "active" && player.participant && !player.eliminated) this.checkMatchOver();
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
    let health = 0;
    for (let zone = 0; zone < ZONE_COUNT; zone++) health += player.hp[zone]! + player.loadout.armor[zone]!;
    bot.noteHealth(health);

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
    bot.think(player.state, this.botTargets, this.botZone(player), this.map.world, STEP, input);
    this.processInput(player, input);
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
    if (found) bot.setLootGoal(goalX, goalZ);
    else bot.clearLootGoal();
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
    this.finder = new Pathfinder(this.map.nav, this.config.bots.path);
    for (const p of this.players.values()) p.bot?.setFinder(this.finder);
    this.fillBots();
    this.ring = makeRingSchedule(this.config.ring, this.tier, this.map.meters, this.random);
    this.grenades = [];
    this.pickups.clear();
    for (const player of this.players.values()) {
      player.participant = true;
      player.eliminated = false;
      player.dead = false;
      player.hp = createHealth(this.config.zones);
      player.loadout = freshLoadout(this.config.weapons, this.config.loot);
      player.askedSlot = 0;
      player.looted = false;
      this.stopLooting(player);
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
  private eliminate(player: Player, killer: Player | null): void {
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
    const message: ServerMessage = { t: "eliminated", id: player.id, killerId: killer?.id ?? null, place, alive };
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
    const message: ServerMessage = { t: "result", winnerId: winner?.id ?? null };
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
    const abilityBefore = player.state.abilityTime, cooldownBefore = player.state.abilityCooldown;
    player.state.crawling = player.hp[ZONE_LEGS]! <= 0;
    player.state.fuelScale = upgradeScale(player.loadout, this.config.upgrades, "fuel");
    stepMech(player.state, input, this.statsFor(player.state.mech), dt, this.map.world, ability);
    if (ability) this.afterAbilityStep(player, input, ability, abilityBefore, cooldownBefore);
    player.steps += Math.round(dt / STEP);
    if (player.state.running) this.makeNoise(player, "run", player.state.x, player.state.z);
    if (player.state.jetting) this.makeNoise(player, "jets", player.state.x, player.state.z);
    if (dashBefore <= 0 && player.state.dashTime > 0) this.makeNoise(player, "dash", player.state.x, player.state.z);

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
    for (let i = 0; i < weapon.pellets; i++) this.firePellet(player, input, weapon, muzzle);
    this.makeNoise(player, "shot", player.state.x, player.state.z);
  }

  private firePellet(player: Player, input: MechInput, weapon: WeaponStats, muzzle: readonly number[]): void {
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
    // A decoy in front of everything else takes the shot and bursts. No damage and no hit marker: the pop is the tell.
    const decoy = decoyAlong(this.decoys, player.id, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, reach, this.zonesFor, this.decoyHit);
    if (decoy) {
      reach = this.decoyHit.distance;
      target = null;
      this.popDecoy(decoy, player);
    } else if (target) {
      const damage = weapon.damage * this.shieldFactor(target, s.dx, s.dz);
      const taken = applyDamage(target.hp, this.zonesFor(target.state.mech), this.zoneHit.zone, damage, target.loadout.armor);
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
      t: "shot", id: player.id, ox: s.ox, oy: s.oy, oz: s.oz, dx: s.dx, dy: s.dy, dz: s.dz, length: reach, hitMech: target !== null || decoy !== null,
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
    this.blast(g.x, g.y, g.z, grenade.damage, grenade.blastRadius, this.players.get(live.ownerId) ?? null);
  }

  // Splash hits every zone of everyone in range, so a close blast wrecks parts and makes a story. Walls block it,
  // props in range take damage too (so barrels set each other off), and it does nothing during the countdown.
  private blast(x: number, y: number, z: number, damage: number, radius: number, owner: Player | null): void {
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
      const killed = isDestroyed(target.hp);
      owner?.send({ t: "hit", targetId: target.id, zone: -1, damage: total, killed, x: target.state.x, y: target.state.y + CHEST_HEIGHT, z: target.state.z });
      if (killed) this.eliminate(target, owner);
    }

    for (const prop of this.map.props) {
      if (this.propHp[prop.id]! <= 0) continue;
      const distance = Math.hypot(prop.x - bx, prop.y - by, prop.z - bz);
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
    }
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
      this.abilityDamage(player, target, ram.damage);
    }
    this.popDecoysAround(s.x, s.y, s.z, ram.hitRadius, height, player);

    for (const prop of this.map.props) {
      if (this.propHp[prop.id]! <= 0) continue;
      const box = this.map.world.boxes[prop.boxIndex]!;
      if (box.maxY < s.y || box.minY > s.y + height) continue;
      const nearX = Math.max(box.minX, Math.min(s.x, box.maxX)), nearZ = Math.max(box.minZ, Math.min(s.z, box.maxZ));
      // All its remaining hit points: a ram goes through cover, it does not chip at it.
      if (Math.hypot(nearX - s.x, nearZ - s.z) <= ram.hitRadius) this.damageProp(prop.id, this.propHp[prop.id]!, player);
    }
  }

  // A pounce comes down blade first: everyone near the landing spot takes the slam.
  private slam(player: Player, pounce: PounceStats): void {
    const s = player.state;
    const height = this.statsFor(s.mech).height;
    this.sendNear(s.x, s.z, { t: "ability", id: player.id, kind: "pounce", event: "land", x: s.x, y: s.y, z: s.z }, player);
    this.makeNoise(player, "smash", s.x, s.z);
    for (const target of this.players.values()) {
      if (target === player || target.dead || !target.participant) continue;
      const t = target.state;
      if (Math.hypot(t.x - s.x, t.z - s.z) > pounce.slamRadius || Math.abs(t.y - s.y) > height) continue;
      this.abilityDamage(player, target, pounce.damage);
    }
    this.popDecoysAround(s.x, s.y, s.z, pounce.slamRadius, height, player);
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
      this.pendingBlasts.push({ x, y: this.groundAt(x, z, y), z, tick, owner: player, damage: strike.damage, radius: strike.blastRadius });
    }
  }

  // The height of whatever is under a spot, from a ray straight down, or `fallback` where there is nothing.
  private groundAt(x: number, z: number, fallback: number): number {
    if (this.map.world.raycast(x, SKY_HEIGHT, z, 0, -1, 0, SKY_HEIGHT * 2, this.worldHit)) return SKY_HEIGHT - this.worldHit.distance;
    return fallback;
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
      if (d.state.running) this.makeNoise(owner, "run", d.state.x, d.state.z, d.quietUntil);
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
  private abilityDamage(attacker: Player, target: Player, damage: number): void {
    const zones = this.zonesFor(target.state.mech);
    const t = target.state;
    const total = applyDamage(target.hp, zones, ZONE_ARMS, damage / 2, target.loadout.armor) + applyDamage(target.hp, zones, ZONE_TORSO, damage / 2, target.loadout.armor);
    const killed = isDestroyed(target.hp);
    attacker.send({ t: "hit", targetId: target.id, zone: -1, damage: total, killed, x: t.x, y: t.y + CHEST_HEIGHT, z: t.z });
    if (killed) this.eliminate(target, attacker);
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
      if (dropped !== null && dropped >= 0) this.pickups.add(upgradeItem(dropped), x, 0.5, z);
      return true;
    }
    const dropped = takeWeapon(l, pickup.item);
    if (dropped >= 0) this.pickups.add(weaponItem(dropped), x, 0.5, z);
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
      this.pickups.add(item, wreck.state.x + Math.cos(angle) * r, wreck.state.y + 0.5, wreck.state.z + Math.sin(angle) * r);
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
    this.map.world.disable(prop.boxIndex);
    this.destroyedProps.push(id);
    const message: ServerMessage = { t: "prop", id };
    for (const p of this.players.values()) if (!p.bot) p.send(message);
    this.makeNoise(by, "smash", prop.x, prop.z);
    const item = rollLoot(this.config.loot, this.config.weapons, this.config.upgrades.upgrades.length, this.config.props.types[prop.type]!.id, this.random);
    if (item !== null) this.pickups.add(item, prop.x + (this.random() - 0.5), 0.5, prop.z + (this.random() - 0.5));
    if (this.config.props.types[prop.type]!.explodes) {
      const delay = Math.round(this.config.props.barrelBlast.delaySeconds / STEP);
      const { damage, radius } = this.config.props.barrelBlast;
      this.pendingBlasts.push({ x: prop.x, y: 0, z: prop.z, tick: this.tickCount + delay, owner: by, damage, radius });
    }
  }

  // Barrels go off a beat after they break, so a chain of them ripples rather than all going at once. Mortar shells
  // wait here too.
  private setOffPendingBlasts(): void {
    for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
      const b = this.pendingBlasts[i]!;
      if (this.tickCount < b.tick) continue;
      this.pendingBlasts.splice(i, 1);
      this.blast(b.x, b.y, b.z, b.damage, b.radius, b.owner);
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
  // owner's are heard separately.
  private makeNoise(source: Player | null, kind: NoiseKind, x: number, z: number, quiet = source?.quietUntil): void {
    const { noise } = this.config;
    const k = NOISE_KINDS.indexOf(kind);
    if (quiet) {
      if (this.tickCount < quiet[k]!) return;
      quiet[k] = this.tickCount + Math.round(noise.pulseSeconds / STEP);
    }
    const radius = noise.loudness[kind];
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
      });
    }
  }
}
