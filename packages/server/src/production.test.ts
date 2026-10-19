import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { loadRoomConfig } from "./config";
import { Room } from "./Room";
import { RoomManager } from "./RoomManager";
import { loadStaticSite } from "./staticSite";
import { originAllowed, startServer, type RunningServer, type ServerOptions } from "./transport";

let server: RunningServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

// A made-up build: a page, a hashed script and a model big enough to be worth compressing.
function fakeBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), "rustbucket-site-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "models"));
  writeFileSync(join(dir, "index.html"), `<!doctype html><title>Rustbucket Royale</title>${"<p>junk</p>".repeat(200)}`);
  writeFileSync(join(dir, "assets", "main-abc123.js"), "console.log('hi');".repeat(200));
  writeFileSync(join(dir, "models", "Mech.glb"), Buffer.alloc(20_000, 7));
  writeFileSync(join(dir, ".gitkeep"), "");
  return dir;
}

const config = loadRoomConfig();
async function start(options: ServerOptions): Promise<number> {
  const manager = new RoomManager((code, tier, bots) => new Room(code, tier, config, bots), ["small", "medium", "large"], "small", 5);
  server = await startServer(manager, 0, 0, undefined, options);
  return server.port;
}

// A raw GET, so the test sees the bytes and headers as sent (fetch would undo the compression).
function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    request({ port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject).end();
  });
}

// Whether a socket from a page at `origin` gets in.
function opens(port: number, origin?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://localhost:${port}/?create&tier=small&bots=0`, origin ? { origin } : {});
    socket.on("open", () => { socket.close(); resolve(true); });
    socket.on("error", () => resolve(false));
  });
}

describe("production server", () => {
  it("serves the page, its files compressed, with long caching only for hashed files", async () => {
    const port = await start({ site: loadStaticSite(fakeBuild()) });
    const page = await get(port, "/?room=ABCD", { "accept-encoding": "gzip, deflate, br" });
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["content-encoding"]).toBe("br");
    expect(page.headers["cache-control"]).toBe("no-cache");
    const model = await get(port, "/models/Mech.glb", { "accept-encoding": "gzip" });
    expect(model.headers["content-encoding"]).toBe("gzip");
    expect(model.body.length).toBeLessThan(20_000 / 10);
    const script = await get(port, "/assets/main-abc123.js");
    expect(script.headers["content-encoding"]).toBeUndefined(); // asked for nothing, gets it plain
    expect(script.headers["cache-control"]).toContain("immutable");
  });

  it("serves only files in the build", async () => {
    const port = await start({ site: loadStaticSite(fakeBuild()) });
    expect((await get(port, "/../../package.json")).status).toBe(404);
    expect((await get(port, "/%2e%2e/%2e%2e/package.json")).status).toBe(404);
    expect((await get(port, "/.gitkeep")).status).toBe(404);
    expect((await get(port, "/nope.js")).status).toBe(404);
  });

  it("answers the host's health check with the room count", async () => {
    const port = await start({});
    const health = await get(port, "/health");
    expect(JSON.parse(health.body.toString())).toEqual({ ok: true, rooms: 0 });
  });

  it("lets in game connections only from its own pages when asked to", async () => {
    const port = await start({ origins: "same-host" });
    expect(await opens(port, `http://localhost:${port}`)).toBe(true);
    expect(await opens(port, "https://someone-else.example")).toBe(false);
    expect(await opens(port)).toBe(false); // no page at all
  });

  it("closes a connection that stops answering pings, and keeps one that answers", async () => {
    const port = await start({ heartbeatMs: 40 });
    const join = (autoPong: boolean) => new Promise<WebSocket>((resolve) => {
      const socket = new WebSocket(`ws://localhost:${port}/?create&tier=small&bots=0`, { autoPong });
      socket.on("open", () => resolve(socket));
    });
    const silent = await join(false);
    const healthy = await join(true);
    const closed = new Promise<boolean>((resolve) => { silent.on("close", () => resolve(true)); setTimeout(() => resolve(false), 1000); });
    expect(await closed).toBe(true);
    expect(healthy.readyState).toBe(WebSocket.OPEN);
    healthy.close();
  });

  it("checks origins against a list, or not at all in development", () => {
    expect(originAllowed("https://rust.example", "x", ["https://rust.example"])).toBe(true);
    expect(originAllowed("https://evil.example", "x", ["https://rust.example"])).toBe(false);
    expect(originAllowed(undefined, "x", null)).toBe(true);
    expect(originAllowed("not a url", "x", "same-host")).toBe(false);
  });
});
