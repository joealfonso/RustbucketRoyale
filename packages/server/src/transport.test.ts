import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { SnapshotMemory, createMechInput, decodeServerBinary, encodeInput, type InputMessage, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Room, type MapForRoom } from "./Room";
import { RoomManager } from "./RoomManager";
import { startServer, type RunningServer } from "./transport";

let server: RunningServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

const config = loadRoomConfig();
async function start(): Promise<RunningServer> {
  const manager = new RoomManager((code, tier, bots) => new Room(code, tier, config, bots), ["small", "medium", "large"], "small", 5);
  server = await startServer(manager, 0);
  return server;
}

function connect(port: number, query = ""): Promise<{ socket: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://localhost:${port}/${query}`);
    const messages: ServerMessage[] = [];
    const memory = new SnapshotMemory();
    // Snapshots and shots come packed, everything else as text.
    socket.on("message", (data, isBinary) => {
      const message = isBinary ? decodeServerBinary(new Uint8Array(data as Buffer), memory) : JSON.parse(data.toString());
      if (message) messages.push(message);
    });
    socket.on("open", () => resolve({ socket, messages }));
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("websocket server", () => {
  it("puts two clients with the same room code in one room, where they see each other and each other's shots", async () => {
    const { port } = await start();
    const a = await connect(port, "?room=ABCD&tier=small");
    const b = await connect(port, "?room=abcd");

    const input = { t: "input", ...createMechInput(), moveY: 1, aimYaw: Math.PI, fire: true, targetX: 0, targetY: 2, targetZ: 100 };
    for (let seq = 1; seq <= 30; seq++) {
      a.socket.send(JSON.stringify({ ...input, seq }));
      await wait(16);
    }

    expect(a.messages.find((m) => m.t === "welcome")).toMatchObject({ code: "ABCD" });
    expect(b.messages.find((m) => m.t === "welcome")).toMatchObject({ code: "ABCD" });
    const snapshot = b.messages.filter((m) => m.t === "snapshot").at(-1);
    expect(snapshot?.t === "snapshot" && snapshot.others.length).toBe(1);
    expect(b.messages.some((m) => m.t === "shot")).toBe(true);
    const own = a.messages.filter((m) => m.t === "snapshot").at(-1);
    expect(own?.t === "snapshot" && own.ack).toBeGreaterThan(0);
    a.socket.close(); b.socket.close();
  });

  it("keeps different room codes apart", async () => {
    const { port } = await start();
    const a = await connect(port, "?room=AAAA");
    const b = await connect(port, "?room=BBBB");
    await wait(150);
    const snapshot = a.messages.filter((m) => m.t === "snapshot").at(-1);
    expect(snapshot?.t === "snapshot" && snapshot.others.length).toBe(0);
    a.socket.close(); b.socket.close();
  });

  it("makes a new room when no code is given", async () => {
    const { port } = await start();
    const a = await connect(port);
    await wait(50);
    expect(a.messages.find((m) => m.t === "welcome")).toMatchObject({ t: "welcome", code: expect.stringMatching(/^[A-Z2-9]{4}$/) });
    a.socket.close();
  });

  it("refuses a bad room code with a reason", async () => {
    const { port } = await start();
    const a = await connect(port, "?room=x");
    await wait(50);
    expect(a.messages[0]).toMatchObject({ t: "refused" });
  });

  it("closes a connection that sends an oversized message", async () => {
    const { port } = await start();
    const client = await connect(port);
    const closed = new Promise<void>((resolve) => client.socket.on("close", () => resolve()));
    client.socket.send("x".repeat(10_000));
    await closed;
  });
});

describe("packed messages", () => {
  it("accepts a packed input and answers with packed snapshots that acknowledge it", async () => {
    const { port } = await start();
    const a = await connect(port, "?room=PACK");
    const input: InputMessage = { t: "input", seq: 1, ...createMechInput(), moveY: 1, aimYaw: Math.fround(Math.PI) };
    for (let seq = 1; seq <= 20; seq++) {
      a.socket.send(encodeInput({ ...input, seq }, false));
      await wait(16);
    }
    await wait(100);
    const snap = a.messages.filter((m) => m.t === "snapshot").at(-1);
    expect(snap?.t === "snapshot" && snap.ack).toBeGreaterThan(5);
    expect(snap?.t === "snapshot" && snap.you.z).toBeGreaterThan(0.5); // it walked forward
    a.socket.close();
  });

  it("ignores a packed input that has been tampered with", async () => {
    const { port } = await start();
    const a = await connect(port, "?room=EVIL");
    const good = encodeInput({ t: "input", seq: 1, ...createMechInput() }, false);
    a.socket.send(good.slice(0, 7));
    await wait(100);
    const snap = a.messages.filter((m) => m.t === "snapshot").at(-1);
    expect(snap?.t === "snapshot" && snap.ack).toBe(0);
    a.socket.close();
  });
});

describe("bots by link", () => {
  it("gives a new room the default number of bots when the link does not say, and none when it says bots=0", async () => {
    const manager = new RoomManager((code, tier, bots) => new Room(code, tier, config, bots), ["small"], "small", 5);
    const running = await startServer(manager, 0, 3);
    try {
      const withDefault = await connect(running.port, "?room=DEFA");
      const none = await connect(running.port, "?room=NONE&bots=0");
      const asked = await connect(running.port, "?room=FIVE&bots=2");
      await wait(150);
      const others = (c: { messages: ServerMessage[] }) => {
        const snap = c.messages.filter((m) => m.t === "snapshot").at(-1);
        return snap?.t === "snapshot" ? snap.others.length : -1;
      };
      expect(others(withDefault)).toBe(3);
      expect(others(none)).toBe(0);
      expect(others(asked)).toBe(2);
      for (const c of [withDefault, none, asked]) c.socket.close();
    } finally {
      await running.close();
    }
  });
});

describe("a new room whose map is built elsewhere", () => {
  // Lobby maps arrive `delayMs` after they are asked for, as from the worker pool.
  async function startPrepared(delayMs: number): Promise<{ running: RunningServer; manager: RoomManager }> {
    const manager = new RoomManager(
      (code, tier, bots, difficulty, lobby) => new Room(code, tier, config, bots, difficulty, lobby), ["small"], "small", 5, Math.random,
      (tier, seed) => new Promise<MapForRoom>((resolve) => setTimeout(() => resolve(config.mapFor(tier, seed)), delayMs)),
    );
    server = await startServer(manager, 0);
    return { running: server, manager };
  }
  const closedOf = (socket: WebSocket) => new Promise<void>((resolve) => socket.on("close", () => resolve()));

  it("holds the first players until the room opens, then welcomes them all into it", async () => {
    const { running } = await startPrepared(150);
    const a = await connect(running.port, "?room=WAIT");
    const b = await connect(running.port, "?room=wait");
    await wait(50);
    expect(a.messages).toHaveLength(0);
    await wait(250);
    expect(a.messages.find((m) => m.t === "welcome")).toMatchObject({ code: "WAIT" });
    expect(b.messages.find((m) => m.t === "welcome")).toMatchObject({ code: "WAIT" });
    const snapshot = b.messages.filter((m) => m.t === "snapshot").at(-1);
    expect(snapshot?.t === "snapshot" && snapshot.others.length).toBe(1);
    a.socket.close(); b.socket.close();
  });

  it("drops a room whose only player left while it was being prepared", async () => {
    const { running, manager } = await startPrepared(150);
    const a = await connect(running.port, "?room=LEFT");
    await wait(20);
    expect(manager.roomCount).toBe(1);
    a.socket.close();
    await wait(50);
    expect(manager.roomCount).toBe(0);
    await wait(200);
    expect(manager.roomCount).toBe(0);
  });

  it("closes a connection that floods while waiting, and one that floods once it is in", async () => {
    const { running } = await startPrepared(150);
    const early = await connect(running.port, "?room=SPAM");
    const earlyClosed = closedOf(early.socket);
    for (let i = 0; i < 300; i++) early.socket.send(JSON.stringify({ t: "start" }));
    await earlyClosed;
    expect(early.messages.some((m) => m.t === "welcome")).toBe(false);

    const late = await connect(running.port, "?room=FLUD");
    await wait(250);
    expect(late.messages.some((m) => m.t === "welcome")).toBe(true);
    const lateClosed = closedOf(late.socket);
    for (let i = 0; i < 300; i++) late.socket.send(JSON.stringify({ t: "start" }));
    await lateClosed;
  });
});
