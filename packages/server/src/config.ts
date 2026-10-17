import { readFileSync } from "node:fs";
import {
  boxFromData, parseCombatStats, parseGrenadeStats, parseMechStats, parseNetStats, parseWeaponStats, parseZones, type BoxData,
} from "@rustbucket/shared";
import type { RoomConfig } from "./Room";

const dataDir = new URL("../../../data/", import.meta.url);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, dataDir), "utf8"));
}

// Same data files the client reads, so both sides always agree on the numbers.
export function loadRoomConfig(): RoomConfig {
  const map = readJson("greybox.json") as { spawn: [number, number, number]; boxes: BoxData[] };
  return {
    mech: parseMechStats(readJson("mech.json")),
    weapon: parseWeaponStats(readJson("weapon.json")),
    grenade: parseGrenadeStats(readJson("grenade.json")),
    combat: parseCombatStats(readJson("combat.json")),
    net: parseNetStats(readJson("net.json")),
    zones: parseZones(readJson("zones.json")),
    boxes: map.boxes.map(boxFromData),
    spawn: map.spawn,
  };
}
