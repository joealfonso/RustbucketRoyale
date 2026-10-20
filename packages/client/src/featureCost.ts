import type { FrameTimes } from "./frameTimes";

// What each look feature that can be switched off costs on this machine's graphics card (F1, Performance). It
// measures everything on, then each feature off in turn, a few seconds each, and reports the median GPU time saved.
// The first part of each step is thrown away: switching shadows recompiles shaders and the first frames hitch.

export interface Feature {
  name: string;
  set(on: boolean): void;
}

export interface FeatureCostResult {
  name: string;
  ms: number;
}

export class FeatureCost {
  readonly results: FeatureCostResult[] = [];
  baselineMs = 0;
  private step = -1; // -1 idle, 0 everything on, then 1 + the index of the feature switched off
  private elapsed = 0;
  private sampling = false;

  constructor(private features: Feature[], private settleSeconds: number, private sampleSeconds: number) {}

  get running(): boolean {
    return this.step >= 0;
  }

  // How far along, as words for the panel.
  get progress(): string {
    if (this.step < 0) return this.results.length ? "done" : "not run";
    return this.step === 0 ? "measuring everything on" : `measuring without ${this.features[this.step - 1]!.name}`;
  }

  start(): void {
    this.results.length = 0;
    this.baselineMs = 0;
    for (const f of this.features) f.set(true);
    this.begin(0);
  }

  // Each frame, with the seconds passed and the GPU times being recorded. Clears them when sampling starts and
  // reads their median when it ends.
  tick(dt: number, gpu: FrameTimes, out: { median: number; worst: number }): void {
    if (this.step < 0) return;
    this.elapsed += dt;
    if (!this.sampling && this.elapsed >= this.settleSeconds) {
      gpu.clear();
      this.sampling = true;
    }
    if (!this.sampling || this.elapsed < this.settleSeconds + this.sampleSeconds) return;
    gpu.summary(out);
    if (this.step === 0) this.baselineMs = out.median;
    else this.results.push({ name: this.features[this.step - 1]!.name, ms: this.baselineMs - out.median });
    if (this.step > 0) this.features[this.step - 1]!.set(true);
    if (this.step < this.features.length) {
      this.features[this.step]!.set(false);
      this.begin(this.step + 1);
    } else {
      this.step = -1;
    }
  }

  // One line for the panel, the costliest first.
  summary(): string {
    if (this.results.length === 0) return "";
    const parts = [...this.results].sort((a, b) => b.ms - a.ms).map((r) => `${r.name} ${r.ms.toFixed(1)}`);
    return `${parts.join(", ")} ms (all on: ${this.baselineMs.toFixed(1)} ms)`;
  }

  private begin(step: number): void {
    this.step = step;
    this.elapsed = 0;
    this.sampling = false;
  }
}
