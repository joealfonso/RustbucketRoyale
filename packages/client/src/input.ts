import type { MechInput } from "@rustbucket/shared";
import { DoubleTap } from "./doubleTap";

// Dash direction for each movement key, as (right, forward).
const DASH_KEYS: Record<string, [number, number] | undefined> = {
  KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0],
};
const isShift = (code: string) => code === "ShiftLeft" || code === "ShiftRight";

// Keyboard and mouse. The mouse only counts while the pointer is locked to the canvas.
export class Input {
  private keys = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private mouseDown = false;
  locked = false;

  private dashQueued = false;
  private dashMoveX = 0;
  private dashMoveY = 0;
  private doubleTap = new DoubleTap();

  // `doubleTapSeconds` is read each time, so the tuning panel can change it live.
  constructor(private canvas: HTMLCanvasElement, private hint: HTMLElement, private doubleTapSeconds: () => number) {
    window.addEventListener("keydown", (e) => {
      // Two presses of Shift dash where you steer. Two presses of a movement key dash that way.
      // One press or a hold is just walking or running. Key repeat does not count as a new press.
      const direction = DASH_KEYS[e.code];
      if ((direction || isShift(e.code)) && !this.keys.has(e.code) && this.locked) {
        if (this.doubleTap.press(e.code, performance.now(), this.doubleTapSeconds())) {
          this.dashQueued = true;
          this.dashMoveX = direction ? direction[0] : 0;
          this.dashMoveY = direction ? direction[1] : 0;
        }
      }
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouseDown = false; });

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
    out.run = active && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
    out.jet = active && this.keys.has("Space");
    // True for exactly one sim step per tap.
    out.dash = active && this.dashQueued;
    out.dashMoveX = out.dash ? this.dashMoveX : 0;
    out.dashMoveY = out.dash ? this.dashMoveY : 0;
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
