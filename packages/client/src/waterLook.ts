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
  // Flat toon bands, gate V11 "water that reads as water". By depth: a see-through `shallow` band where the muddy
  // bed shows, the `main` colour, and a darker, bluer band once it is deeper than `deep.aboveMeters`. The band edges
  // waver by up to `ragged.meters` of depth, so they look painted, not traced. Long light streaks and short glints
  // drift across it, the far water takes on the sky's hue (each light preset's own sky), and a light foam line runs
  // along the bank with a thin ripple rolling in to it.
  surface: {
    main: string;
    opacity: number;
    shallow: { color: string; belowMeters: number; opacity: number };
    deep: { color: string; aboveMeters: number };
    ragged: { scale: number; meters: number };
    // Streaks: where a noise `scale` across and `stretch` times longer along `angleDegrees` crosses `level`, give or
    // take half of `thickness` (in noise units, so about thickness / scale metres wide), with gaps where the ragged
    // noise is under `gapsBelow`.
    streaks: { color: string; scale: number; stretch: number; angleDegrees: number; level: number; thickness: number; gapsBelow: number; driftMetersPerSecond: number };
    // Short dashes along the streaks, one cell in `share` lit at a time, each growing and shrinking over `seconds`.
    glints: { color: string; cellMeters: number; lengthMeters: number; widthMeters: number; share: number; seconds: number };
    // The water mirrors the sky more the flatter you look at it (the facing is 1 looking straight down, 0 along the
    // surface): each step below `facingBelow` mixes `amount` of the sky's hue, at `lightness`, into the water. The
    // step edges wobble by up to `ripple.facing`, so they read as ripples, not a line drawn round the camera.
    sky: { lightness: number; steps: { facingBelow: number; amount: number }[]; ripple: { scale: number; facing: number; driftMetersPerSecond: number } };
    // Measured in metres of water from the bank, not in depth, so it is the same width on a steep bank and a flat one.
  // The ripple starts `fromMeters` out every `seconds`; `unevenShare` of a beat is how far it lags along the bank.
    foam: { color: string; opacity: number; meters: number; raggedMeters: number; ripple: { fromMeters: number; widthMeters: number; seconds: number; unevenShare: number } };
  };
  splashes: { wade: SplashLook; landing: SplashLook; shot: SplashLook; gravity: number; lift: number };
  // The open sea round an island tier: its water and seabed run `outMeters` past the map's edge, out to the haze.
  sea: { outMeters: number };
}

const share = (n: number) => n >= 0 && n <= 1;

export function parseWaterLook(raw: unknown): WaterLook {
  const w = raw as WaterLook;
  const s = w?.surface;
  if (!s?.shallow || !s.deep || !s.ragged || !s.streaks || !s.glints || !s.sky || !s.foam || !w.splashes) throw new Error("water.json: needs surface (shallow, deep, ragged, streaks, glints, sky, foam) and splashes");
  if (!(s.shallow.belowMeters > 0 && s.shallow.belowMeters < s.deep.aboveMeters)) throw new Error("water.json: shallow belowMeters must be above 0 and under deep aboveMeters");
  if (!(s.opacity > 0 && s.opacity <= 1 && s.shallow.opacity > 0 && s.shallow.opacity <= 1 && s.foam.opacity > 0 && s.foam.opacity <= 1)) throw new Error("water.json: every opacity must be above 0, up to 1");
  if (!(s.streaks.stretch >= 1 && s.streaks.scale > 0 && share(s.streaks.level) && s.streaks.thickness > 0 && share(s.streaks.gapsBelow))) throw new Error("water.json: streaks need stretch 1 or more, scale and thickness above 0, level and gapsBelow 0 to 1");
  const g = s.glints;
  if (!(g.cellMeters > 0 && g.lengthMeters > 0 && g.lengthMeters <= g.cellMeters && g.widthMeters > 0 && share(g.share) && g.seconds > 0)) throw new Error("water.json: glints need sizes above 0, a length no longer than the cell, share 0 to 1, seconds above 0");
  const steps = s.sky.steps;
  if (!(s.sky.lightness >= 0 && Array.isArray(steps) && steps.every((t, k) => share(t.facingBelow) && share(t.amount) && (k === 0 || t.facingBelow < steps[k - 1]!.facingBelow)))) throw new Error("water.json: sky steps need facingBelow and amount from 0 to 1, flattest last");
  if (!(s.sky.ripple?.scale > 0 && s.sky.ripple.facing >= 0)) throw new Error("water.json: sky ripple needs a scale above 0 and facing 0 or more");
  const r = s.foam.ripple;
  if (!(s.foam.meters > 0 && s.foam.raggedMeters >= 0 && r?.fromMeters > 0 && r.widthMeters > 0 && r.seconds > 0 && share(r.unevenShare))) throw new Error("water.json: foam needs meters, ripple fromMeters, widthMeters and seconds above 0, unevenShare 0 to 1");
  if (!(w.sea?.outMeters > 0)) throw new Error("water.json: sea needs outMeters above 0");
  for (const name of ["wade", "landing", "shot"] as const) {
    const k = w.splashes[name];
    if (!k || !(k.ringMeters > 0 && k.ringSeconds > 0 && k.dropSeconds > 0 && k.drops >= 0 && Number.isInteger(k.drops))) throw new Error(`water.json: splashes.${name} needs ringMeters, ringSeconds, dropSeconds above 0 and a whole number of drops`);
    if (!(k.dropSpeed?.length === 2 && k.dropSpeed[0] <= k.dropSpeed[1])) throw new Error(`water.json: splashes.${name}.dropSpeed must be [low, high]`);
    if (!(k.sound?.loudness >= 0 && k.sound.pitch > 0)) throw new Error(`water.json: splashes.${name}.sound needs loudness 0 or more and pitch above 0`);
  }
  return w;
}

export const waterLook = parseWaterLook(waterJson);
