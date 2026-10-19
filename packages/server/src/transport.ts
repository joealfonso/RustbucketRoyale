import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { STEP, SnapshotMemory, encodeServerBinary, parseBotDifficulty, parseRejoin, type ServerMessage } from "@rustbucket/shared";
import type { RoomManager, Ticket } from "./RoomManager";
import type { StaticSite } from "./staticSite";

const MAX_MESSAGE_BYTES = 4096;
const MAX_CATCH_UP_TICKS = 5;
const MAX_BOTS_REQUESTED = 64; // the room trims this to what the map has spawns for
// A client sends nothing before its welcome, so messages while its room is prepared are dropped. This many is the
// burst a joined player may send before the room's flood kick (net.json: 150 a second, kicked at 100 over), so an
// early burst is treated no better than a later one.
const MAX_MESSAGES_WHILE_WAITING = 250;

export interface ServerOptions {
  site?: StaticSite | null; // the built client, served from the same address
  // Which pages may open a game connection, by their Origin header. null lets anyone in: local development, where
  // the page comes from Vite on another port, and tools that send no Origin. "same-host" lets in only pages served
  // by this server's own host name; a list names each allowed origin (https://example.com).
  origins?: string[] | "same-host" | null;
  // How often each socket is pinged. One that has not answered the last ping by the next is closed: a laptop that
  // slept or a dropped Wi-Fi often never closes its connection, and its mech would stand frozen in the match.
  heartbeatMs?: number;
  // Development only: pretend every connection is far away. Each message waits half the round trip each way, give or
  // take half the jitter, and still arrives in order, as over TCP. For trying 100 to 150 ms of internet on one machine.
  simLag?: { ms: number; jitterMs: number } | null;
}

const HEARTBEAT_MS = 10_000;

