import { describe, expect, it } from "vitest";
import renderJson from "../../../data/render.json";
import { RenderScale, parseRenderScale } from "./renderScale";

const config = parseRenderScale(renderJson);
const run = (scale: RenderScale, seconds: number, frameMs: number, gpuMs: number) => {
  let changed = 0;
  for (let t = 0; t < seconds; t += 1 / 60) if (scale.due(1 / 60) && scale.decide(frameMs, gpuMs)) changed++;
  return changed;
};

describe("render scale", () => {
  it("starts below a Retina screen's full ratio, and never above the screen's own", () => {
    expect(new RenderScale(config, 2).ratio).toBe(config.startPixelRatio);
    expect(new RenderScale(config, 1).ratio).toBe(1);
  });

  it("steps down while frames are missed, to the floor and no further", () => {
    const scale = new RenderScale(config, 2);
    run(scale, 30, 25, 20);
    expect(scale.ratio).toBe(config.minPixelRatio);
  });

  it("steps back up only after the graphics card has had room for a while", () => {
    const scale = new RenderScale(config, 2);
    run(scale, config.raiseAfterSeconds - 1.5, 16.7, 4);
    expect(scale.ratio).toBe(config.startPixelRatio);
    run(scale, 30, 16.7, 4);
    expect(scale.ratio).toBe(2);
  });

  it("never raises without a GPU timer to say there is room", () => {
    const scale = new RenderScale(config, 2);
    run(scale, 30, 16.7, 0);
    expect(scale.ratio).toBe(config.startPixelRatio);
  });
});
