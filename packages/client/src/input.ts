import type { MechInput } from "@rustbucket/shared";
import { Sprint } from "./sprint";

const isShift = (code: string) => code === "ShiftLeft" || code === "ShiftRight";

// Keyboard and mouse. The mouse only counts while the pointer is locked to the canvas.
export class Input {
  private keys = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private mouseDown = false;
  private rightDown = false; // right mouse held: the weapon's secondary fire
  locked = false;

  private dashQueued = false;
  private interactQueued = false;
  private slot = 0;
  private clickQueued = false;
  private enterQueued = false;
  private played = false; // the mouse has been locked at least once
  private sprint = new Sprint();

  // `sprintWindowSeconds` is read each time, so the tuning panel can change it live.
  constructor(private canvas: HTMLCanvasElement, private hint: HTMLElement, private sprintWindowSeconds: () => number) {
    window.addEventListener("keydown", (e) => {
      // Key repeat does not count as a new press.
      if (!this.keys.has(e.code) && this.locked) {
        // Shift dashes the instant it goes down, toward where you are steering.
        if (isShift(e.code)) this.dashQueued = true;
        if (e.code === "Digit1") this.slot = 0;
        if (e.code === "Digit2") this.slot = 1;
        if (e.code === "KeyE") this.interactQueued = true;
        // Two quick presses of W start a sprint that lasts while W is held.
        if (e.code === "KeyW") this.sprint.forwardPressed(performance.now(), this.sprintWindowSeconds());
      }
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
      if (e.code === "Enter" && !e.repeat) this.enterQueued = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "KeyW") this.sprint.forwardReleased();
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => { this.keys.clear(); this.mouseDown = false; this.rightDown = false; this.sprint.forwardReleased(); });

    // The mouse wheel flips between the two weapon slots.
    window.addEventListener("wheel", (e) => { if (this.locked && e.deltaY !== 0) this.slot = 1 - this.slot; });
    window.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });
    window.addEventListener("mousedown", (e) => {
      if (e.button === 2) { this.rightDown = true; return; }
      if (e.button !== 0) return;
      this.mouseDown = true;
      if (this.locked) this.clickQueued = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    // Right-click is the secondary fire, so the browser's menu must never open over the game, locked or not.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("contextmenu", (e) => { if (this.locked) e.preventDefault(); });

    // Buttons on the overlay (settings, main menu) do their own thing without grabbing the mouse.
    hint.addEventListener("click", (e) => { if (!(e.target as Element).closest("button")) this.lock(); });
    canvas.addEventListener("click", () => { if (!this.locked) this.lock(); });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      // Once you have played, freeing the mouse shows a small bar instead of the whole screen, so the fight stays in view.
      // Switched on when the mouse is freed rather than when it is first locked, so the full screen fades out as
      // itself instead of turning into the bar halfway through its fade.
      if (this.locked) this.played = true;
      else if (this.played) hint.classList.add("resume");
      hint.classList.toggle("hidden", this.locked || this.panelOpen);
      if (!this.locked) { this.mouseDown = false; this.rightDown = false; }
    });
  }

  panelOpen = false;

  // Raw mouse movement skips the operating system's pointer smoothing and acceleration, which adds lag and
  // makes aim inconsistent. Not every browser allows it, so fall back to the normal lock.
  lock(): void {
    const request = this.canvas.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    const result = request.call(this.canvas, { unadjustedMovement: true });
    if (result instanceof Promise) result.catch(() => void this.canvas.requestPointerLock());
  }

  unlock(): void {
    document.exitPointerLock();
  }

  setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.hint.classList.toggle("hidden", open || this.locked);
  }

  // True once per click while the mouse is locked. Used to cycle who you are watching.
  takeClick(): boolean {
    const clicked = this.clickQueued;
    this.clickQueued = false;
    return clicked;
  }

  takeEnter(): boolean {
    const pressed = this.enterQueued;
    this.enterQueued = false;
    return pressed;
  }

  // The slot the server says is in hand wins when it disagrees, for example when the slot asked for is empty.
  setSlot(slot: number): void {
    this.slot = slot;
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
    out.altFire = active && this.rightDown;
    out.grenade = active && this.keys.has("KeyG");
    out.slot = this.slot;
    // Held E loots a wreck. A press too quick to span a sim step still counts for one step, so taking a weapon never misses.
    out.interact = active && (this.interactQueued || this.keys.has("KeyE"));
    out.repair = active && this.keys.has("KeyF");
    // Held Q uses the ability the moment it is ready, so holding it through a cooldown fires it again straight away.
    out.ability = active && this.keys.has("KeyQ");
    this.interactQueued = false;
  }

  // Takes the mouse movement since the last call.
  takeLook(out: { dx: number; dy: number }): void {
    out.dx = this.mouseDx;
    out.dy = this.mouseDy;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }
}
