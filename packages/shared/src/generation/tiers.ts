import { parseTerrainSettings, type TerrainSettings } from "../terrain";

export interface TierDef {
  meters: number;
  spawns: number;
  spawnSeparationChunks: number;
}

export interface TierSet {
  edgeWallHeight: number;
  edgeWallThickness: number;
  maxAttempts: number;
  minConnectedFraction: number;
  navCellMeters: number;
  groundColor: string;
  tiers: Record<string, TierDef>;
  terrain?: TerrainSettings; // the hills (terrain.ts); without it every map is flat
}

export function parseTiers(raw: unknown): TierSet {
  const d = raw as Record<string, unknown>;
  for (const key of ["edgeWallHeight", "edgeWallThickness", "maxAttempts", "minConnectedFraction", "navCellMeters"]) {
    if (typeof d?.[key] !== "number" || !Number.isFinite(d[key])) throw new Error(`tiers.json: ${key} must be a number`);
  }
  if (typeof d.groundColor !== "string") throw new Error("tiers.json: groundColor must be text");
  const tiers = d.tiers as Record<string, Record<string, unknown>> | undefined;
  if (!tiers || typeof tiers !== "object") throw new Error("tiers.json: needs tiers");
  for (const [name, t] of Object.entries(tiers)) {
    for (const key of ["meters", "spawns", "spawnSeparationChunks"]) {
      if (typeof t[key] !== "number" || !Number.isInteger(t[key]) || (t[key] as number) <= 0) throw new Error(`tiers.json: ${name}.${key} must be a whole number above 0`);
    }
  }
  if (d.terrain !== undefined) parseTerrainSettings(d.terrain);
  return d as unknown as TierSet;
}
