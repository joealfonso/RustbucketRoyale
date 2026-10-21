// The look of every shot (data/weaponFx.json): muzzle flash, tracer and impact, per weapon, plus the shared pools.
// Plain data and small pure helpers only, so the rules can be tested without a renderer.

export type Bands = [string, string, string]; // light, mid, dark: palette names or hex

export interface FlashFrame {
  size: number; // star width in metres
  spin: number; // degrees the star is turned on this frame, so a stutter reads as flicker
  plume: number; // metres the flame reaches out along the barrel
  width: number; // plume width in metres
}

export interface WeaponFx {
  flash: {
    pool: number; points: number; inner: number; aspect: number; coreScale: number; core: string;
    frameSeconds: number; frames: FlashFrame[];
  };
  tracer: { pool: number; length: number; width: number; core: string; coreShare: number };
  impact: {
    sparks: [number, number]; sparkSpeed: number; spread: number;
    grit: number; gritScale: number; mechSparks: number; mechFlashScale: number;
  };
}

// The look of a weapon's right-click fire (gate 18a): its own flash, tracer and impact, plus what its kind needs.
// `glow` is the barrel heating as the windup spins (stepped by windup) or the spike charging (stepped by charge);
// `vent` the smoke puffing out of an overheated barrel; `pin` the sparks and clamp ring round a pinned mech's feet.
export interface Glow { pool: "fire" | "sparks"; steps: number; sizes: [number, number]; flickerFps: number; forwardMeters: number; fullFlashScale: number }
export interface Vent { everySeconds: number; size: [number, number]; lifeSeconds: number; rise: number }
export interface Pin { everySeconds: number; sparks: number; sparkSpeed: number; ringMeters: number; ringSeconds: number }
export interface AltFx extends WeaponFx {
  name: string; // shown in the HUD next to the weapon slot, and in the right-click tip
  glow?: Glow;
  vent?: Vent;
  pin?: Pin;
}

// The rivet gun's rivets (gate 18b): drawn stuck where they hit, a fuse light blinking faster in steps until they pop.
// `head` is the rivet's colour; `fuse` the blink (its glow grows from sizes[0] to sizes[1] over the fuse, blinking
// from slowHz to fastHz); `rippleSeconds` the gap between pops when you detonate them all; `popShake` the camera shake
// a pop gives within `popShakeRadius`. The pop's size is weapons.json's blastRadius.
export interface RivetLook {
  pool: number; headMeters: number; shankMeters: number; head: string;
  fuse: { steps: number; slowHz: number; fastHz: number; sizes: [number, number] };
  rippleSeconds: number; popShakeRadius: number; popShake: number;
}

// The magnet harpoon (gate 18b): the head and its cable, flying out, latching, pulling, and winding back in.
// `cable` is a thin inked line from the muzzle to the head; `tug` the sparks spitting off the latch while it pulls;
// `yankShake` the jerk on your camera when you are the one yanked; `holdSeconds` how long the cable stays taut when
// the server does not say; `reelLines` the speed lines rushing past while you reel in.
export interface HarpoonLook {
  pool: number; speed: number; retractSpeed: number; holdSeconds: number; missSeconds: number;
  head: { lengthMeters: number; widthMeters: number; core: string };
  cable: { widthMeters: number; color: string; core: string; coreShare: number };
  tug: { everySeconds: number; sparks: number; sparkSpeed: number };
  yankShake: number; reelShake: number;
  reelLines: { count: number; radiusMeters: number; clearRadiusMeters: number; lengthMeters: number; widthMeters: number; fromSpeed: number; fullSpeed: number };
}

export type WeaponLook = WeaponFx & { alt: AltFx; rivet?: RivetLook; harpoon?: HarpoonLook };

