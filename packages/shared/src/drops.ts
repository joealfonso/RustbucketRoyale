// Supply drops (gate 13a): a burning crate of the best loot falls inside the ring a couple of times a match, so
// everyone has a reason to meet. The server plans each drop when the match starts and sends the list with the ring,
// so every client knows the whole timeline from the match clock alone: announced, falling, landed, open.

export interface DropsConfig {
  landSeconds: Record<string, number[]>; // per tier, when each drop lands, in seconds of match time
  announceSeconds: number; // the radar and HUD show where it will land this long before it does
  fallSeconds: number; // the last part of that, the crate in the sky
  fallHeight: number;
  openSeconds: number; // it lies sealed this long after landing, then bursts open
  impact: { damage: number; radius: number }; // what landing on something does, like a blast
  placeShareOfRing: number; // lands this share of the ring's radius from its centre, at most
  clearMeters: number; // and on open ground at least this far from anything standing
  contents: string[]; // "upgrade", "weapon" (any but the one everyone starts with), "armor" or "grenade"
  spillMeters: number;
  botPullMeters: number; // bots this near go for it
  crate: { size: number[]; paint: string; trim: string; model: string | null }; // art hook: `model` for a real crate
  smoke: { everySeconds: number; lingerSeconds: number; fireEverySeconds: number };
  beacon: { width: number; height: number; opacity: number }; // the column of light over the landing spot
}

export interface SupplyDrop {
  x: number;
  y: number; // the ground it lands on
  z: number;
  landAt: number; // seconds of match time
}

export type DropPhase = "none" | "announced" | "falling" | "landed" | "open";

const CONTENTS = ["upgrade", "weapon", "armor", "grenade"];

export function parseDropsConfig(raw: unknown): DropsConfig {
  const d = raw as DropsConfig;
  for (const key of ["announceSeconds", "fallSeconds", "fallHeight", "openSeconds", "placeShareOfRing", "clearMeters", "spillMeters", "botPullMeters"] as const) {
    if (typeof d?.[key] !== "number" || !(d[key] >= 0)) throw new Error(`drops.json: ${key} must be a number, 0 or more`);
  }
  if (d.fallSeconds <= 0 || d.fallSeconds > d.announceSeconds) throw new Error("drops.json: fallSeconds must be above 0 and no longer than announceSeconds");
  if (!(d.placeShareOfRing <= 1)) throw new Error("drops.json: placeShareOfRing is a share, 0 to 1");
  if (!(d.impact?.damage >= 0 && d.impact.radius > 0)) throw new Error("drops.json: impact needs damage and a radius above 0");
  if (!d.landSeconds || typeof d.landSeconds !== "object") throw new Error("drops.json: needs landSeconds per tier");
  for (const [tier, times] of Object.entries(d.landSeconds)) {
    if (!Array.isArray(times) || times.some((t, i) => !(t > d.announceSeconds) || (i > 0 && t <= times[i - 1]!))) {
      throw new Error(`drops.json: ${tier} land times must rise, each after announceSeconds`);
    }
  }
  if (!Array.isArray(d.contents) || d.contents.length === 0 || d.contents.some((c) => !CONTENTS.includes(c))) {
    throw new Error(`drops.json: contents is a list of ${CONTENTS.join(", ")}`);
  }
  if (!Array.isArray(d.crate?.size) || d.crate.size.length !== 3) throw new Error("drops.json: crate needs a size");
  if (!(d.beacon?.width > 0 && d.beacon.height > 0 && d.beacon.opacity > 0 && d.beacon.opacity <= 1)) throw new Error("drops.json: beacon needs width, height and opacity 0 to 1");
  if (!(d.smoke?.everySeconds > 0 && d.smoke.lingerSeconds >= 0 && d.smoke.fireEverySeconds > 0)) throw new Error("drops.json: smoke needs everySeconds, lingerSeconds and fireEverySeconds");
  return d;
}

export function dropPhase(drop: SupplyDrop, config: DropsConfig, time: number): DropPhase {
  const until = drop.landAt - time;
  if (until > config.announceSeconds) return "none";
  if (until > config.fallSeconds) return "announced";
  if (until > 0) return "falling";
  return time < drop.landAt + config.openSeconds ? "landed" : "open";
}

// How high the crate's bottom is above its landing spot while it falls: slow at first and fast at the end, so it
// arrives with a slam. 0 once landed.
export function dropHeight(drop: SupplyDrop, config: DropsConfig, time: number): number {
  const until = drop.landAt - time;
  if (until <= 0) return 0;
  const left = Math.min(1, until / config.fallSeconds); // 1 at the top of the fall, 0 on the ground
  const p = 1 - left;
  return config.fallHeight * (1 - p * p);
}
