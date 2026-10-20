import { FrameTimes } from "./frameTimes";

// How long the graphics card spends on each frame, from the WebGL timer query extension. Frame time alone cannot
// show this: the browser holds frames to the screen's refresh, so 16.7 ms at 60 Hz looks the same whether the card
// needs 3 ms or 15. Answers arrive a few frames late, so a small ring of queries is kept busy and nothing is made per
// frame. Not every browser offers the extension; `available` says so and the readout stays at 0.

interface TimerQueryExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

const RING = 8;

export class GpuTimer {
  readonly times = new FrameTimes(240);
  private ext: TimerQueryExt | null;
  private queries: (WebGLQuery | null)[] = [];
  private pending: boolean[] = [];
  private next = 0;
  private open = -1;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQueryExt | null;
    if (this.ext) for (let i = 0; i < RING; i++) { this.queries.push(gl.createQuery()); this.pending.push(false); }
  }

  get available(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    if (!this.ext) return;
    this.collect();
    if (this.pending[this.next]) return; // every query still waiting for an answer: skip this frame
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.queries[this.next]!);
    this.open = this.next;
  }

  end(): void {
    if (!this.ext || this.open < 0) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending[this.open] = true;
    this.next = (this.open + 1) % RING;
    this.open = -1;
  }

  private collect(): void {
    const gl = this.gl;
    // A disjoint event (the card changed clocks, another app took it) spoils every answer in flight.
    const spoiled = gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
    for (let i = 0; i < RING; i++) {
      if (!this.pending[i]) continue;
      const q = this.queries[i]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.pending[i] = false;
      if (!spoiled) this.times.record(ns / 1e6);
    }
  }
}