export interface WeaponFxConfig {
  lowShare: number; // share of every pool kept on the low effects setting
  sparks: { pool: number; world: Bands; mech: Bands; lifeSeconds: number; size: number; aspect: number; streakSeconds: number; gravity: number; drag: number; lift: number };
  grit: { pool: number; lifeSeconds: number; startSize: number; endSize: number; rise: number; families: { like: string; colors: Bands }[] };
  mechFlash: { pool: number; points: number; inner: number; coreScale: number; colors: [string, string]; frameSeconds: number; sizes: number[] };
  weapons: Record<string, WeaponLook>;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function numbers(obj: unknown, keys: string[], where: string): void {
  const o = obj as Record<string, unknown> | undefined;
  for (const k of keys) if (!isNumber(o?.[k])) throw new Error(`weaponFx.json: ${where}.${k} must be a number, 0 or more`);
}

function bands(v: unknown, count: number, where: string): void {
  if (!Array.isArray(v) || v.length !== count || v.some((c) => typeof c !== "string")) throw new Error(`weaponFx.json: ${where} needs ${count} colours`);
}

// Fails loudly on a bad data file, same as the other tuning files.
export function parseWeaponFx(raw: unknown): WeaponFxConfig {
  const d = raw as WeaponFxConfig;
  if (!isNumber(d?.lowShare) || d.lowShare > 1) throw new Error("weaponFx.json: lowShare must be between 0 and 1");
  numbers(d.sparks, ["pool", "lifeSeconds", "size", "aspect", "streakSeconds", "gravity", "drag", "lift"], "sparks");
  bands(d.sparks.world, 3, "sparks.world");
  bands(d.sparks.mech, 3, "sparks.mech");
  numbers(d.grit, ["pool", "lifeSeconds", "startSize", "endSize", "rise"], "grit");
  if (!Array.isArray(d.grit.families) || d.grit.families.length === 0) throw new Error("weaponFx.json: grit.families needs at least one family");
  d.grit.families.forEach((f, i) => { bands(f.colors, 3, `grit.families[${i}].colors`); if (typeof f.like !== "string") throw new Error(`weaponFx.json: grit.families[${i}].like must be a colour`); });
  numbers(d.mechFlash, ["pool", "points", "inner", "coreScale", "frameSeconds"], "mechFlash");
  bands(d.mechFlash.colors, 2, "mechFlash.colors");
  if (!Array.isArray(d.mechFlash.sizes) || d.mechFlash.sizes.length === 0 || !d.mechFlash.sizes.every(isNumber)) throw new Error("weaponFx.json: mechFlash.sizes needs at least one size");
  for (const [id, w] of Object.entries(d.weapons ?? {})) {
    checkLook(w, `weapons.${id}`);
    const alt = w.alt;
    if (!alt) throw new Error(`weaponFx.json: weapons.${id}.alt is missing: every weapon has a right-click fire`);
    if (typeof alt.name !== "string" || alt.name.length === 0) throw new Error(`weaponFx.json: weapons.${id}.alt.name must be a name`);
    checkLook(alt, `weapons.${id}.alt`);
    if (alt.glow) {
      numbers(alt.glow, ["steps", "flickerFps", "fullFlashScale"], `weapons.${id}.alt.glow`);
      // Negative sits the glow back along the barrel rather than out in front of it.
      if (!Number.isFinite(alt.glow.forwardMeters)) throw new Error(`weaponFx.json: weapons.${id}.alt.glow.forwardMeters must be a number`);
      if (alt.glow.pool !== "fire" && alt.glow.pool !== "sparks") throw new Error(`weaponFx.json: weapons.${id}.alt.glow.pool must be fire or sparks`);
      pair(alt.glow.sizes, `weapons.${id}.alt.glow.sizes`);
    }
    if (alt.vent) { numbers(alt.vent, ["everySeconds", "lifeSeconds", "rise"], `weapons.${id}.alt.vent`); pair(alt.vent.size, `weapons.${id}.alt.vent.size`); }
    if (alt.pin) numbers(alt.pin, ["everySeconds", "sparks", "sparkSpeed", "ringMeters", "ringSeconds"], `weapons.${id}.alt.pin`);
    if (w.rivet) checkRivet(w.rivet, `weapons.${id}.rivet`);
    if (w.harpoon) checkHarpoon(w.harpoon, `weapons.${id}.harpoon`);
  }
  return d;
}

function checkRivet(r: RivetLook, where: string): void {
  numbers(r, ["pool", "headMeters", "shankMeters", "rippleSeconds", "popShakeRadius", "popShake"], where);
  if (typeof r.head !== "string") throw new Error(`weaponFx.json: ${where}.head must be a colour`);
  numbers(r.fuse, ["steps", "slowHz", "fastHz"], `${where}.fuse`);
  if (r.fuse.steps < 1) throw new Error(`weaponFx.json: ${where}.fuse.steps must be 1 or more`);
  pair(r.fuse.sizes, `${where}.fuse.sizes`);
}

function checkHarpoon(h: HarpoonLook, where: string): void {
  numbers(h, ["pool", "speed", "retractSpeed", "holdSeconds", "missSeconds", "yankShake", "reelShake"], where);
  numbers(h.head, ["lengthMeters", "widthMeters"], `${where}.head`);
  numbers(h.cable, ["widthMeters", "coreShare"], `${where}.cable`);
  for (const [part, key] of [[h.head, "core"], [h.cable, "color"], [h.cable, "core"]] as const) {
    if (typeof (part as Record<string, unknown>)[key] !== "string") throw new Error(`weaponFx.json: ${where} needs colours for its head and cable`);
  }
  numbers(h.tug, ["everySeconds", "sparks", "sparkSpeed"], `${where}.tug`);
  numbers(h.reelLines, ["count", "radiusMeters", "clearRadiusMeters", "lengthMeters", "widthMeters", "fromSpeed", "fullSpeed"], `${where}.reelLines`);
}

// Which step of a rivet's fuse it is in `age` seconds into a `fuse` (0 to steps - 1), or -1 while the light is
// blinked off. It blinks faster each step, so a rivet about to pop reads as urgent from across a fight.
export function fuseBlink(age: number, fuse: number, steps: number, slowHz: number, fastHz: number): number {
  if (fuse <= 0) return steps - 1;
  const step = Math.max(0, Math.min(steps - 1, Math.floor((age / fuse) * steps)));
  const hz = steps > 1 ? slowHz + ((fastHz - slowHz) * step) / (steps - 1) : slowHz;
  return Math.floor(Math.max(0, age) * hz * 2) % 2 === 0 ? step : -1;
}

function pair(v: unknown, where: string): void {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isNumber)) throw new Error(`weaponFx.json: ${where} must be [start, end]`);
}

