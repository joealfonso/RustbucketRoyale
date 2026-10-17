import { loadRoomConfig, tierNames } from "./config";
import { Room } from "./Room";
import { RoomManager } from "./RoomManager";
import { startServer } from "./transport";

const port = Number(process.env.PORT ?? 8080);
const defaultTier = process.env.TIER ?? "medium";
const maxRooms = Number(process.env.MAX_ROOMS ?? 50);
// New rooms keep themselves topped up with bots to the tier's size unless the link says `&bots=N`.
// Set DEFAULT_BOTS to a number to give new rooms that many instead, or 0 for none.
const defaultBots = process.env.DEFAULT_BOTS === undefined ? null : Number(process.env.DEFAULT_BOTS);

const config = loadRoomConfig({ maps: "generated" });
const manager = new RoomManager((code, tier, bots) => new Room(code, tier, config, bots), tierNames(), defaultTier, maxRooms);
const server = await startServer(manager, port, defaultBots);
console.log(`Rustbucket Royale server listening on ws://localhost:${server.port} (default ${defaultTier}, up to ${maxRooms} rooms, ${defaultBots === null ? "bots fill to the tier size" : `${defaultBots} bots by default`})`);
