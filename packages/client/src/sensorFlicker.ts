// Sensor flicker (gate V9b): a mech's glowing sensors, lenses and energy accents show how hurt their hit zone is.
// Intact they are fully lit. Damaged they flicker the way a failing tube does: lit, then a hard drop to a dim step
// for a blink, sometimes a stutter of several, then lit again, never a smooth pulse. Broken they hold a dull ember,
// and a wreck's are dark. The numbers live in data/recoil.json under `flicker`.

export interface FlickerConfig {
  onSeconds: [number, number]; // how long it stays lit between blinks, shortest and longest
  offSeconds: [number, number]; // how long each dim step lasts
  dimLevels: number[]; // the brightness of a dim step, a share of fully lit; one is picked at random each time
  stutterChance: number; // after a dim step, the chance of another one instead of coming back on
  emberLevel: number; // a broken zone's glow
  darkLevel: number; // a wreck's, or any glow once the torso is gone
}

export const GLOW_INTACT = 0;
export const GLOW_DAMAGED = 1;
export const GLOW_BROKEN = 2;
export const GLOW_DARK = 3;

export function parseFlicker(raw: unknown): FlickerConfig {
  const d = raw as FlickerConfig;
  const fail = (what: string) => { throw new Error(`recoil.json: flicker.${what}`); };
  const share = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  const range = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && n > 0) && v[0] <= v[1];
  if (!range(d?.onSeconds)) fail("onSeconds must be [shortest, longest], above 0");
  if (!range(d.offSeconds)) fail("offSeconds must be [shortest, longest], above 0");
  if (!Array.isArray(d.dimLevels) || d.dimLevels.length === 0 || !d.dimLevels.every(share)) fail("dimLevels must be shares, 0 to 1");
  for (const key of ["stutterChance", "emberLevel", "darkLevel"] as const) if (!share(d[key])) fail(`${key} must be a share, 0 to 1`);
  if (d.stutterChance >= 1) fail("stutterChance must be below 1, or a flicker would never come back on");
  return d;
}

export interface Flicker { level: number; hold: number }

export const createFlicker = (): Flicker => ({ level: 1, hold: 0 });

// The flicker's brightness after dt, a share of fully lit. Each step holds for a while and then jumps: nothing in
// between, so it reads as a hard on and off. A long frame can pass several steps. Allocates nothing.
export function stepFlicker(f: Flicker, dt: number, c: FlickerConfig, random: () => number): number {
  f.hold -= dt;
  while (f.hold <= 0) {
    if (f.level < 1 && random() >= c.stutterChance) {
      f.level = 1;
      f.hold += c.onSeconds[0] + (c.onSeconds[1] - c.onSeconds[0]) * random();
    } else {
      f.level = c.dimLevels[Math.min(c.dimLevels.length - 1, Math.floor(random() * c.dimLevels.length))]!;
      f.hold += c.offSeconds[0] + (c.offSeconds[1] - c.offSeconds[0]) * random();
    }
  }
  return f.level;
}

// A glow's brightness for its state, stepping the flicker on while damaged.
export function glowLevel(state: number, f: Flicker, dt: number, c: FlickerConfig, random: () => number): number {
  if (state === GLOW_INTACT) return 1;
  if (state === GLOW_DAMAGED) return stepFlicker(f, dt, c, random);
  return state === GLOW_BROKEN ? c.emberLevel : c.darkLevel;
}
