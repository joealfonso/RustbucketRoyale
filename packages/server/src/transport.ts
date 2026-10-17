import { WebSocketServer } from "ws";
import { STEP } from "@rustbucket/shared";
import type { Room } from "./Room";

const MAX_MESSAGE_BYTES = 4096;
const MAX_CATCH_UP_TICKS = 5;

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

// WebSocket front door. Each connection becomes a player in the room, and the room ticks at 60 Hz.
// Not done yet: check the Origin header against an allow list before this goes on a public host.
export function startServer(room: Room, port: number): Promise<RunningServer> {
  const wss = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_BYTES });

  wss.on("connection", (socket) => {
    const id = room.join((message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    });
    if (id === null) {
      socket.close();
      return;
    }
    socket.on("message", (data) => {
      if (!room.receive(id, data.toString())) socket.close();
    });
    socket.on("close", () => room.leave(id));
    socket.on("error", () => socket.close());
  });

  // Drift corrected loop: run as many ticks as are owed, so a slow tick does not slow the game down.
  let next = performance.now();
  let timer: NodeJS.Timeout;
  const loop = () => {
    const now = performance.now();
    let ticks = 0;
    while (next <= now && ticks < MAX_CATCH_UP_TICKS) {
      room.tick();
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
