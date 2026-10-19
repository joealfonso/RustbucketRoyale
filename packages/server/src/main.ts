import { loadRoomConfig, loadTuningRaws, tierNames } from "./config";
import { MapPool } from "./MapPool";
import { Room } from "./Room";
import { RoomManager } from "./RoomManager";
import { loadStaticSite } from "./staticSite";
import { startServer } from "./transport";

const port = Number(process.env.PORT ?? 8080);
const defaultTier = process.env.TIER ?? "medium";
const maxRooms = Number(process.env.MAX_ROOMS ?? 50);
// New rooms keep themselves topped up with bots to the tier's size unless the link says `&bots=N`.
// Set DEFAULT_BOTS to a number to give new rooms that many instead, or 0 for none.
const defaultBots = process.env.DEFAULT_BOTS === undefined ? null : Number(process.env.DEFAULT_BOTS);

// NODE_ENV=production is the public host: the server also serves the built client (npm run build first), only pages
// it served may connect (or the origins in ALLOWED_ORIGINS, comma separated), and live tuning is refused.
const production = process.env.NODE_ENV === "production";
// DEV_TUNING=1 lets anyone in a room change gameplay numbers live from the tuning panel. Never set it on a public host.
const devTuning = process.env.DEV_TUNING === "1";
if (production && devTuning) {
  console.error("DEV_TUNING is refused with NODE_ENV=production: it lets any player change the game for everyone in their room.");
  process.exit(1);
}
// SIM_LAG_MS=120 (and SIM_JITTER_MS=20) delays every message as if each player were that far away, for trying
// internet lag on one machine. Development only.
const simLagMs = Number(process.env.SIM_LAG_MS ?? 0);
const simLag = simLagMs > 0 ? { ms: simLagMs, jitterMs: Number(process.env.SIM_JITTER_MS ?? 0) } : null;
if (production && simLag) {
  console.error("SIM_LAG_MS is refused with NODE_ENV=production: it would slow every real player down.");
  process.exit(1);
}
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean);
const site = production ? loadStaticSite(new URL("../../client/dist", import.meta.url).pathname) : null;
if (site && site.fileCount === 0) {
  console.error("No built client in packages/client/dist: run npm run build first.");
  process.exit(1);
}
// Match maps are built on this many worker threads, so building one never stalls the rooms. 0 builds them on the
// main thread instead (the old way, for comparing).
const mapWorkers = Number(process.env.MAP_WORKERS ?? 2);
const pool = mapWorkers > 0 ? new MapPool(mapWorkers) : null;
const config = {
  ...loadRoomConfig({ maps: "generated", roster: true }),
  ...(devTuning ? { tuningRaws: loadTuningRaws() } : {}),
  ...(pool ? { mapLater: (tier: string, seed: number) => pool.generate(tier, seed) } : {}),
};
// With workers a new room's lobby map is built on them too, so making a room never stalls the others.
const manager = new RoomManager(
  (code, tier, bots, difficulty, lobby) => new Room(code, tier, config, bots, difficulty, lobby), tierNames(), defaultTier, maxRooms, Math.random,
  pool ? (tier, seed) => pool.generate(tier, seed) : undefined,
);
// LOAD_STATS=1 prints a line of tick timings every 5 s, for scripts/load-test.ts.
const tickTimes: number[] = [], lateTimes: number[] = [];
const onTick = process.env.LOAD_STATS === "1" ? (ms: number, late: number) => { tickTimes.push(ms); lateTimes.push(late); } : undefined;
if (onTick) {
  setInterval(() => {
    const p99 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.99)] ?? 0;
    const mean = tickTimes.reduce((a, b) => a + b, 0) / Math.max(1, tickTimes.length);
    console.log(`LOAD ${JSON.stringify({ rooms: manager.roomCount, ticks: tickTimes.length, meanMs: mean, p99Ms: p99(tickTimes), lateP99Ms: p99(lateTimes), lateMaxMs: Math.max(0, ...lateTimes), rssMb: process.memoryUsage().rss / 1e6 })}`);
    tickTimes.length = 0;
    lateTimes.length = 0;
  }, 5000);
}
const server = await startServer(manager, port, defaultBots, onTick, { site, origins: production ? (allowedOrigins?.length ? allowedOrigins : "same-host") : null, simLag });
// Stopping (a deploy, Ctrl+C): tell everyone first. Their pages keep trying to reconnect, and once the server is
// back they land in a room with the same code.
let stopping = false;
const stop = () => {
  if (stopping) process.exit(0); // a second Ctrl+C means now
  stopping = true;
  console.log("stopping");
  manager.tellEveryone({ t: "notice", text: "The server is restarting for an update. Back in a moment..." });
  setTimeout(() => { void server.close().then(() => process.exit(0)); }, 500).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// A line a minute while the room count changes, for the host's logs. Room codes and counts only, never who is playing.
if (production) {
  let logged = -1;
  setInterval(() => {
    if (manager.roomCount !== logged) console.log(`rooms ${manager.roomCount}`);
    logged = manager.roomCount;
  }, 60_000).unref();
}
console.log(`Rustbucket Royale server listening on ${production ? `http://localhost:${server.port} (the game and its page)` : `ws://localhost:${server.port}`} (default ${defaultTier}, up to ${maxRooms} rooms, ${defaultBots === null ? "bots fill to the tier size" : `${defaultBots} bots by default`}${devTuning ? ", live tuning ON" : ""}${simLag ? `, pretending ${simLag.ms} ms of lag` : ""}, ${mapWorkers} map workers)`);
