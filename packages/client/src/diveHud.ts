import { DROP_BALL, DROP_BURNING, DROP_HANGING, DROP_NONE } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";

// The HUD while you drop in: your height over the ground and how fast you are falling, beside the middle of the
// screen, and nothing about guns (the weapons, the crosshair and the cooldown under it hide while the page has the
// `dropping` class, hud.css), since you cannot fire until you are down. The aim ring on the ground is the crosshair.
// While the ball falls, the keys that speed it up show under the numbers and light while held, so a new pilot sees
// the choice between landing first and taking time to aim.
export class DiveHud {
  private box = document.createElement("div");
  private phaseText = document.createElement("span");
  private altitude = document.createElement("span");
  private fall = document.createElement("span");
  private fast = document.createElement("div");
  private fastHeld = false;
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
    this.fast.className = "fast";
    for (const name of words.fastKeys) {
      const key = document.createElement("span");
      key.className = "key";
      key.textContent = name;
      this.fast.append(key);
    }
    const call = document.createElement("span");
    call.className = "label";
    call.textContent = words.fastCall;
    this.fast.append(call);
    this.box.append(this.phaseText, row("Alt", this.altitude, "m"), row("Fall", this.fall, "m/s"), this.fast);
    document.body.append(this.box);
  }

  // Each frame: your drop phase, metres above the ground, fall speed and whether a fall-faster key is held. Phase 0
  // hides it all.
  update(phase: number, altitude: number, fall: number, fastHeld: boolean): void {
    if (fastHeld !== this.fastHeld) { this.fastHeld = fastHeld; this.fast.classList.toggle("on", fastHeld); }
    const meters = Math.max(0, Math.round(altitude)), speed = Math.max(0, Math.round(fall));
    const s = this.shown;
    if (s[0] === phase && s[1] === meters && s[2] === speed) return;
    if (s[0] !== phase) {
      document.body.classList.toggle("dropping", phase !== DROP_NONE);
      this.box.classList.toggle("burning", phase === DROP_BURNING);
      this.fast.hidden = phase !== DROP_BALL;
      this.phaseText.textContent = phase === DROP_HANGING ? this.words.hanging : phase === DROP_BALL ? this.words.ball : this.words.burning;
    }
    s[0] = phase; s[1] = meters; s[2] = speed;
    if (phase === DROP_NONE) return;
    this.altitude.textContent = String(meters);
    this.fall.textContent = String(speed);
  }
}
