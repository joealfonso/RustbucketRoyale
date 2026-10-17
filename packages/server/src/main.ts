import { loadRoomConfig, tierNames } from "./config";
import { Room } from "./Room";
import { RoomManager } from "./RoomManager";
import { startServer } from "./transport";

const port = Number(process.env.PORT ?? 8080);
const defaultTier = process.env.TIER ?? "medium";
const maxRooms = Number(process.env.MAX_ROOMS ?? 50);

const config = loadRoomConfig({ maps: "generated" });
const manager = new RoomManager((code, tier, bots) => new Room(code, tier, config, bots), tierNames(), defaultTier, maxRooms);
const server = await startServer(manager, port);
console.log(`Rustbucket Royale server listening on ws://localhost:${server.port} (default ${defaultTier}, up to ${maxRooms} rooms)`);
