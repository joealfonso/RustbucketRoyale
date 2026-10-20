import waterJson from "../../../data/water.json";

// The look of the water (M11 11b), from data/water.json: the toon surface over the flooded low ground (waterMesh.ts)
// and the splashes kicked up in it (splashes.ts). Colours are hex or palette names.

export interface SplashLook {
  ringMeters: number; // how wide the ripple ring grows
  ringSeconds: number;
  drops: number; // blobs of spray thrown up
  dropMeters: number;
  dropSpeed: [number, number]; // metres a second up, from the first to the second
  spread: number; // how far out the spray leans, as a share of its upward speed
  dropSeconds: number;
  // Its sound: "wade" for a footstep (scaling the step's own loudness and pitch), "splash" for the others.
  sound: { loudness: number; pitch: number };
}

export interface WaterLook {
  // Flat bands by depth: a light band within `shore.belowMeters` of the shoreline, the main colour, and a darker
  // band once it is deeper than `deep.aboveMeters`. The band edges waver by up to `ragged.meters` of depth, so they
  // look painted, not traced. A few long light streaks drift slowly across the main colour.
  surface: {
    main: string;
    shore: { color: string; belowMeters: number };
    deep: { color: string; aboveMeters: number };
    opacity: number;
    ragged: { scale: number; meters: number };
    streaks: { color: string; scale: number; stretch: number; angleDegrees: number; above: number; driftMetersPerSecond: number };
  };
  splashes: { wade: SplashLook; landing: SplashLook; shot: SplashLook; gravity: number; lift: number };
}

export function parseWaterLook(raw: unknown): WaterLook {
  const w = raw as WaterLook;
  const s = w?.surface;
  if (!s?.shore || !s.deep || !s.ragged || !s.streaks || !w.splashes) throw new Error("water.json: needs surface (shore, deep, ragged, streaks) and splashes");
  if (!(s.shore.belowMeters > 0 && s.shore.belowMeters < s.deep.aboveMeters)) throw new Error("water.json: shore belowMeters must be above 0 and under deep aboveMeters");
  if (!(s.opacity > 0 && s.opacity <= 1)) throw new Error("water.json: opacity must be above 0, up to 1");
  if (!(s.streaks.stretch >= 1)) throw new Error("water.json: streaks stretch must be 1 or more");
  for (const name of ["wade", "landing", "shot"] as const) {
    const k = w.splashes[name];
    if (!k || !(k.ringMeters > 0 && k.ringSeconds > 0 && k.dropSeconds > 0 && k.drops >= 0 && Number.isInteger(k.drops))) throw new Error(`water.json: splashes.${name} needs ringMeters, ringSeconds, dropSeconds above 0 and a whole number of drops`);
    if (!(k.dropSpeed?.length === 2 && k.dropSpeed[0] <= k.dropSpeed[1])) throw new Error(`water.json: splashes.${name}.dropSpeed must be [low, high]`);
    if (!(k.sound?.loudness >= 0 && k.sound.pitch > 0)) throw new Error(`water.json: splashes.${name}.sound needs loudness 0 or more and pitch above 0`);
  }
  return w;
}

export const waterLook = parseWaterLook(waterJson);
