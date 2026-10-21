import { readFileSync } from "node:fs";
import { DROP_HANGING, STEP, ballFallSeconds, parseChunkSet, parsePropConfig, parseTiers } from "@rustbucket/shared";
import { loadRoomConfig } from "../config";
import { MapPool } from "../MapPool";
import { Room } from "../Room";
import { lcg } from "../testClient";
import { HeadlessPlayer } from "./HeadlessPlayer";

export interface SoakOptions {
  fakePlayers?: number;
  tickBudgetMs?: number; // the 99th percentile server tick must stay under this
  bandwidthKbps?: number; // per player, averaged over the match
  maxCorrection?: number; // metres, the largest prediction correction allowed outside respawns and new maps
  fill?: number; // people plus bots in the room, in place of the tier's number in bots.json, for trying other counts
  titanHp?: number; // the Junk Titan's hit points in place of titan.json's, to see it fall within a match
  // The gun everyone starts with, by weapons.json id. Left out it goes round the guns by seed, so the nightly soaks
  // put every gun's secondary fire (gate 18a) through whole matches, not only the usual starting autocannon.
  startWeapon?: string;
}

export interface SoakReport {
  tier: string;
  seed: number;
  problems: string[];
  matchSeconds: number;
  players: number;
  eliminations: number;
  tickP99Ms: number;
  tickWorstMs: number;
  kbpsPerPlayer: number;
  worstCorrection: number;
  // How the match felt for the headless players, to tune bot counts by: the share of their living time with no other
  // mech within radar range, and how long each took to first have one that close (median, seconds into the match).
  aloneFraction: number;
  firstContactSeconds: number;
  knockoutsPerMinute: number;
  propsBroken: number; // props (crates, barrels, trees) broken in the match, as one player was told of them
  titanHpLeft: number | null; // the Junk Titan's share of hit points at the end, null when it never woke
  lastLandingSeconds: number; // how long after the start the last mech came down from the drop-in
  medianLandingSeconds: number;
  medianSteerMeters: number; // how far mechs came down from where they hung, median
  secondaryShots: number; // right-click trigger pulls by everyone in the match (gate 18a)
  secondaryByKind: { windup: number; slug: number; charge: number };
  startWeapon: string;
  headlessSecondaryShots: number; // ...of which by the headless players, through the real input path
  pierced: number; // mechs a full charge spike went on through to
  pinned: number; // mechs pinned by one
}

const CONTACT_METERS = 150; // the radar's range: anything closer can be seen or heard to matter
// The ground a mech steers over can lie this far below the ground at its start spot, which the drop height is
// measured from. A guess with room to spare: the hills on the biggest maps rise and fall by less.
const DROP_VALLEY_METERS = 60;
// Anyone still in the air this long after the slowest fall there is (from the drop height plus the deepest valley) is
// stuck up there.
const DROP_SPARE_SECONDS = 1;

const readData = (name: string) => JSON.parse(readFileSync(new URL(`../../../../data/${name}`, import.meta.url), "utf8"));

// Plays one whole match, start to results, as fast as the computer can, on the real generated map for a tier.
// The room fills itself with bots, and a few headless players join that behave like real browsers. Every tick it
// checks the state makes sense, and at the end it checks the time, bandwidth and prediction budgets.
// Everything random comes from the seed, so a failing seed can be played again exactly.
// The match map is built on a map worker, as the real server does.
export async function runSoak(tier: string, seed: number, options: SoakOptions = {}): Promise<SoakReport> {
  const pool = new MapPool(1);
  try {
    return await playSoak(tier, seed, options, pool);
  } finally {
    await pool.close();
  }
}

