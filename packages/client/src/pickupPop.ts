import "./pickupPop.css";
import type { PickupLine } from "./pickupText";
import type { PickupTextLook } from "./pickupLook";

// The short line that floats up just under your mech when you take something ("+40 HEALTH · TORSO", "SCATTERGUN"),
// so what a pickup does is taught by taking it. The rise and fade are a CSS animation: nothing runs per frame.
export class PickupPop {
  private root = document.createElement("div");

  constructor(private look: PickupTextLook) {
    this.root.id = "pickupPop";
    this.root.setAttribute("aria-live", "polite");
    this.root.style.setProperty("--pop-seconds", `${look.seconds}s`);
    this.root.style.setProperty("--pop-rise", `${-look.risePx}px`);
    document.body.appendChild(this.root);
  }

  show(lines: readonly PickupLine[]): void {
    for (const line of lines) {
      const el = document.createElement("div");
      el.className = "pop";
      el.textContent = line.text;
      el.style.color = line.health ? this.look.healthColor : this.look.otherColor;
      el.addEventListener("animationend", () => el.remove(), { once: true });
      this.root.appendChild(el);
    }
  }

  clear(): void {
    this.root.replaceChildren();
  }
}
