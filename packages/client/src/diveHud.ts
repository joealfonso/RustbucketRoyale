import { DROP_BURNING, DROP_NONE, DROP_RIDING } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";

// The HUD while you drop in: your height over the ground and how fast you are falling, beside the middle of the
// screen, and nothing about guns (the weapons, the crosshair and the cooldown under it hide while the page has the
// `dropping` class, hud.css), since you cannot fire until you are down.
export class DiveHud {
  private box = document.createElement("div");
  private phaseText = document.createElement("span");
  private altitude = document.createElement("span");
  private fall = document.createElement("span");
  private shown = [-1, -1, -1]; // phase, metres, m/s last written, so a frame where nothing changed touches nothing

  constructor(private words: DiveConfig["hud"]) {
    this.box.id = "diveHud";
    this.box.className = "panel";
    this.phaseText.className = "label";
    this.altitude.className = "num";
    this.fall.className = "num";
    const row = (label: string, value: HTMLElement, unit: string) => {
      const line = document.createElement("div");
      const name = document.createElement("span");
      name.className = "label";
      name.textContent = label;
      const units = document.createElement("small");
      units.textContent = unit;
      line.append(name, value, units);
      return line;
    };
    this.box.append(this.phaseText, row("Alt", this.altitude, "m"), row("Fall", this.fall, "m/s"));
    document.body.append(this.box);
  }

  // Each frame: your drop phase, metres above the ground and fall speed. Phase 0 hides it all.
  update(phase: number, altitude: number, fall: number): void {
    const meters = Math.max(0, Math.round(altitude)), speed = Math.max(0, Math.round(fall));
    const s = this.shown;
    if (s[0] === phase && s[1] === meters && s[2] === speed) return;
    if (s[0] !== phase) {
      document.body.classList.toggle("dropping", phase !== DROP_NONE);
      this.box.classList.toggle("burning", phase === DROP_BURNING);
      this.phaseText.textContent = phase === DROP_RIDING ? this.words.riding : phase === DROP_BURNING ? this.words.burning : this.words.diving;
    }
    s[0] = phase; s[1] = meters; s[2] = speed;
    if (phase === DROP_NONE) return;
    this.altitude.textContent = String(meters);
    this.fall.textContent = String(speed);
  }
}