async function playSoak(tier: string, seed: number, options: SoakOptions, pool: MapPool): Promise<SoakReport> {
  const { fakePlayers = 3, tickBudgetMs = 8, bandwidthKbps = 64, maxCorrection = 0.05 } = options;
  const base = loadRoomConfig({ maps: "generated", roster: true });
  const bots = options.fill === undefined ? base.bots : { ...base.bots, fill: { ...base.bots.fill, [tier]: options.fill } };
  const titan = options.titanHp === undefined ? base.titan : { ...base.titan, hp: options.titanHp };
  const guns = base.weapons.weapons;
  const start = options.startWeapon === undefined ? seed % guns.length : guns.findIndex((w) => w.id === options.startWeapon);
  if (start < 0) throw new Error(`soak: no weapon "${options.startWeapon}"`);
  const weapons = { ...base.weapons, start };
  const config = { ...base, bots, titan, weapons, random: lcg(seed), mapLater: (t: string, s: number) => pool.generate(t, s) };
  const chunks = parseChunkSet(readData("chunks.json"));
  const tiers = parseTiers(readData("tiers.json"));
  const room = new Room("SOAK", tier, config, null);
  const players = Array.from({ length: fakePlayers }, (_, i) => new HeadlessPlayer(room, config.mech, config.bots, chunks, tiers, parsePropConfig(readData("props.json")), lcg(seed + i + 1), config.roster ?? null, i, config.abilities, config.botAbilities, config.titan, config.drop?.bots ?? null, config.weapons));
  const problems: string[] = [];
  const problem = (text: string) => { if (problems.length < 20) problems.push(text); };

  // Waiting for the map before pressing start, without ticking, keeps the match the same for the same seed however
  // long the worker takes.
  while (!room.nextMapReady) await new Promise((resolve) => setTimeout(resolve, 2));
  room.receive(players[0]!.id, JSON.stringify({ t: "start" }));
  const maxTicks = Math.ceil((config.match.countdownSeconds + config.match.matchSeconds + 30) / STEP);
  const zoneMax = config.zones.zones.map((z) => z.hp);
  const times: number[] = [];
  let activeTicks = 0;
  let lastAlive = Infinity;
  const edge = room.mapMeters / 2 + 5;
  let aliveTicks = 0, aloneTicks = 0;
  const firstContact = new Map<number, number>();
  const altitude = config.drop?.altitudeMeters[tier];
  const landedAt = new Map<number, number>();
  const hungAt = new Map<number, { x: number; z: number }>();
  const steered: number[] = [];
  const landBy = altitude === undefined ? 0 : ballFallSeconds(altitude + DROP_VALLEY_METERS, config.mech) + DROP_SPARE_SECONDS;
  let stuckReported = false;

  for (let tick = 0; tick < maxTicks && room.matchState !== "results"; tick++) {
    for (const p of players) p.step();
    const started = performance.now();
    room.tick();
    times.push(performance.now() - started);
    if (room.matchState === "active") activeTicks++;

    // Every mech, every tick: real numbers, on the map, health inside its limits.
    let alive = 0;
    for (const m of room.inspect()) {
      if (![m.x, m.y, m.z, ...m.hp].every(Number.isFinite)) { problem(`tick ${tick}: mech ${m.id} has a bad number`); continue; }
      if (Math.abs(m.x) > edge || Math.abs(m.z) > edge) problem(`tick ${tick}: mech ${m.id} is outside the map at ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`);
      // Through the countdown everyone hangs still where the room put them, and nobody hangs once the match is live.
      if (m.dropPhase === DROP_HANGING) {
        if (room.matchState !== "countdown") problem(`tick ${tick}: mech ${m.id} is still hanging in a ${room.matchState} match`);
        const at = hungAt.get(m.id);
        if (!at) hungAt.set(m.id, { x: m.x, z: m.z });
        else if (at.x !== m.x || at.z !== m.z) problem(`tick ${tick}: mech ${m.id} moved while hanging`);
      }
      if (room.mapTerrain && !room.mapTerrain.mayStand(m.x, m.z)) problem(`tick ${tick}: mech ${m.id} is out past the island's limit at ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`);
      if (m.y < -50) problem(`tick ${tick}: mech ${m.id} fell under the map`);
      m.hp.forEach((hp, zone) => { if (hp < 0 || hp > zoneMax[zone]! + 1e-9) problem(`tick ${tick}: mech ${m.id} zone ${zone} has ${hp} hit points`); });
      if (m.participant && !m.eliminated) alive++;
    }
    // The Junk Titan too: real numbers, on the map, hit points inside its limits.
    const titan = room.junkTitan;
    if (titan) {
      if (![titan.x, titan.y, titan.z, titan.yaw, titan.hp].every(Number.isFinite)) problem(`tick ${tick}: the Titan has a bad number`);
      else if (Math.abs(titan.x) > edge || Math.abs(titan.z) > edge) problem(`tick ${tick}: the Titan is outside the map at ${titan.x.toFixed(1)}, ${titan.z.toFixed(1)}`);
      if (titan.hp < 0 || titan.hp > config.titan.hp) problem(`tick ${tick}: the Titan has ${titan.hp} hit points`);
    }
    if (room.matchState === "active") {
      const mechs = room.inspect();
      // The drop-in: everyone starts it in the air, and everyone is down in good time.
      const seconds = activeTicks * STEP;
      for (const m of mechs) {
        if (!m.participant || landedAt.has(m.id)) continue;
        if (altitude !== undefined && activeTicks === 1 && m.dropPhase === 0) problem(`mech ${m.id} started the match on the ground, not in the drop`);
        if (m.dropPhase === 0 || altitude === undefined) {
          landedAt.set(m.id, seconds);
          const at = hungAt.get(m.id);
          if (at) steered.push(Math.hypot(m.x - at.x, m.z - at.z));
        }
        else if (seconds > landBy && !stuckReported) {
          stuckReported = true;
          problem(`mech ${m.id} is still in the drop ${seconds.toFixed(1)} s into the match (at ${m.y.toFixed(0)} m), over ${landBy.toFixed(1)}`);
        }
      }
      for (const p of players) {
        const me = mechs.find((m) => m.id === p.id);
        if (!me || me.dead || me.eliminated) continue;
        aliveTicks++;
        const near = mechs.some((m) => m.id !== me.id && !m.dead && m.participant && Math.hypot(m.x - me.x, m.z - me.z) <= CONTACT_METERS);
        if (!near) aloneTicks++;
        else if (!firstContact.has(p.id)) firstContact.set(p.id, activeTicks * STEP);
      }
      if (alive > lastAlive) problem(`tick ${tick}: the alive count went up, from ${lastAlive} to ${alive}`);
      lastAlive = alive;
    }
  }

  if (room.matchState !== "results") problem("the match never finished");
  // Results began, so the room has asked for the next match's map. It must arrive (and before the pool closes).
  const asked = performance.now();
  while (!room.nextMapReady && performance.now() - asked < 10_000) await new Promise((resolve) => setTimeout(resolve, 2));
  if (room.matchState === "results" && !room.nextMapReady) problem("the next match's map never arrived");
  if (!players.some((p) => p.winnerSeen)) problem("nobody was told the result");
  const places = players[0]!.places;
  if (new Set(places).size !== places.length) problem(`places were handed out twice: ${places.join(", ")}`);

  times.sort((a, b) => a - b);
  const tickP99Ms = times[Math.floor(times.length * 0.99)] ?? 0;
  if (tickP99Ms > tickBudgetMs) problem(`99th percentile tick took ${tickP99Ms.toFixed(2)} ms, over ${tickBudgetMs}`);

  const seconds = times.length * STEP;
  const kbpsPerPlayer = Math.max(...players.map((p) => (p.bytesReceived * 8) / seconds / 1000));
  if (kbpsPerPlayer > bandwidthKbps) problem(`a player was sent ${kbpsPerPlayer.toFixed(0)} kbps, over ${bandwidthKbps}`);

  const worstCorrection = Math.max(...players.map((p) => p.worstCorrection));
  if (worstCorrection > maxCorrection) problem(`prediction drifted ${worstCorrection.toFixed(3)} m from the server, over ${maxCorrection}`);
  if (players.every((p) => p.corrections === 0)) problem("no snapshot was ever checked for prediction");
  if (room.secondaryCount.shots === 0) problem("nobody ever used a secondary fire");

  const contacts = players.map((p) => firstContact.get(p.id) ?? activeTicks * STEP).sort((a, b) => a - b);
  const matchMinutes = Math.max(activeTicks * STEP, 1) / 60;
  return {
    aloneFraction: aliveTicks > 0 ? aloneTicks / aliveTicks : 0,
    firstContactSeconds: contacts[Math.floor(contacts.length / 2)] ?? 0,
    knockoutsPerMinute: places.length / matchMinutes,
    tier, seed, problems, matchSeconds: activeTicks * STEP, players: fakePlayers, eliminations: places.length,
    tickP99Ms, tickWorstMs: times.at(-1) ?? 0, kbpsPerPlayer, worstCorrection, propsBroken: players[0]!.propsBroken,
    titanHpLeft: room.junkTitan ? room.junkTitan.hp / config.titan.hp : null,
    lastLandingSeconds: Math.max(0, ...landedAt.values()),
    medianLandingSeconds: median([...landedAt.values()]),
    medianSteerMeters: median(steered),
    startWeapon: config.weapons.weapons[config.weapons.start]!.id,
    secondaryShots: room.secondaryCount.shots,
    secondaryByKind: { windup: room.secondaryCount.windup, slug: room.secondaryCount.slug, charge: room.secondaryCount.charge }, headlessSecondaryShots: players.reduce((n, p) => n + p.secondaryShots, 0),
    pierced: room.secondaryCount.pierced, pinned: room.secondaryCount.pinned,
  };
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}
