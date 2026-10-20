// Dynamic resolution: how many screen pixels each CSS pixel gets, chosen from how the frames are going. A Retina
// laptop drawing at its full ratio of 2 fills nearly three times the pixels of 1.2, and every toon, paint and shadow
// pixel costs; a fanless laptop falls behind, frames queue up and the mouse feels late. So the ratio steps down while
// frames miss 60 a second, and back up once the graphics card has had room to spare for a while (data/render.json).

export interface RenderScaleConfig {
  minPixelRatio: number;
  maxPixelRatio: number; // never above the screen's own
  startPixelRatio: number;
  step: number;
  checkSeconds: number;
  lowerAboveFrameMs: number; // median frame time over a check that means frames are being missed
  raiseBelowGpuMs: number; // median GPU time that leaves room for more pixels
  raiseAfterSeconds: number; // that room has to last this long first, so it does not flip back and forth
}

export function parseRenderScale(raw: unknown): RenderScaleConfig {
  const d = raw as RenderScaleConfig;
  for (const key of ["minPixelRatio", "maxPixelRatio", "startPixelRatio", "step", "checkSeconds", "lowerAboveFrameMs", "raiseBelowGpuMs", "raiseAfterSeconds"] as const) {
    if (typeof d?.[key] !== "number" || !(d[key] > 0)) throw new Error(`render.json: ${key} must be a number above 0`);
  }
  if (!(d.minPixelRatio <= d.startPixelRatio && d.startPixelRatio <= d.maxPixelRatio)) throw new Error("render.json: startPixelRatio must be between minPixelRatio and maxPixelRatio");
  return d;
}

export class RenderScale {
  ratio: number;
  private top: number;
  private sinceCheck = 0;
  private roomFor = 0;

  constructor(private config: RenderScaleConfig, screenRatio: number) {
    this.top = Math.max(config.minPixelRatio, Math.min(config.maxPixelRatio, screenRatio));
    this.ratio = Math.min(config.startPixelRatio, this.top);
  }

  // Each frame: true once a check is due, so the caller works out the medians only then, not every frame.
  due(dt: number): boolean {
    this.sinceCheck += dt;
    return this.sinceCheck >= this.config.checkSeconds;
  }

  // At a check. `frameMedianMs` and `gpuMedianMs` are the recent medians (GPU 0 when the browser cannot time it).
  // Returns true when the ratio changed and the renderer should be resized.
  decide(frameMedianMs: number, gpuMedianMs: number): boolean {
    const elapsed = this.sinceCheck;
    this.sinceCheck = 0;
    const c = this.config;
    if (frameMedianMs > c.lowerAboveFrameMs && this.ratio > c.minPixelRatio) {
      this.ratio = Math.max(c.minPixelRatio, this.ratio - c.step);
      this.roomFor = 0;
      return true;
    }
    // Without a GPU timer there is no telling how much room there is, so the ratio only ever goes down.
    const room = gpuMedianMs > 0 && gpuMedianMs < c.raiseBelowGpuMs && frameMedianMs <= c.lowerAboveFrameMs;
    this.roomFor = room ? this.roomFor + elapsed : 0;
    if (this.roomFor >= c.raiseAfterSeconds && this.ratio < this.top) {
      this.ratio = Math.min(this.top, this.ratio + c.step);
      this.roomFor = 0;
      return true;
    }
    return false;
  }
}
