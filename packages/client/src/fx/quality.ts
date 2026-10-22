import vfxJson from "../../../../data/vfx.json";
import type { SpriteRim } from "./sprites";

// The effects quality setting (DESIGN.md, VFX: "pooled, capped by data file values, with a low setting"). Each level
// in data/vfx.json is a set of caps: how many of each pooled effect can be alive, and how much one explosion throws.
// It only changes looks, so it is this browser's own choice, remembered here, and never reaches the server.

export type VfxLevel = Readonly<Record<string, number>>;

export interface VfxConfig {
  quality: string; // the level a browser starts on
  levels: Record<string, VfxLevel>;
  // Sprites dissolve away between `clearFromMeters` and `clearToMeters` from the camera (fx/sprites.ts).
  // `rim` is the darkened outline every pool named in `rimmed` draws, and `sunLit` names the pools whose smoke puffs
  // take the world's toon bands from the sun (fx/sprites.ts, gate V16b).
  sprites: {
    growSteps: number; clearFromMeters: number; clearToMeters: number; palettes: Record<string, string[]>;
    rim: SpriteRim; rimmed: string[]; sunLit: string[];
  };
}

const STORE_KEY = "rustbucket.vfxQuality";

export function parseVfx(raw: unknown): VfxConfig {
  const d = raw as VfxConfig;
  const names = Object.keys(d?.levels ?? {});
  if (names.length === 0) throw new Error("vfx.json: needs levels");
  if (!names.includes(d.quality)) throw new Error(`vfx.json: quality ${String(d.quality)} is not one of the levels`);
  // Every level caps the same things, so switching can never leave an effect without a number.
  const keys = Object.keys(d.levels[names[0]!]!).sort().join();
  for (const name of names) {
    const level = d.levels[name]!;
    if (Object.keys(level).sort().join() !== keys) throw new Error(`vfx.json: level ${name} must cap the same things as ${names[0]}`);
    for (const [k, v] of Object.entries(level)) if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`vfx.json: levels.${name}.${k} must be a whole number, 0 or more`);
  }
  for (const k of ["growSteps", "clearFromMeters", "clearToMeters"] as const) {
    if (typeof d.sprites?.[k] !== "number" || d.sprites[k] < 0) throw new Error(`vfx.json: sprites.${k} must be a number, 0 or more`);
  }
  for (const [name, colors] of Object.entries(d.sprites.palettes ?? {})) {
    if (!Array.isArray(colors) || colors.length !== 3) throw new Error(`vfx.json: sprites.palettes.${name} needs three colours, light to dark`);
  }
  const r = d.sprites.rim;
  // darken above 0: a rim is the pool's own dark colour, never black.
  if (!(r && r.darken > 0 && r.darken <= 1 && r.pixels > 0 && r.holeWidth >= 0 && r.holeWidth <= 1 && r.maxShare > 0 && r.maxShare <= 1)) {
    throw new Error("vfx.json: sprites.rim needs darken above 0 to 1 (never black), pixels above 0, holeWidth 0 to 1 and maxShare above 0 to 1");
  }
  for (const list of ["rimmed", "sunLit"] as const) {
    const names = d.sprites[list];
    if (!Array.isArray(names) || !names.every((n) => typeof n === "string" && n in (d.sprites.palettes ?? {}))) throw new Error(`vfx.json: sprites.${list} must name palettes`);
  }
  return d;
}

// `localStorage` throws when the browser blocks it; anything unreadable or no longer a level falls back to the file.
export function readQuality(storage: () => Pick<Storage, "getItem">, config: VfxConfig): string {
  let saved: unknown;
  try { saved = storage().getItem(STORE_KEY); } catch { return config.quality; }
  return typeof saved === "string" && saved in config.levels ? saved : config.quality;
}

export function writeQuality(storage: () => Pick<Storage, "setItem">, quality: string): void {
  try { storage().setItem(STORE_KEY, quality); } catch { /* blocked storage only costs the memory */ }
}

// The largest cap any level gives, which is what a pool is made with, so switching level never allocates.
export function mostOf(config: VfxConfig, key: string): number {
  let most = 0;
  for (const level of Object.values(config.levels)) most = Math.max(most, level[key] ?? 0);
  return most;
}

export const vfxConfig = parseVfx(vfxJson);
const browserStorage = () => globalThis.localStorage;
let active = readQuality(browserStorage, vfxConfig);
const listeners: (() => void)[] = [];

export function vfxQuality(): string {
  return active;
}

// The active level's caps. Read it when spawning, not once at startup, so a switch takes effect at once.
export function vfxLevel(): VfxLevel {
  return vfxConfig.levels[active]!;
}

// How much of the most generous level's `key` the active level gives, 0 to 1: for effects that scale a count they
// were given elsewhere, such as a prop's chunks.
export function vfxShare(key: string): number {
  const most = mostOf(vfxConfig, key);
  return most > 0 ? (vfxLevel()[key] ?? 0) / most : 1;
}

export function setVfxQuality(name: string): void {
  if (!(name in vfxConfig.levels) || name === active) return;
  active = name;
  writeQuality(browserStorage, name);
  for (const fn of listeners) fn();
}

export function onVfxQuality(fn: () => void): void {
  listeners.push(fn);
}

// The button on the pause screen: each click steps to the next level, round to the first.
export function attachVfxQualityButton(button: HTMLButtonElement): void {
  const state = button.querySelector(".state")!;
  const show = () => { state.textContent = active; };
  button.addEventListener("click", (e) => {
    e.stopPropagation(); // the pause screen behind it locks the mouse on click, and the button should not
    const names = Object.keys(vfxConfig.levels);
    setVfxQuality(names[(names.indexOf(active) + 1) % names.length]!);
  });
  // Enter on the focused button is for the button, not the game's "start match" key on the window.
  button.addEventListener("keydown", (e) => { if (e.code === "Enter") e.stopPropagation(); });
  onVfxQuality(show);
  show();
}

// The switch in the F1 panel. Takes the panel's lil-gui folder maker so this file needs no lil-gui import.
export function addVfxQualityControl(gui: { addFolder(name: string): { add(o: object, k: string, options: string[]): { name(n: string): unknown; onChange(fn: (v: string) => void): unknown } } }): void {
  const shown = { quality: active };
  const control = gui.addFolder("Effects").add(shown, "quality", Object.keys(vfxConfig.levels));
  control.name("Effects quality");
  control.onChange((v) => setVfxQuality(v));
}
