import { parsePresetHaze, type PresetHaze } from "./haze";

// The light of a match (data/look.json, `light`): a few named presets, each a whole mood (key and fill light, sky,
// clouds, haze). The map seed picks one, so everyone in a room sees the same sky, and ?look=<name> forces one offline.

export interface LightPreset {
  name: string;
  // The sun. `direction` points toward it; `shadow` is how strongly what it casts darkens, 0 (none) to 1 (down to
  // the darkest band), so a hazy sky can keep faint shadows.
  key: { color: string; intensity: number; direction: [number, number, number]; shadow: number };
  // The ambient light: `fillSky` from above (it also tints the shadow band, toonLight.ts) and `fillGround`, the warm
  // light bounced up off the ground onto undersides.
  fillSky: string;
  fillGround: string;
  fillIntensity: number;
  // Shadow colour, not darkness: how far the shadow band's and the middle band's light turn from the sun's colour
  // toward the sky's hue (fillSky), 0 to 1 (toonLight.ts).
  shade: { shadow: number; mid: number };
  // The sky steps from the haze colour at the horizon up to `zenith` (sky.ts), so far ground melts into the sky with
  // no seam.
  sky: { zenith: string; sun: string };
  clouds: { lit: string; shade: string };
  // Haze starts at `near` metres and is all but solid (98%) at ground level by `far`, in tinted steps (haze.ts).
  haze: PresetHaze;
}

export interface LightConfig {
  presets: LightPreset[];
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function parseLight(raw: unknown): LightConfig {
  const presets = (raw as LightConfig | undefined)?.presets;
  if (!Array.isArray(presets) || presets.length === 0) throw new Error("look.json: light needs at least one preset");
  const names = new Set<string>();
  for (const p of presets) {
    const where = `look.json: light preset ${p?.name ?? "(no name)"}`;
    if (!isText(p?.name)) throw new Error(`${where} needs a name`);
    if (names.has(p.name)) throw new Error(`${where} is named twice`);
    names.add(p.name);
    const d = p.key?.direction;
    if (!isText(p.key?.color) || !isNumber(p.key.intensity) || !Array.isArray(d) || d.length !== 3 || !d.every(isNumber)) throw new Error(`${where} needs key colour, intensity and direction`);
    if (d[1]! <= 0) throw new Error(`${where}: the key light must come from above the horizon`);
    // Straight down would leave the shadow camera with no sideways direction to line up with.
    if (Math.hypot(d[0]!, d[2]!) < 0.05 * Math.hypot(d[0]!, d[1]!, d[2]!)) throw new Error(`${where}: the key light must not come from straight above`);
    if (!isNumber(p.key.shadow) || p.key.shadow < 0 || p.key.shadow > 1) throw new Error(`${where} needs key shadow, 0 to 1`);
    if (!isText(p.fillSky) || !isText(p.fillGround) || !isNumber(p.fillIntensity)) throw new Error(`${where} needs fillSky, fillGround and fillIntensity`);
    if (!(isNumber(p.shade?.shadow) && p.shade.shadow >= 0 && p.shade.shadow <= 1 && isNumber(p.shade.mid) && p.shade.mid >= 0 && p.shade.mid <= 1)) throw new Error(`${where} needs shade shadow and mid, 0 to 1`);
    if (!isText(p.sky?.zenith) || !isText(p.sky.sun) || !isText(p.clouds?.lit) || !isText(p.clouds.shade)) throw new Error(`${where} needs sky and cloud colours`);
    parsePresetHaze(p.haze, where);
  }
  return { presets };
}

// Every colour a preset names, for checking them against the palette.
export function presetColors(p: LightPreset): string[] {
  return [p.key.color, p.fillSky, p.fillGround, p.sky.zenith, p.sky.sun, p.clouds.lit, p.clouds.shade, p.haze.color, p.haze.distant, ...p.haze.steps.map((s) => s.tint)];
}

// The same seed always gives the same preset. The seed is mixed first, because seeds are often small and
// consecutive (seed=7, seed=8) and a plain remainder would walk through the presets in order.
export function presetForSeed(light: LightConfig, seed: number): LightPreset {
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return light.presets[(h >>> 0) % light.presets.length]!;
}

export function presetNamed(light: LightConfig, name: string): LightPreset | null {
  return light.presets.find((p) => p.name === name) ?? null;
}