// Whether a connection's page may play here. A browser always sends its page's origin and a page cannot fake it, so
// this stops other sites embedding the game against this server; it is not a lock against hand made clients.
export function originAllowed(origin: string | undefined, host: string | undefined, origins: ServerOptions["origins"]): boolean {
  if (!origins) return true;
  if (!origin) return false;
  if (origins === "same-host") {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  return origins.includes(origin);
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

// WebSocket front door. A connection to ws://host:port/?room=ABCD&tier=medium&bots=5&difficulty=hard joins that room,
// making it if it is new. With no room in the address it makes a fresh room. Every room ticks at 60 Hz.
// A new room may take a moment to prepare its map; the socket waits, and its welcome comes when the room opens.
// Not done yet: check the Origin header against an allow list before this goes on a public host.
// `defaultBots` is how many bots a new room gets when its link does not say (`&bots=0` asks for none). null keeps
// the room topped up to its tier's target size.
// `onTick`, if given, hears how long each tick of every room took (packing and sending included) and how late it
// started, for load testing.
// The same port answers plain web requests: GET /health (for the host's checks: up, and how many rooms) and the
// built client's files when `site` is given.
export function startServer(
  manager: RoomManager, port: number, defaultBots: number | null = 0, onTick?: (ms: number, lateMs: number) => void, options: ServerOptions = {},
): Promise<RunningServer> {
  const http = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ok: true, rooms: manager.roomCount }));
      return;
    }
    if (options.site?.serve(request, response)) return;
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
  const alive = new Map<object, () => void>(); // each open socket's heartbeat check
  const heartbeat = setInterval(() => { for (const check of alive.values()) check(); }, options.heartbeatMs ?? HEARTBEAT_MS);
  const wss = new WebSocketServer({
    server: http, maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => originAllowed(origin, req.headers.host, options.origins),
  });

  wss.on("connection", (socket, request: IncomingMessage) => {
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const asked = query.get("bots");
    const bots = asked === null ? defaultBots : Math.min(MAX_BOTS_REQUESTED, Math.max(0, Math.floor(Number(asked) || 0)));
    const difficulty = parseBotDifficulty(query.get("difficulty"));
    const memory = new SnapshotMemory(); // what this socket was last sent, so snapshots carry only changes
    const lag = options.simLag ?? null;
    let lastOut = 0, lastIn = 0;
    // When a delayed message is due: never before the one sent ahead of it.
    const due = (after: number) => Math.max(after, performance.now() + lag!.ms / 2 + (Math.random() * 2 - 1) * (lag!.jitterMs / 2));
    const deliver = (message: ServerMessage) => {
      if (socket.readyState !== socket.OPEN) return;
      // Snapshots and shots are packed binary, the rare messages are readable text. Packed now, in order, even when
      // sending is delayed, because a snapshot is written against the one before it.
      const packed = encodeServerBinary(message, memory);
      const out = packed ?? JSON.stringify(message);
      if (!lag) { socket.send(out); return; }
      lastOut = due(lastOut);
      setTimeout(() => { if (socket.readyState === socket.OPEN) socket.send(out); }, lastOut - performance.now());
    };
    // Closes once everything already sent has gone, including anything the lag simulator is holding back.
    const closeAfterSent = () => setTimeout(() => socket.close(), lag ? Math.max(0, lastOut - performance.now()) + 1 : 0);
    // `?rejoin` in the address: a dropped player coming back. Their room waits for the first message, which says who
    // they were and carries their secret (never the address: proxies log addresses).
    const rejoining = query.has("rejoin");
    let ticket: Ticket | null = rejoining ? null : manager.join(query.get("room"), query.get("tier"), deliver, bots, difficulty, () => socket.close());
    if (!rejoining && !ticket) {
      socket.close();
      return;
    }
    let early = 0;
    const handle = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!ticket) {
        const ask = isBinary ? null : parseRejoin(data.toString());
        ticket = ask ? manager.rejoin(query.get("room"), ask.id, ask.token, deliver) : null;
        if (!ticket) {
          deliver({ t: "refused", reason: "Too late to get back into that match.", rejoinFailed: true });
          closeAfterSent();
        }
        return;
      }
      const joined = ticket.joined;
      if (!joined) {
        if (++early > MAX_MESSAGES_WHILE_WAITING) socket.close();
        return;
      }
      const ok = isBinary ? joined.room.receive(joined.id, new Uint8Array(data as Buffer)) : joined.room.receive(joined.id, data.toString());
      if (!ok) socket.close();
    };
    socket.on("message", (data, isBinary) => {
      if (!lag) { handle(data, isBinary); return; }
      lastIn = due(lastIn);
      setTimeout(() => { if (socket.readyState === socket.OPEN) handle(data, isBinary); }, lastIn - performance.now());
    });
    let answered = true;
    socket.on("pong", () => { answered = true; });
    alive.set(socket, () => {
      if (!answered) { socket.terminate(); return; }
      answered = false;
      socket.ping();
    });
    socket.on("close", () => { alive.delete(socket); if (ticket) manager.leave(ticket); });
    socket.on("error", () => socket.close());
  });

  // Drift corrected loop: run as many ticks as are owed, so a slow tick does not slow the game down.
  let next = performance.now();
  let timer: NodeJS.Timeout;
  const loop = () => {
    const now = performance.now();
    let ticks = 0;
    while (next <= now && ticks < MAX_CATCH_UP_TICKS) {
      const started = performance.now();
      manager.tick();
      onTick?.(performance.now() - started, started - next);
      next += STEP * 1000;
      ticks++;
    }
    if (next <= now) next = now; // fell too far behind, skip ahead
    timer = setTimeout(loop, Math.max(1, next - performance.now()));
  };
  loop();

  return new Promise((resolve) => {
    http.listen(port, () => {
      const address = http.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actualPort,
        close: () => new Promise((done) => {
          clearTimeout(timer);
          clearInterval(heartbeat);
          for (const client of wss.clients) client.terminate();
          wss.close(() => http.close(() => done()));
        }),
      });
    });
  });
}
