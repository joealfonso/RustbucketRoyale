import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createMechInput, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Room } from "./Room";
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
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
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
