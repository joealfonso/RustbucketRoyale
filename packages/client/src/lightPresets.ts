// The light of a match (data/look.json, `light`): a few named presets, each a whole mood (key and fill light, sky,
// clouds, haze). The map seed picks one, so everyone in a room sees the same sky, and ?look=<name> forces one offline.

export interface LightPreset {
  name: string;
  key: { color: string; intensity: number; direction: [number, number, number] };
  fillSky: string;
  fillGround: string;
  fillIntensity: number;
  // The sky fades from the haze colour at the horizon up to `zenith`, so far ground melts into the sky with no seam.
  sky: { zenith: string; sun: string };
  clouds: { lit: string; shade: string };
  // Haze starts at `near` metres and is all but solid (98%) at ground level by `far`.
  haze: { color: string; near: number; far: number };
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
    if (!isText(p.fillSky) || !isText(p.fillGround) || !isNumber(p.fillIntensity)) throw new Error(`${where} needs fillSky, fillGround and fillIntensity`);
    if (!isText(p.sky?.zenith) || !isText(p.sky.sun) || !isText(p.clouds?.lit) || !isText(p.clouds.shade)) throw new Error(`${where} needs sky and cloud colours`);
    if (!isText(p.haze?.color) || !isNumber(p.haze.near) || !isNumber(p.haze.far) || p.haze.near < 0 || p.haze.far <= p.haze.near) throw new Error(`${where} needs haze colour and near < far`);
  }
  return { presets };
}

// Every colour a preset names, for checking them against the palette.
export function presetColors(p: LightPreset): string[] {
  return [p.key.color, p.fillSky, p.fillGround, p.sky.zenith, p.sky.sun, p.clouds.lit, p.clouds.shade, p.haze.color];
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
