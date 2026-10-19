// Small pure helpers the pooled effects share: which flipbook frame shows, how far a growth has stepped, and which
// pool slot a new effect takes.

// The frame (0 to frames - 1) a flipbook shows `age` seconds into a `life` second run, spread evenly over the life.
// Before it starts (age below 0) it shows the first frame; once over, the last.
export function flipbookFrame(age: number, life: number, frames: number): number {
  if (frames <= 1 || life <= 0 || age <= 0) return 0;
  return Math.min(frames - 1, Math.floor((age / life) * frames));
}

// A looping flicker: the frame `age` seconds in at `fps` frames a second.
export function flickerFrame(age: number, fps: number, frames: number): number {
  if (frames <= 1 || fps <= 0) return 0;
  return Math.floor(Math.max(0, age) * fps) % frames;
}

// Share of a run (0 to 1) moved on in `steps` hard jumps rather than smoothly, so things grow like drawn frames.
// 0 steps means smooth.
export function stepped(share: number, steps: number): number {
  const t = Math.max(0, Math.min(1, share));
  return steps > 0 ? Math.min(1, Math.ceil(t * steps) / steps) : t;
}

// A slot ring: the next slot below `limit`, wrapping to reuse the oldest. `limit` can drop between calls (a lower
// quality level), so the ring starts over rather than handing out a slot past it.
export class SlotRing {
  private at = 0;

  take(limit: number): number {
    if (limit <= 0) return -1;
    if (this.at >= limit) this.at = 0;
    return this.at++;
  }
}

// A fixed pseudo random number in [0, 1) for a whole number, so a flicker or a spread looks random but every frame
// of it is the same on replay and nothing calls Math.random in the art.
export function hash01(n: number): number {
  let h = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
