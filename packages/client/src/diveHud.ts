import { DROP_BURNING, DROP_NONE, DROP_RIDING, DROP_SHELL } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";

// The HUD while you drop in: your height over the ground and how fast you are falling, beside the middle of the
// screen, and nothing about guns (the weapons, the crosshair and the cooldown under it hide while the page has the
// `dropping` class, hud.css), since you cannot fire until you are down. Aboard the ship once the match is live, the
// call to launch sits under the middle of the screen with the seconds until the ship throws you out anyway.
export class DiveHud {
  private call = document.createElement("div");
  private callWords = document.createElement("strong");
  private eject = document.createElement("span");
  private ejectShown = -2;
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
    this.call.id = "launchCall";
    this.call.className = "panel";
    this.callWords.textContent = words.launch;
    this.eject.className = "label";
    this.call.append(this.callWords, this.eject);
    document.body.append(this.box, this.call);
  }

  // `ejectSeconds`: seconds until the ship throws you out, while you may launch; below 0 hides the call (the
  // countdown, or not aboard).
  launchCall(ejectSeconds: number): void {
    const shown = ejectSeconds < 0 ? -1 : Math.ceil(ejectSeconds);
    if (shown === this.ejectShown) return;
    if ((shown < 0) !== (this.ejectShown < 0)) this.call.classList.toggle("shown", shown >= 0);
    this.ejectShown = shown;
    if (shown >= 0) this.eject.textContent = `${this.words.ejectIn} ${shown} s`;
  }

  // Each frame: your drop phase, metres above the ground and fall speed. Phase 0 hides it all.
  update(phase: number, altitude: number, fall: number): void {
    const meters = Math.max(0, Math.round(altitude)), speed = Math.max(0, Math.round(fall));
    const s = this.shown;
    if (s[0] === phase && s[1] === meters && s[2] === speed) return;
    if (s[0] !== phase) {
      document.body.classList.toggle("dropping", phase !== DROP_NONE);
      this.box.classList.toggle("burning", phase === DROP_BURNING);
      this.phaseText.textContent = phase === DROP_RIDING ? this.words.riding : phase === DROP_SHELL ? this.words.shell : phase === DROP_BURNING ? this.words.burning : this.words.diving;
    }
    s[0] = phase; s[1] = meters; s[2] = speed;
    if (phase === DROP_NONE) return;
    this.altitude.textContent = String(meters);
    this.fall.textContent = String(speed);
  }
}
