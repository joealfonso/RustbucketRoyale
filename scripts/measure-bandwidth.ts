// Measures what one person is sent each second, and how long the server takes per tick, in a room full of bots.
// Run: npx tsx scripts/measure-bandwidth.ts
import { STEP, SnapshotMemory, encodeServerBinary, type ServerMessage } from "../packages/shared/src";
import { loadRoomConfig } from "../packages/server/src/config";
import { Room } from "../packages/server/src/Room";

const config = loadRoomConfig({ maps: "generated" });
console.log("| Tier | Bots | Down kbps (one person) | Snapshot bytes | Mean tick ms | 99th percentile ms | Worst ms |\\n| :- | :- | :- | :- | :- | :- | :- |".replace(/\\n/g, "\n"));

for (const tier of ["small", "medium", "large"]) {
  const room = new Room("MEAS", tier, config, null);
  let snapshotBytes = 0, snapshots = 0, otherBytes = 0;
  const memory = new SnapshotMemory();
  const id = room.join((m: ServerMessage) => {
    const packed = encodeServerBinary(m, memory);
    const size = packed ? packed.length : JSON.stringify(m).length;
    if (m.t === "snapshot") { snapshotBytes += size; snapshots++; } else otherBytes += size;
  })!;
  room.receive(id, JSON.stringify({ t: "start" }));
  for (let i = 0; i < 5 / STEP + 10; i++) room.tick(); // through the countdown

  const seconds = 60;
  const times: number[] = [];
  let sent = 0;
  for (let i = 0; i < seconds / STEP; i++) {
    sent++;
    room.receive(id, JSON.stringify({ t: "input", seq: sent, moveX: 0, moveY: 0, aimYaw: Math.PI, aimPitch: 0, run: false, jet: false, dash: false, fire: false, grenade: false, targetX: 0, targetY: 0, targetZ: 0 }));
    const started = performance.now();
    room.tick();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const bytes = snapshotBytes + otherBytes;
  console.log(`| ${tier} | ${config.bots.fill[tier]! - 1} | ${((bytes * 8) / (seconds + 5) / 1000).toFixed(0)} | ${(snapshotBytes / snapshots).toFixed(0)} | ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3)} | ${times[Math.floor(times.length * 0.99)]!.toFixed(2)} | ${times.at(-1)!.toFixed(1)} |`);
}
