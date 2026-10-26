import { STEP } from "@rustbucket/shared";

const MAX_CATCH_UP_TICKS = 5;

// Runs `tick` 60 times a second on timers, drift corrected: as many ticks as are owed run back to back, so a slow tick
// does not slow the game down, and a machine that fell far behind skips ahead rather than racing to catch up. The
// game server ticks its rooms on this, and offline practice its one room in the page (client localRoom.ts), so both
// keep the same time. `onTick` hears how long each tick took and how late it started. Returns a function that stops it.
export function startTickLoop(tick: () => void, onTick?: (ms: number, lateMs: number) => void): () => void {
  let next = performance.now();
  let timer: ReturnType<typeof setTimeout>;
  const loop = () => {
    const now = performance.now();
    let ticks = 0;
    while (next <= now && ticks < MAX_CATCH_UP_TICKS) {
      const started = performance.now();
      tick();
      onTick?.(performance.now() - started, started - next);
      next += STEP * 1000;
      ticks++;
    }
    if (next <= now) next = now; // fell too far behind, skip ahead
    timer = setTimeout(loop, Math.max(1, next - performance.now()));
  };
  loop();
  return () => clearTimeout(timer);
}
