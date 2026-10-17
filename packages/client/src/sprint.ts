import { DoubleTap } from "./doubleTap";

// Double-press W to start sprinting. The sprint lasts while W stays held, and letting go ends it.
export class Sprint {
  active = false;
  private doubleTap = new DoubleTap();

  forwardPressed(nowMs: number, windowSeconds: number): void {
    if (this.doubleTap.press("KeyW", nowMs, windowSeconds)) this.active = true;
  }

  forwardReleased(): void {
    this.active = false;
  }
}
