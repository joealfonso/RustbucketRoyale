// The last few seconds of frame times, for the performance readouts. Fixed size, so it allocates nothing per frame.
export class FrameTimes {
  private times: Float32Array;
  private sorted: Float32Array;
  private next = 0;
  private filled = 0;

  constructor(size: number) {
    this.times = new Float32Array(size);
    this.sorted = new Float32Array(size);
  }

  record(ms: number): void {
    this.times[this.next] = ms;
    this.next = (this.next + 1) % this.times.length;
    this.filled = Math.min(this.filled + 1, this.times.length);
  }

  // Median and worst of what is recorded, in ms.
  summary(out: { median: number; worst: number }): void {
    const n = this.filled;
    if (n === 0) { out.median = 0; out.worst = 0; return; }
    this.sorted.set(this.times.subarray(0, n));
    const view = this.sorted.subarray(0, n).sort();
    out.median = view[n >> 1]!;
    out.worst = view[n - 1]!;
  }
}
