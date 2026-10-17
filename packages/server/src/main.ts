import { loadRoomConfig } from "./config";
import { Room } from "./Room";
import { startServer } from "./transport";

const port = Number(process.env.PORT ?? 8080);
const room = new Room(loadRoomConfig());
const server = await startServer(room, port);
console.log(`Rustbucket Royale server listening on ws://localhost:${server.port}`);
