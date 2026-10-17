import { loadRoomConfig } from "./config";
import { Room } from "./Room";
import { startServer } from "./transport";

const port = Number(process.env.PORT ?? 8080);
const tier = process.env.TIER ?? "medium";
// The server may use any random number to choose the seed. Only what is built from the seed has to be repeatable.
const seed = process.env.SEED !== undefined ? Number(process.env.SEED) : Math.floor(Math.random() * 0x100000000);

const started = Date.now();
const room = new Room(loadRoomConfig({ tier, seed }));
console.log(`Built ${tier} map from seed ${seed} in ${Date.now() - started} ms`);
const server = await startServer(room, port);
console.log(`Rustbucket Royale server listening on ws://localhost:${server.port}`);
