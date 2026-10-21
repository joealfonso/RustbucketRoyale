// Recoil (gate V9b): a gun snaps back along its barrel and tips up when it fires, then a short spring settles it,
// and heavy weapons shove the torso too. Looks only; the shot itself is unchanged. The numbers live in
// data/recoil.json under `recoil`, one kick per weapon id (and `railShot` for the Longshot's Rail Shot).

export interface Kick {
  backMeters: number; // how far the gun snaps back along its barrel, per shot
  climbDegrees: number; // how far its muzzle tips up, per shot
  hz: number; damping: number; // the spring that settles it: how fast it swings, and how quickly the swing dies (1 = no overshoot)
  cap: number; // most shots' worth of kick it can hold at once, so a fast gun rattles instead of crawling back up the arm
  torsoMeters: number; torsoHz: number; // the shove the torso takes, 0 for none
}

export interface RecoilConfig {
  sideMeters: number; // gun shapes nearer the middle than this kick with every shot; the rest with their own side's muzzle
  guns: Record<string, string[]>; // per kit, the parts that kick; a kit not listed kicks its weapon-painted parts
  kicks: Record<string, Kick>;
  fallback: string; // the kick for a weapon with none of its own
}

export function parseRecoil(raw: unknown): RecoilConfig {
  const d = raw as RecoilConfig;
  const fail = (what: string) => { throw new Error(`recoil.json: recoil.${what}`); };
  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!positive(d?.sideMeters)) fail("sideMeters must be a number, 0 or more");
  for (const [kit, parts] of Object.entries(d.guns ?? {})) {
    if (!Array.isArray(parts) || parts.some((p) => typeof p !== "string")) fail(`guns.${kit} must be a list of part names`);
  }
  if (!d.kicks || Object.keys(d.kicks).length === 0) fail("kicks needs at least one weapon");
  for (const [id, k] of Object.entries(d.kicks)) {
    for (const key of ["backMeters", "climbDegrees", "hz", "damping", "cap", "torsoMeters", "torsoHz"] as const) {
      if (!positive(k?.[key])) fail(`kicks.${id}.${key} must be a number, 0 or more`);
    }
    if (k.hz <= 0 || k.torsoHz <= 0) fail(`kicks.${id}: hz and torsoHz must be above 0`);
    if (k.cap < 1) fail(`kicks.${id}.cap must be 1 or more, or a single shot would not kick fully`);
  }
  if (!d.kicks[d.fallback]) fail(`fallback "${String(d.fallback)}" is not one of the kicks`);
  return d;
}

export function kickFor(config: RecoilConfig, weaponId: string | undefined): Kick {
  return (weaponId !== undefined ? config.kicks[weaponId] : undefined) ?? config.kicks[config.fallback]!;
}

// The kick for a shot: a right-click shot drawn in its alt look (a slug, a full charge) kicks with `<weapon>Alt` when
// recoil.json has one, otherwise with the weapon's own.
export function kickIdFor(config: RecoilConfig, weaponId: string, altLook: boolean): string {
  const id = `${weaponId}Alt`;
  return altLook && config.kicks[id] ? id : weaponId;
}

// One spring, in shots' worth of kick: 1 is one full shot back, 0 at rest.
export interface Spring { x: number; v: number }

export const createSpring = (): Spring => ({ x: 0, v: 0 });

// A shot snaps the spring back at once, up to its cap. Velocity is cleared so each shot reads as its own crisp hit
// rather than adding to the swing of the last.
export function kickSpring(s: Spring, cap: number): void {
  s.x = Math.min(cap, s.x + 1);
  s.v = 0;
}

// Small steps keep a stiff spring stable on a long frame; at 120 a second the autocannon's 11 Hz is well inside.
const MAX_STEP = 1 / 120;
const REST_X = 1e-3, REST_V = 1e-2;

// Moves the spring on by dt. Returns false once it has come to rest (and puts it exactly there). Allocates nothing.
export function stepSpring(s: Spring, hz: number, damping: number, dt: number): boolean {
  const w = 2 * Math.PI * hz;
  let left = dt;
  while (left > 0) {
    const h = Math.min(MAX_STEP, left);
    s.v += (-w * w * s.x - 2 * damping * w * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
  if (Math.abs(s.x) < REST_X && Math.abs(s.v) < REST_V) {
    s.x = 0; s.v = 0;
    return false;
  }
  return true;
}
