import type { IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import { STEP, encodeServerBinary } from "@rustbucket/shared";
import type { Joined, RoomManager } from "./RoomManager";

const MAX_MESSAGE_BYTES = 4096;
const MAX_CATCH_UP_TICKS = 5;
const MAX_BOTS_REQUESTED = 64; // the room trims this to what the map has spawns for

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

// WebSocket front door. A connection to ws://host:port/?room=ABCD&tier=medium&bots=5 joins that room, making it
// if it is new. With no room in the address it makes a fresh room. Every room ticks at 60 Hz.
// Not done yet: check the Origin header against an allow list before this goes on a public host.
// `defaultBots` is how many bots a new room gets when its link does not say (`&bots=0` asks for none).
export function startServer(manager: RoomManager, port: number, defaultBots = 0): Promise<RunningServer> {
  const wss = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_BYTES });

  wss.on("connection", (socket, request: IncomingMessage) => {
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const asked = query.get("bots");
    const bots = asked === null ? defaultBots : Math.min(MAX_BOTS_REQUESTED, Math.max(0, Math.floor(Number(asked) || 0)));
    const joined: Joined | null = manager.join(query.get("room"), query.get("tier"), (message) => {
      if (socket.readyState !== socket.OPEN) return;
      // Snapshots and shots are packed binary, the rare messages are readable text.
      const packed = encodeServerBinary(message);
      if (packed) socket.send(packed);
      else socket.send(JSON.stringify(message));
    }, bots);
    if (!joined) {
      socket.close();
      return;
    }
    socket.on("message", (data, isBinary) => {
      const ok = isBinary ? joined.room.receive(joined.id, new Uint8Array(data as Buffer)) : joined.room.receive(joined.id, data.toString());
      if (!ok) socket.close();
    });
    socket.on("close", () => manager.leave(joined));
    socket.on("error", () => socket.close());
  });

  // Drift corrected loop: run as many ticks as are owed, so a slow tick does not slow the game down.
  let next = performance.now();
  let timer: NodeJS.Timeout;
  const loop = () => {
    const now = performance.now();
    let ticks = 0;
    while (next <= now && ticks < MAX_CATCH_UP_TICKS) {
      manager.tick();
      next += STEP * 1000;
      ticks++;
    }
    if (next <= now) next = now; // fell too far behind, skip ahead
    timer = setTimeout(loop, Math.max(1, next - performance.now()));
  };
  loop();

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const address = wss.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actualPort,
        close: () => new Promise((done) => {
          clearTimeout(timer);
          for (const client of wss.clients) client.terminate();
          wss.close(() => done());
        }),
      });
    });
  });
}
