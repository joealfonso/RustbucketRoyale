// How many rooms one server process can run: N rooms at once, each in a match with two people walking about and
// shooting, and the rest filled with bots. Times only the server's work. Run: npx tsx scripts/measure-rooms.ts
import { STEP, createMechInput, encodeInput, type InputMessage } from "../packages/shared/src";
import { loadRoomConfig } from "../packages/server/src/config";
import { Room } from "../packages/server/src/Room";
import { lcg } from "../packages/server/src/testClient";

const config = { ...loadRoomConfig({ maps: "generated" }), random: lcg(99) };
const BUDGET_MS = 8; // half the 16.7 ms tick, leaving room for the network and garbage collection

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
