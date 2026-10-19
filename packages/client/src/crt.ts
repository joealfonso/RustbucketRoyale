import "./crt.css";

// The CRT look on the HUD (crt.css). All of it is CSS: this only sets numbers on the page root when a setting
// changes, so it costs nothing per frame.

export interface CrtConfig {
  defaultIntensity: number; // 0 to 1, until a player changes it
  scanlinePeriodPx: number; // one dark line every this many pixels
  scanlineAlpha: number; // darkness of a line at full intensity
  phosphorAlpha: number; // strength of the 1 px text edge at full intensity
  flickerSeconds: number; // one round of the flicker
  flickerDepth: number; // how far the lines fade during a flicker, 0 to 1
}

export interface CrtSetting {
  on: boolean; // the player's switch on the pause screen
  intensity: number; // the F1 slider, 0 to 1
}

const STORE_KEY = "rustbucket.crt";

// Fails loudly on a bad data file, same as the other tuning files.
export function parseCrt(raw: unknown): CrtConfig {
  const d = raw as Partial<CrtConfig>;
  const share = ["defaultIntensity", "scanlineAlpha", "phosphorAlpha", "flickerDepth"] as const;
  for (const key of share) {
    if (typeof d?.[key] !== "number" || !(d[key] >= 0 && d[key] <= 1)) throw new Error(`crt.json: ${key} must be between 0 and 1`);
  }
  if (typeof d.scanlinePeriodPx !== "number" || !(d.scanlinePeriodPx >= 2)) throw new Error("crt.json: scanlinePeriodPx must be 2 or more");
  if (typeof d.flickerSeconds !== "number" || !(d.flickerSeconds > 0)) throw new Error("crt.json: flickerSeconds must be above 0");
  return d as CrtConfig;
}

export function clampIntensity(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

// What this browser remembers, else on at the data file's intensity. `storage` is a getter because even reading
// `localStorage` throws when the browser blocks it, and anything unreadable just falls back to the default.
export function readCrtSetting(storage: () => Pick<Storage, "getItem">, config: CrtConfig): CrtSetting {
  const fallback = { on: true, intensity: config.defaultIntensity };
  let saved: unknown = null;
  try { saved = JSON.parse(storage().getItem(STORE_KEY) ?? "null"); } catch { return fallback; }
  if (typeof saved !== "object" || saved === null) return fallback;
  const s = saved as Partial<CrtSetting>;
  return { on: typeof s.on === "boolean" ? s.on : true, intensity: clampIntensity(s.intensity, config.defaultIntensity) };
}

export function writeCrtSetting(storage: () => Pick<Storage, "setItem">, setting: CrtSetting): void {
  try { storage().setItem(STORE_KEY, JSON.stringify(setting)); } catch { /* blocked storage only costs the memory */ }
}

// The strength the CSS draws at: nothing when switched off.
export const shownIntensity = (setting: CrtSetting): number => (setting.on ? setting.intensity : 0);

export class Crt {
  readonly setting: CrtSetting;
  private button: HTMLButtonElement | null = null;

  constructor(private root: HTMLElement, config: CrtConfig, private storage: () => Storage) {
    this.setting = readCrtSetting(storage, config);
    root.style.setProperty("--crt-period", `${config.scanlinePeriodPx}px`);
    root.style.setProperty("--crt-scan", String(config.scanlineAlpha));
    root.style.setProperty("--crt-phosphor", String(config.phosphorAlpha));
    root.style.setProperty("--crt-flicker", `${config.flickerSeconds}s`);
    root.style.setProperty("--crt-flicker-depth", String(config.flickerDepth));
    this.apply();
  }

  // The pause screen's on and off switch.
  attachSwitch(button: HTMLButtonElement): void {
    this.button = button;
    button.addEventListener("click", (e) => {
      e.stopPropagation(); // the pause screen behind it locks the mouse on click, and the switch should not
      this.setting.on = !this.setting.on;
      this.changed();
    });
    // Enter on the focused switch is for the switch, not the game's "start match" key on the window.
    button.addEventListener("keydown", (e) => { if (e.code === "Enter") e.stopPropagation(); });
    this.showSwitch();
  }

  // From the F1 slider. Moving it switches the look on, so the slider never seems to do nothing.
  setIntensity(value: number): void {
    this.setting.intensity = clampIntensity(value, this.setting.intensity);
    if (this.setting.intensity > 0) this.setting.on = true;
    this.changed();
  }

  private changed(): void {
    writeCrtSetting(this.storage, this.setting);
    this.apply();
    this.showSwitch();
  }

  private apply(): void {
    const shown = shownIntensity(this.setting);
    this.root.style.setProperty("--crt", String(shown));
    this.root.classList.toggle("crtOn", shown > 0);
  }

  private showSwitch(): void {
    if (!this.button) return;
    this.button.setAttribute("aria-checked", String(this.setting.on));
    this.button.querySelector(".state")!.textContent = this.setting.on ? "On" : "Off";
  }
}
