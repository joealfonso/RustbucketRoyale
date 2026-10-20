import { afterEach, describe, expect, it } from "vitest";
import { loadRoomConfig } from "../../server/src/config";
import { Room } from "../../server/src/Room";
import { RoomManager } from "../../server/src/RoomManager";
import { startServer, type RunningServer } from "../../server/src/transport";
import { NetClient, rejoinAddress, type Session } from "./net";

describe("rejoin address", () => {
  it("comes back to the room by its code, whatever the first address asked for", () => {
    expect(rejoinAddress("ws://localhost:8080/?create&tier=small&bots=3", "NTHT")).toBe("ws://localhost:8080/?room=NTHT&rejoin");
    expect(rejoinAddress("wss://rust.example/?room=ab12", "AB12")).toBe("wss://rust.example/?room=AB12&rejoin");
  });
});

describe("a page reloaded mid match", () => {
  let server: RunningServer | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });
  const until = async (done: () => boolean) => { for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => setTimeout(r, 10)); return done(); };

  async function runningMatch() {
    const base = loadRoomConfig();
    const config = { ...base, match: { ...base.match, countdownSeconds: 0.1 } };
    server = await startServer(new RoomManager((code, tier, bots) => new Room(code, tier, config, bots), ["small"], "small", 5), 0, 0);
    const url = (q: string) => `ws://localhost:${server!.port}/?${q}`;
    const host = new NetClient(url("room=RLDA&tier=small&bots=0"));
    let state = "";
    host.onRoom = (r) => { state = r.state; };
    const sessions: Session[] = [];
    await host.welcome; // first in is the room's host, the only one whose start counts
    const guest = new NetClient(url("room=RLDA"));
    guest.onSession = (s) => sessions.push(s);
    await guest.welcome;
    host.sendStart();
    expect(await until(() => state === "active")).toBe(true);
    return { url, host, guest, session: sessions.at(-1)! };
  }

  it("gets the same mech back from the saved session", async () => {
    const { url, guest, session } = await runningMatch();
    (guest as unknown as { stopped: boolean }).stopped = true; // the old page is gone and will not reconnect itself
    (guest as unknown as { socket: WebSocket }).socket.close();
    await new Promise((r) => setTimeout(r, 50));
    const reloaded = new NetClient(url("room=RLDA"), 20, session);
    await reloaded.welcome;
    expect(reloaded.id).toBe(session.id);
  });

  it("joins afresh when the saved session is no good", async () => {
    const { url, session } = await runningMatch();
    const stale = new NetClient(url("room=RLDA"), 20, { ...session, token: "0".repeat(32) });
    await stale.welcome;
    expect(stale.id).not.toBe(session.id);
  });
});