// One flash, tracer and impact. `where` names it in the error, e.g. weapons.autocannon or weapons.autocannon.alt.
function checkLook(w: WeaponFx, where: string): void {
  numbers(w.flash, ["pool", "points", "inner", "aspect", "coreScale", "frameSeconds"], `${where}.flash`);
  if (w.flash.points < 2) throw new Error(`weaponFx.json: ${where}.flash.points must be 2 or more`);
  if (!Array.isArray(w.flash.frames) || w.flash.frames.length === 0) throw new Error(`weaponFx.json: ${where}.flash.frames needs at least one frame`);
  w.flash.frames.forEach((f, i) => numbers(f, ["size", "spin", "plume", "width"], `${where}.flash.frames[${i}]`));
  numbers(w.tracer, ["pool", "length", "width", "coreShare"], `${where}.tracer`);
  numbers(w.impact, ["sparkSpeed", "spread", "grit", "gritScale", "mechSparks", "mechFlashScale"], `${where}.impact`);
  const [lo, hi] = w.impact.sparks ?? [];
  if (!isNumber(lo) || !isNumber(hi) || hi < lo) throw new Error(`weaponFx.json: ${where}.impact.sparks must be [fewest, most]`);
}

// The look of each weapon, in the order of weapons.json. Every weapon must have one, so a new gun cannot ship
// without its effects.
export function weaponFxFor(config: WeaponFxConfig, weapons: readonly { id: string }[]): WeaponLook[] {
  return weapons.map((w) => {
    const fx = config.weapons[w.id];
    if (!fx) throw new Error(`weaponFx.json: no effects for weapon ${w.id}`);
    return fx;
  });
}

// Whether a right-click shot is drawn in its weapon's alt look. A spike charged only part way is still the plain
// spike; only a full charge (share 1, the one that pierces and pins) gets the fat tracer. `share` is -1 for a primary.
export function usesAltLook(kind: string, share: number): boolean {
  return share >= 0 && (kind !== "charge" || share >= 1);
}

// How many of a pool are in use on an effects setting. Pools are made at the full size, so switching never allocates.
export function capFor(pool: number, quality: string, lowShare: number): number {
  return quality === "low" ? Math.max(1, Math.round(pool * lowShare)) : pool;
}

// The frame a flash shows `age` seconds in, or -1 once it has played. Frames swap whole, never fade, like a drawn flipbook.
export function flashFrame(age: number, frameSeconds: number, frames: number): number {
  if (age < 0) return 0;
  const frame = frameSeconds > 0 ? Math.floor(age / frameSeconds) : frames;
  return frame < frames ? frame : -1;
}

// A spark's velocity off a surface: the surface normal pushed round by `spread` in a random direction, kicked up
// by `lift` so sparks arc before gravity takes them. r1..r3 are random numbers in [0, 1).
export function sparkVelocity(
  nx: number, ny: number, nz: number, speed: number, spread: number, lift: number,
  r1: number, r2: number, r3: number, out: { x: number; y: number; z: number },
): void {
  // An even random direction on the sphere.
  const y = r1 * 2 - 1, a = r2 * Math.PI * 2, s = Math.sqrt(1 - y * y);
  let x = nx + Math.cos(a) * s * spread, yy = ny + y * spread + lift, z = nz + Math.sin(a) * s * spread;
  const length = Math.hypot(x, yy, z) || 1;
  const fast = speed * (0.6 + 0.4 * r3); // some sparks lag, so the burst has a ragged edge
  x /= length; yy /= length; z /= length;
  out.x = x * fast; out.y = yy * fast; out.z = z * fast;
}

// Which family of grit colours a surface kicks up: the one whose colour is nearest the surface's own.
export function nearestFamily(hex: string, likes: readonly string[]): number {
  const rgb = (h: string) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const; };
  const [r, g, b] = rgb(hex);
  let best = 0, bestDistance = Infinity;
  likes.forEach((like, i) => {
    const [lr, lg, lb] = rgb(like);
    const distance = (r - lr) ** 2 + (g - lg) ** 2 + (b - lb) ** 2;
    if (distance < bestDistance) { best = i; bestDistance = distance; }
  });
  return best;
}
