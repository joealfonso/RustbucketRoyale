import type { MechInput } from "@rustbucket/shared";
import { Sprint } from "./sprint";

const isShift = (code: string) => code === "ShiftLeft" || code === "ShiftRight";

// Keyboard and mouse. The mouse only counts while the pointer is locked to the canvas.
export class Input {
  private keys = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private mouseDown = false;
  locked = false;

  private dashQueued = false;
  private sprint = new Sprint();

  // `sprintWindowSeconds` is read each time, so the tuning panel can change it live.
  constructor(private canvas: HTMLCanvasElement, private hint: HTMLElement, private sprintWindowSeconds: () => number) {
    window.addEventListener("keydown", (e) => {
      // Key repeat does not count as a new press.
      if (!this.keys.has(e.code) && this.locked) {
        // Shift dashes the instant it goes down, toward where you are steering.
        if (isShift(e.code)) this.dashQueued = true;
        // Two quick presses of W start a sprint that lasts while W is held.
        if (e.code === "KeyW") this.sprint.forwardPressed(performance.now(), this.sprintWindowSeconds());
      }
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "KeyW") this.sprint.forwardReleased();
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => { this.keys.clear(); this.mouseDown = false; this.sprint.forwardReleased(); });

    window.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });
    window.addEventListener("mousedown", (e) => { if (e.button === 0) this.mouseDown = true; });
    window.addEventListener("mouseup", (e) => { if (e.button === 0) this.mouseDown = false; });

    hint.addEventListener("click", () => this.lock());
    canvas.addEventListener("click", () => { if (!this.locked) this.lock(); });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      hint.classList.toggle("hidden", this.locked || this.panelOpen);
      if (!this.locked) this.mouseDown = false;
    });
  }

  panelOpen = false;

  lock(): void {
    void this.canvas.requestPointerLock();
  }

  unlock(): void {
    document.exitPointerLock();
  }

  setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.hint.classList.toggle("hidden", open || this.locked);
  }

  wasPressed(code: string): boolean {
    return this.keys.delete(code);
  }

  // Writes movement and buttons into `out`. Aim is added by the caller from the look deltas.
  sample(out: MechInput): void {
    const active = this.locked;
    out.moveX = active ? (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0) : 0;
    out.moveY = active ? (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0) : 0;
    out.run = active && this.sprint.active;
    out.jet = active && this.keys.has("Space");
    // True for exactly one sim step per Shift press.
    out.dash = active && this.dashQueued;
    this.dashQueued = false;
    out.fire = active && this.mouseDown;
    out.grenade = active && this.keys.has("KeyG");
  }

  // Takes the mouse movement since the last call.
  takeLook(out: { dx: number; dy: number }): void {
    out.dx = this.mouseDx;
    out.dy = this.mouseDy;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }
}
