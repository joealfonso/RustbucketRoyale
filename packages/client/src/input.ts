import type { MechInput } from "@rustbucket/shared";

// Keyboard and mouse. The mouse only counts while the pointer is locked to the canvas.
export class Input {
  private keys = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private mouseDown = false;
  locked = false;

  constructor(private canvas: HTMLCanvasElement, private hint: HTMLElement) {
    window.addEventListener("keydown", (e) => {
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
    out.fire = active && this.mouseDown;
  }

  // Takes the mouse movement since the last call.
  takeLook(out: { dx: number; dy: number }): void {
    out.dx = this.mouseDx;
    out.dy = this.mouseDy;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }
}
