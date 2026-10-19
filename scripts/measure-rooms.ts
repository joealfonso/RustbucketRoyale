// How many rooms one server process can run: N rooms at once, each in a match with two people walking about and
// shooting, and the rest filled with bots. Times only the server's work. Run: npx tsx scripts/measure-rooms.ts
// `npx tsx scripts/measure-rooms.ts starts [tier] [rooms]` instead times match starts (see measureStarts below).
import { STEP, createMechInput, encodeInput, type InputMessage } from "../packages/shared/src";
import { loadRoomConfig } from "../packages/server/src/config";
import { MapPool } from "../packages/server/src/MapPool";
import { Room } from "../packages/server/src/Room";
import { lcg } from "../packages/server/src/testClient";

const config = { ...loadRoomConfig({ maps: "generated" }), random: lcg(99) };
const BUDGET_MS = 8; // half the 16.7 ms tick, leaving room for the network and garbage collection

if (process.argv[2] === "starts") {
  await measureStarts(process.argv[3] ?? "large", Number(process.argv[4] ?? 10));
  process.exit(0);
}

console.log("| Tier | Rooms | Mechs | Mean ms per tick (all rooms) | 99th percentile ms | Fits the budget |\n| :- | :- | :- | :- | :- | :- |");
for (const [tier, counts] of [["medium", [10, 20, 40]], ["large", [5, 10, 20]]] as const) {
  for (const count of counts) {
    const random = lcg(count);
    const people: { room: Room; id: number; seq: number; yaw: number }[] = [];
    const rooms = Array.from({ length: count }, (_, i) => {
      const room = new Room(`R${i}`, tier, config, null);
      for (let p = 0; p < 2; p++) people.push({ room, id: room.join(() => {})!, seq: 0, yaw: random() * Math.PI * 2 });
      room.receive(people.at(-2)!.id, JSON.stringify({ t: "start" }));
      return room;
    });
    for (let i = 0; i < 6 / STEP; i++) for (const r of rooms) r.tick(); // through the countdown

    const message: InputMessage = { t: "input", seq: 0, ...createMechInput() };
    const times: number[] = [];
    for (let tick = 0; tick < 30 / STEP; tick++) {
      for (const p of people) {
        if (tick % 120 === 0) p.yaw = random() * Math.PI * 2;
        p.seq++;
        Object.assign(message, { seq: p.seq, moveY: 1, run: tick % 300 < 60, aimYaw: Math.fround(p.yaw), fire: tick % 90 < 20, targetX: 0, targetY: 2, targetZ: 0, lagMs: 60 });
        p.room.receive(p.id, encodeInput(message, message.fire));
      }
      const started = performance.now();
      for (const r of rooms) r.tick();
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p99 = times[Math.floor(times.length * 0.99)]!;
    const mechs = rooms.reduce((sum, r) => sum + r.inspect().length, 0);
    console.log(`| ${tier} | ${count} | ${mechs} | ${mean.toFixed(2)} | ${p99.toFixed(2)} | ${p99 < BUDGET_MS ? "yes" : "no"} |`);
  }
}

// The worst stall around match starts. Rooms tick in real time, as on the server, and the hosts press start one
// room every half second. A frame's work is the starts handled in it plus one tick of every room; "late" is how
// long after its time a frame began, which also catches work done between frames (a map arriving from a worker).
// MAP_WORKERS=0 builds maps on the main thread, the way the server did before the map workers.
async function measureStarts(tier: string, count: number): Promise<void> {
  const workers = Number(process.env.MAP_WORKERS ?? 2);
  const pool = workers > 0 ? new MapPool(workers) : null;
  const startsConfig = pool ? { ...config, mapLater: (t: string, seed: number) => pool.generate(t, seed) } : config;
  const rooms = Array.from({ length: count }, (_, i) => new Room(`S${i}`, tier, startsConfig, null));
  const hosts = rooms.map((room) => room.join(() => {})!);
  const frame = STEP * 1000;
  const work: number[] = [], late: number[] = [];
  const pressed = new Array<number>(count).fill(-1), counting = new Array<number>(count).fill(-1);
  const frames = Math.ceil((1 + count * 0.5 + 6) / STEP);
  let next = performance.now();
  for (let f = 0; f < frames; f++) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, next - performance.now())));
    const began = performance.now();
    late.push(Math.max(0, began - next));
    for (let i = 0; i < count; i++) {
      if (pressed[i] !== -1 || f * STEP < 1 + i * 0.5) continue;
      pressed[i] = f;
      rooms[i]!.receive(hosts[i]!, JSON.stringify({ t: "start" }));
    }
    for (const r of rooms) r.tick();
    rooms.forEach((r, k) => { if (counting[k] === -1 && r.matchState === "countdown") counting[k] = f; });
    work.push(performance.now() - began);
    next += frame;
  }
  await pool?.close();
  const worst = (v: number[]) => Math.max(...v);
  const p99 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.99)]!;
  const holds = counting.map((c, k) => (c - pressed[k]!) * frame);
  console.log(`| Tier | Rooms | Map workers | Worst frame work ms | 99th percentile work ms | Worst late start ms | Longest wait for a map ms |\n| :- | :- | :- | :- | :- | :- | :- |`);
  console.log(`| ${tier} | ${count} | ${workers} | ${worst(work).toFixed(1)} | ${p99(work).toFixed(2)} | ${worst(late).toFixed(1)} | ${worst(holds).toFixed(0)} |`);
}
