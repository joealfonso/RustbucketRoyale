import { readFileSync } from "node:fs";
import { parseTiers, type TuningRaws } from "@rustbucket/shared";
import { buildRoomConfig, generatedMaps as generatedFrom, tuningRaws, type ConfigOptions } from "./roomConfig";
import type { MapForRoom, RoomConfig } from "./Room";

export type { ConfigOptions } from "./roomConfig";

const dataDir = new URL("../../../data/", import.meta.url);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, dataDir), "utf8"));
}

// Same data files the client reads, so both sides always agree on the numbers.
export function loadRoomConfig(options: ConfigOptions = {}): RoomConfig {
  return buildRoomConfig(readJson, options);
}

export function generatedMaps(): (tier: string, seed: number) => MapForRoom {
  return generatedFrom(readJson);
}

export function tierNames(): string[] {
  return Object.keys(parseTiers(readJson("tiers.json")).tiers);
}

export function loadTuningRaws(): TuningRaws {
  return tuningRaws(readJson);
}
