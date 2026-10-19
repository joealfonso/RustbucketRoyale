// How many rooms one real server process holds, with real WebSocket clients: the server runs as its own process,
// and this script connects two players per room who walk, turn and shoot at 60 inputs a second, while bots fill
// the rest. Rooms are added in steps, and after each step the server's own tick timings are read back.
// Unlike scripts/measure-rooms.ts this includes packing and sending every message.
// Run: npx tsx scripts/load-test.ts [tier, default medium] [room counts, default 5,10,20,40]
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { STEP, createMechInput, encodeInput, type InputMessage } from "../packages/shared/src";

const tier = process.argv[2] ?? "medium";
const steps = (process.argv[3] ?? "5,10,20,40").split(",").map(Number);
const PORT = 8091;
const SETTLE_SECONDS = 20;
const BUDGET_MS = 8; // half the 16.7 ms tick, the same budget as the soak test

const server = spawn("npx", ["tsx", "packages/server/src/main.ts"], {
  env: { ...process.env, PORT: String(PORT), LOAD_STATS: "1", MAX_ROOMS: "500", TIER: tier },
  stdio: ["ignore", "pipe", "inherit"],
});
let latest: { rooms: number; meanMs: number; p99Ms: number; lateP99Ms: number; lateMaxMs: number } | null = null;
let worstLate = 0; // the longest any tick started late since the last row, including while rooms were made and started
let ready: () => void;
const listening = new Promise<void>((resolve) => { ready = resolve; });
server.stdout.on("data", (chunk: Buffer) => {
  for (const line of chunk.toString().split("\n")) {
    if (line.includes("listening")) ready();
    if (line.startsWith("LOAD ")) {
      latest = JSON.parse(line.slice(5));
      worstLate = Math.max(worstLate, latest!.lateMaxMs);
    }
  }
});

let bytesIn = 0;
const clients: WebSocket[] = [];

// One player: joins (making the room when `code` is null), then sends a packed input every tick.
function player(code: string | null, seed: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${PORT}/?${code ? `room=${code}` : "create"}&tier=${tier}`);
    socket.binaryType = "arraybuffer";
    clients.push(socket);
    const message: InputMessage = { t: "input", seq: 0, ...createMechInput() };
    let yaw = seed;
    socket.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
      bytesIn += isBinary ? (data as ArrayBuffer).byteLength : data.toString().length;
      if (isBinary) return;
      const m = JSON.parse(data.toString());
      if (m.t === "welcome") {
        if (code === null) socket.send(JSON.stringify({ t: "start" }));
        resolve(m.code);
        setInterval(() => {
          message.seq++;
          if (message.seq % 120 === 0) yaw += 1.3;
          Object.assign(message, { moveY: 1, run: message.seq % 300 < 60, aimYaw: Math.fround(yaw), fire: message.seq % 90 < 20, targetX: 0, targetY: 2, targetZ: 0, lagMs: 60 });
          if (socket.readyState === socket.OPEN) socket.send(encodeInput(message, message.fire));
        }, STEP * 1000);
      }
      if (m.t === "refused") reject(new Error(m.reason));
    });
    socket.on("error", reject);
  });
}

await listening;
console.log(`| Tier | Rooms | People | Mean ms per tick (all rooms) | 99th percentile ms | 99th percentile late start ms | Worst late start ms (whole step) | kbps per person | Fits ${BUDGET_MS} ms |\n| :- | :- | :- | :- | :- | :- | :- | :- | :- |`);
let rooms = 0;
for (const target of steps) {
  for (; rooms < target; rooms++) {
    const code = await player(null, rooms);
    await player(code, rooms + 0.5);
  }
  await new Promise((r) => setTimeout(r, SETTLE_SECONDS * 1000 - 5000));
  bytesIn = 0;
  await new Promise((r) => setTimeout(r, 5500));
  const s = latest!;
  const kbps = (bytesIn * 8) / 5.5 / 1000 / clients.length;
  console.log(`| ${tier} | ${s.rooms} | ${clients.length} | ${s.meanMs.toFixed(2)} | ${s.p99Ms.toFixed(2)} | ${s.lateP99Ms.toFixed(2)} | ${worstLate.toFixed(0)} | ${kbps.toFixed(0)} | ${s.p99Ms <= BUDGET_MS ? "yes" : "no"} |`);
  worstLate = 0;
  if (s.p99Ms > BUDGET_MS * 2) break; // well past the budget, no point going further
}

for (const c of clients) c.terminate();
server.kill();
process.exit(0);
