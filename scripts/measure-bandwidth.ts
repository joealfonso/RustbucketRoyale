// Measures how many bytes a client is sent each second. Run: npx tsx scripts/measure-bandwidth.ts
import { STEP, createMechInput, type ServerMessage } from "../packages/shared/src";
import { loadRoomConfig } from "../packages/server/src/config";
import { Room } from "../packages/server/src/Room";

for (const [tier, bots] of [["small", 8], ["medium", 24], ["large", 48]] as const) {
  const config = loadRoomConfig({ maps: "generated" });
  const room = new Room("MEAS", tier, config, bots);
  let bytes = 0, snapshots = 0, other = 0;
  room.join((m: ServerMessage) => {
    const size = JSON.stringify(m).length;
    if (m.t === "snapshot") { bytes += size; snapshots++; } else other += size;
  });
  const seconds = 20;
  for (let i = 0; i < seconds / STEP; i++) room.tick();
  void createMechInput;
  console.log(`${tier.padEnd(6)} ${String(bots).padStart(2)} bots: ${(bytes / snapshots).toFixed(0)} bytes per snapshot, ${((bytes * 8) / seconds / 1000).toFixed(0)} kbps down (other messages ${other} bytes)`);
}
