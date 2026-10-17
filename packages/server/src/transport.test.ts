import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createMechInput, type ServerMessage } from "@rustbucket/shared";
import { loadRoomConfig } from "./config";
import { Room } from "./Room";
import { startServer, type RunningServer } from "./transport";

let server: RunningServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

function connect(port: number): Promise<{ socket: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://localhost:${port}`);
    const messages: ServerMessage[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    socket.on("open", () => resolve({ socket, messages }));
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("websocket server", () => {
  it("two clients join, see each other, and one sees the other's shot", async () => {
    server = await startServer(new Room(loadRoomConfig()), 0);
    const a = await connect(server.port);
    const b = await connect(server.port);

    const input = { t: "input", ...createMechInput(), moveY: 1, aimYaw: Math.PI, fire: true, targetX: 0, targetY: 2, targetZ: 100 };
    for (let seq = 1; seq <= 30; seq++) {
      a.socket.send(JSON.stringify({ ...input, seq }));
      await wait(16);
    }

    const welcome = a.messages.find((m) => m.t === "welcome");
    expect(welcome).toBeDefined();
    const snapshot = b.messages.filter((m) => m.t === "snapshot").at(-1);
    expect(snapshot?.t === "snapshot" && snapshot.others.length).toBe(1);
    expect(b.messages.some((m) => m.t === "shot")).toBe(true);
    const own = a.messages.filter((m) => m.t === "snapshot").at(-1);
    expect(own?.t === "snapshot" && own.ack).toBeGreaterThan(0);
    a.socket.close(); b.socket.close();
  });

  it("closes a connection that sends an oversized message", async () => {
    server = await startServer(new Room(loadRoomConfig()), 0);
    const client = await connect(server.port);
    const closed = new Promise<void>((resolve) => client.socket.on("close", () => resolve()));
    client.socket.send("x".repeat(10_000));
    await closed;
  });
});
