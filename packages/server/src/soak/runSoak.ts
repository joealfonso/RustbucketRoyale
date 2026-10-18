import { readFileSync } from "node:fs";
import { STEP, parseChunkSet, parsePropConfig, parseTiers } from "@rustbucket/shared";
import { loadRoomConfig } from "../config";
import { Room } from "../Room";
import { lcg } from "../testClient";
import { HeadlessPlayer } from "./HeadlessPlayer";

export interface SoakOptions {
  fakePlayers?: number;
  tickBudgetMs?: number; // the 99th percentile server tick must stay under this
  bandwidthKbps?: number; // per player, averaged over the match
  maxCorrection?: number; // metres, the largest prediction correction allowed outside respawns and new maps
  fill?: number; // people plus bots in the room, in place of the tier's number in bots.json, for trying other counts
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
}

const CONTACT_METERS = 150; // the radar's range: anything closer can be seen or heard to matter

const readData = (name: string) => JSON.parse(readFileSync(new URL(`../../../../data/${name}`, import.meta.url), "utf8"));

// Plays one whole match, start to results, as fast as the computer can, on the real generated map for a tier.
// The room fills itself with bots, and a few headless players join that behave like real browsers. Every tick it
// checks the state makes sense, and at the end it checks the time, bandwidth and prediction budgets.
// Everything random comes from the seed, so a failing seed can be played again exactly.
export function runSoak(tier: string, seed: number, options: SoakOptions = {}): SoakReport {
  const { fakePlayers = 3, tickBudgetMs = 8, bandwidthKbps = 64, maxCorrection = 0.05 } = options;
  const base = loadRoomConfig({ maps: "generated" });
  const bots = options.fill === undefined ? base.bots : { ...base.bots, fill: { ...base.bots.fill, [tier]: options.fill } };
  const config = { ...base, bots, random: lcg(seed) };
  const chunks = parseChunkSet(readData("chunks.json"));
  const tiers = parseTiers(readData("tiers.json"));
  const room = new Room("SOAK", tier, config, null);
  const players = Array.from({ length: fakePlayers }, (_, i) => new HeadlessPlayer(room, config.mech, config.bots, chunks, tiers, parsePropConfig(readData("props.json")), lcg(seed + i + 1)));
  const problems: string[] = [];
  const problem = (text: string) => { if (problems.length < 20) problems.push(text); };

  room.receive(players[0]!.id, JSON.stringify({ t: "start" }));
  const maxTicks = Math.ceil((config.match.countdownSeconds + config.match.matchSeconds + 30) / STEP);
  const zoneMax = config.zones.zones.map((z) => z.hp);
  const times: number[] = [];
  let activeTicks = 0;
  let lastAlive = Infinity;
  const edge = room.mapMeters / 2 + 5;
  let aliveTicks = 0, aloneTicks = 0;
  const firstContact = new Map<number, number>();

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
      if (m.y < -50) problem(`tick ${tick}: mech ${m.id} fell under the map`);
      m.hp.forEach((hp, zone) => { if (hp < 0 || hp > zoneMax[zone]! + 1e-9) problem(`tick ${tick}: mech ${m.id} zone ${zone} has ${hp} hit points`); });
      if (m.participant && !m.eliminated) alive++;
    }
    if (room.matchState === "active") {
      const mechs = room.inspect();
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

  const contacts = players.map((p) => firstContact.get(p.id) ?? activeTicks * STEP).sort((a, b) => a - b);
  const matchMinutes = Math.max(activeTicks * STEP, 1) / 60;
  return {
    aloneFraction: aliveTicks > 0 ? aloneTicks / aliveTicks : 0,
    firstContactSeconds: contacts[Math.floor(contacts.length / 2)] ?? 0,
    knockoutsPerMinute: places.length / matchMinutes,
    tier, seed, problems, matchSeconds: activeTicks * STEP, players: fakePlayers, eliminations: places.length,
    tickP99Ms, tickWorstMs: times.at(-1) ?? 0, kbpsPerPlayer, worstCorrection,
  };
}
