import { buildPaintAtlas, type PaintAtlas } from "./paintAtlas";
import type { PaintLook } from "./paintLook";

// Paints the atlas off the main thread (paintKit.ts): at tileSize 1024 with two variants it takes a few hundred
// milliseconds, which would freeze the page at load. The pixels go back without a copy.

export interface AtlasReply {
  atlas: PaintAtlas;
  ms: number;
}

self.onmessage = (event: MessageEvent<PaintLook>) => {
  const started = performance.now();
  const atlas = buildPaintAtlas(event.data);
  const reply: AtlasReply = { atlas, ms: performance.now() - started };
  (self as unknown as Worker).postMessage(reply, [atlas.data.buffer]);
};
