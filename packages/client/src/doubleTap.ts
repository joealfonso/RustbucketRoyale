// Spots two presses of the same key close together. Each key is tracked on its own, so tapping
// W then D quickly is not a double tap. A third press starts a fresh pair instead of chaining.
export class DoubleTap {
  private last = new Map<string, number>();

  // Call on each real key press (not key repeat). Returns true when this press completes a double tap.
  press(key: string, nowMs: number, windowSeconds: number): boolean {
    const before = this.last.get(key);
    if (before !== undefined && nowMs - before <= windowSeconds * 1000) {
      this.last.delete(key);
      return true;
    }
    this.last.set(key, nowMs);
    return false;
  }
}
