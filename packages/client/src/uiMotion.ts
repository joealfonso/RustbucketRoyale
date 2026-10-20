// Small helpers for the UI motion in motion.css. The motion itself is CSS; these only start it and read its timing.

// The whole number to show `t` seconds into a count from `from` to `to` that lasts `seconds`. It eases out, so it
// races through the far numbers and settles on the last few, and it always lands exactly on `to`.
export function countAt(from: number, to: number, t: number, seconds: number): number {
  if (seconds <= 0 || t >= seconds) return to;
  if (t <= 0) return from;
  const k = t / seconds;
  const eased = 1 - (1 - k) ** 3;
  return Math.round(from + (to - from) * eased);
}

// A CSS time ("160ms", "0.2s") in seconds. Anything unreadable is 0, which shows the end state at once.
export function parseCssTime(text: string): number {
  const match = /^\s*(-?[\d.]+)\s*(ms|s)\s*$/.exec(text);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return 0;
  return match[2] === "ms" ? value / 1000 : value;
}

// A motion token from motion.css, in seconds. Reduced motion sets some of them to 0 there, so JS follows it too.
export function cssSeconds(name: string): number {
  return parseCssTime(getComputedStyle(document.documentElement).getPropertyValue(name));
}

// Restarts the punch on `el` (motion.css, [data-beat]). Flipping between two copies of the keyframes restarts it
// without the forced layout that removing and re-adding a class needs.
export function replay(el: HTMLElement): void {
  el.dataset.beat = el.dataset.beat === "a" ? "b" : "a";
}

// Rolls the number in `el` from `from` to `to` over `seconds`, touching the page only when the shown number changes.
// Returns a stop function, which also jumps to the end.
export function countUp(el: HTMLElement, from: number, to: number, seconds: number): () => void {
  let shown = NaN;
  let frame = 0;
  const start = performance.now();
  const show = (value: number) => {
    if (value === shown) return;
    shown = value;
    el.textContent = String(value);
  };
  const tick = (now: number) => {
    const t = (now - start) / 1000;
    show(countAt(from, to, t, seconds));
    frame = t < seconds ? requestAnimationFrame(tick) : 0;
  };
  show(seconds > 0 ? from : to);
  if (seconds > 0) frame = requestAnimationFrame(tick);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    show(to);
  };
}
