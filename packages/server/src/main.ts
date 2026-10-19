import { loadRoomConfig, loadTuningRaws, tierNames } from "./config";
import { Room } from "./Room";
import { RoomManager } from "./RoomManager";
import { startServer } from "./transport";

const port = Number(process.env.PORT ?? 8080);
const defaultTier = process.env.TIER ?? "medium";
const maxRooms = Number(process.env.MAX_ROOMS ?? 50);
// New rooms keep themselves topped up with bots to the tier's size unless the link says `&bots=N`.
// Set DEFAULT_BOTS to a number to give new rooms that many instead, or 0 for none.
const defaultBots = process.env.DEFAULT_BOTS === undefined ? null : Number(process.env.DEFAULT_BOTS);

// DEV_TUNING=1 lets anyone in a room change gameplay numbers live from the tuning panel. Never set it on a public host.
const devTuning = process.env.DEV_TUNING === "1";
const config = { ...loadRoomConfig({ maps: "generated", roster: true }), ...(devTuning ? { tuningRaws: loadTuningRaws() } : {}) };
const manager = new RoomManager((code, tier, bots, difficulty) => new Room(code, tier, config, bots, difficulty), tierNames(), defaultTier, maxRooms);
// LOAD_STATS=1 prints a line of tick timings every 5 s, for scripts/load-test.ts.
const tickTimes: number[] = [], lateTimes: number[] = [];
const onTick = process.env.LOAD_STATS === "1" ? (ms: number, late: number) => { tickTimes.push(ms); lateTimes.push(late); } : undefined;
if (onTick) {
  setInterval(() => {
    const p99 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.99)] ?? 0;
    const mean = tickTimes.reduce((a, b) => a + b, 0) / Math.max(1, tickTimes.length);
    console.log(`LOAD ${JSON.stringify({ rooms: manager.roomCount, ticks: tickTimes.length, meanMs: mean, p99Ms: p99(tickTimes), lateP99Ms: p99(lateTimes) })}`);
    tickTimes.length = 0;
    lateTimes.length = 0;
  }, 5000);
}
const server = await startServer(manager, port, defaultBots, onTick);
console.log(`Rustbucket Royale server listening on ws://localhost:${server.port} (default ${defaultTier}, up to ${maxRooms} rooms, ${defaultBots === null ? "bots fill to the tier size" : `${defaultBots} bots by default`}${devTuning ? ", live tuning ON" : ""})`);
