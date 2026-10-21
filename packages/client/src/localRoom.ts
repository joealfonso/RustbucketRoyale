// Offline practice: the game server's own Room, run inside this page. The page talks to it through a stand-in for a
// WebSocket that passes the same packed messages both ways, so practice takes the online code path (prediction,
// snapshots, props breaking, loot, rivets and harpoons) on the server's rules, with no copy of any of them here.
// main.ts loads this module only for practice, so online play never downloads the room.
import { SnapshotMemory, encodeServerBinary, parseBotDifficulty, type ServerMessage } from "@rustbucket/shared";
import { Room } from "../../server/src/Room";
import { buildRoomConfig, rangeMaps, tuningRaws } from "../../server/src/roomConfig";
import { startTickLoop } from "../../server/src/tickLoop";
import type { Socket } from "./net";
import abilitiesJson from "../../../data/abilities.json";
import botsJson from "../../../data/bots.json";
import chunksJson from "../../../data/chunks.json";
import combatJson from "../../../data/combat.json";
import dropJson from "../../../data/drop.json";
import dropsJson from "../../../data/drops.json";
import greyboxJson from "../../../data/greybox.json";
import grenadeJson from "../../../data/grenade.json";
import lootJson from "../../../data/loot.json";
import matchJson from "../../../data/match.json";
import mechJson from "../../../data/mech.json";
import mechKitsJson from "../../../data/mechKits.json";
import netJson from "../../../data/net.json";
import noiseJson from "../../../data/noise.json";
import propsJson from "../../../data/props.json";
import ringJson from "../../../data/ring.json";
import rosterJson from "../../../data/roster.json";
import tiersJson from "../../../data/tiers.json";
import titanJson from "../../../data/titan.json";
import upgradesJson from "../../../data/upgrades.json";
import weaponsJson from "../../../data/weapons.json";
import zonesJson from "../../../data/zones.json";

// Every file the server's room config reads, by the name it reads it under.
const DATA: Record<string, unknown> = {
  "abilities.json": abilitiesJson, "bots.json": botsJson, "chunks.json": chunksJson, "combat.json": combatJson, "drop.json": dropJson,
  "drops.json": dropsJson, "greybox.json": greyboxJson, "grenade.json": grenadeJson, "loot.json": lootJson, "match.json": matchJson,
  "mech.json": mechJson, "mechKits.json": mechKitsJson, "net.json": netJson, "noise.json": noiseJson, "props.json": propsJson,
  "ring.json": ringJson, "roster.json": rosterJson, "tiers.json": tiersJson, "titan.json": titanJson, "upgrades.json": upgradesJson,
  "weapons.json": weaponsJson, "zones.json": zonesJson,
};

function readData(name: string): unknown {
  if (!(name in DATA)) throw new Error(`Practice has no ${name}: add it to localRoom.ts`);
  return DATA[name];
}

const RANGE = "range"; // the flat shooting range, a practice-only map (data/greybox.json)
const CODE = "PRACTICE";
const MAX_BOTS = 64; // as the server takes from a link; the room trims it to the spawns the map has

export interface PracticeOptions {
  tier: string;
  seed: number;
  bots: number; // computer players to keep, 0 for none
  difficulty: ReturnType<typeof parseBotDifficulty>;
}

// What the practice address asks for: `?offline&tier=small&seed=5&bots=3&difficulty=hard`. No bots unless asked.
export function practiceOptions(params: URLSearchParams): PracticeOptions {
  return {
    tier: params.get("tier") ?? "medium",
    seed: params.has("seed") ? Number(params.get("seed")) >>> 0 : Math.floor(Math.random() * 0x100000000),
    bots: Math.min(MAX_BOTS, Math.max(0, Math.floor(Number(params.get("bots")) || 0))),
    difficulty: parseBotDifficulty(params.get("difficulty")),
  };
}

// One room, for one person, in this page.
export class LocalRoom {
  readonly room: Room;
  private playerId: number | null = null;
  private stopTicking: (() => void) | null = null;

  constructor(options: PracticeOptions) {
    const config = buildRoomConfig(readData, { roster: true, maps: "generated" });
    const generated = config.mapFor;
    const range = rangeMaps(readData);
    const mapFor = (tier: string, seed: number) => (tier === RANGE ? range() : generated(tier, seed));
    // Practice is the room's lobby, on the map the address asked for: damage, quick respawns, props, loot, no ring.
    // Enter starts a real match on a fresh map, as it does online.
    const lobby = { seed: options.seed, map: mapFor(options.tier, options.seed) };
    // With the raw files the room tunes live, so the F1 panel changes practice the way DEV_TUNING changes a room.
    this.room = new Room(CODE, options.tier, { ...config, mapFor, tuningRaws: tuningRaws(readData) }, options.bots, options.difficulty, lobby);
  }

  // Runs the room on the server's clock until stop().
  start(): void {
    this.stopTicking ??= startTickLoop(() => this.room.tick());
  }

  stop(): void {
    this.stopTicking?.();
    this.stopTicking = null;
  }

  // The connection a NetClient opens: joins the room as a person. The address it asks for does not matter.
  readonly connect = (): Socket => new RoomSocket(this.room, (id) => { this.playerId = id; });

  // The R key: back on your spawn, whole, outside a match (Room.respawn).
  respawn(): void {
    if (this.playerId !== null) this.room.respawn(this.playerId);
  }
}

// Stands in for a WebSocket to the server. Messages to the room go in at once, as the server's transport hands them
// over; messages from it are packed the moment they are sent, in order, exactly as the transport packs them (a
// snapshot is written against the one before it), and arrive a moment later, as they would over a network.
class RoomSocket implements Socket {
  binaryType: BinaryType = "arraybuffer";
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private id: number | null = null;
  private closed = false;
  private memory = new SnapshotMemory();
  private inbox: (string | ArrayBuffer)[] = [];

  constructor(private room: Room, joined: (id: number) => void) {
    // Like a real socket it opens once whoever made it has set its handlers.
    queueMicrotask(() => {
      if (this.closed) return;
      this.onopen?.(new Event("open"));
      this.id = this.room.join((message) => this.deliver(message));
      if (this.id === null) this.close(); // the room said why
      else joined(this.id);
    });
  }

  send(data: string | ArrayBuffer): void {
    if (this.closed || this.id === null) return;
    // False is the room's flood limit, which closes a real connection too.
    if (!this.room.receive(this.id, typeof data === "string" ? data : new Uint8Array(data))) this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.id !== null) this.room.leave(this.id);
    queueMicrotask(() => this.onclose?.(new Event("close") as CloseEvent));
  }

  private deliver(message: ServerMessage): void {
    if (this.closed) return;
    const packed = encodeServerBinary(message, this.memory);
    this.inbox.push(packed ? (packed.slice().buffer as ArrayBuffer) : JSON.stringify(message));
    if (this.inbox.length === 1) queueMicrotask(this.flush);
  }

  private flush = (): void => {
    const arrived = this.inbox;
    this.inbox = [];
    for (const data of arrived) {
      if (this.closed) return;
      this.onmessage?.({ data } as MessageEvent);
    }
  };
}
