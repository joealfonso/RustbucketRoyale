import * as THREE from "three";
import paintJson from "../../../../data/paint.json";
import { groundDetail, type GroundDetail } from "./groundDetail";
import type { AtlasReply } from "./atlasWorker";
import { atlasLayers, buildPaintAtlas, type AtlasLayer, type PaintAtlas } from "./paintAtlas";
import { paintSurface, type PaintSurface } from "./paintChunk";
import { parsePaintLook, type PaintLook, type SurfaceKind } from "./paintLook";

// The painted atlas as one GPU texture (a 2D array: one layer per material and variant, so each layer repeats on its
// own and no neighbour bleeds into it at small mip levels) and the shader settings that read it. Made once and shared
// by every material, like the toon ramp. Painted at load from the seed, no download at all, in a worker (atlasWorker.ts)
// because it takes a few hundred milliseconds at tileSize 1024. Until it arrives every layer is one plain pixel that
// marks nothing, so surfaces show their toon colour for that moment. Where there is no Worker (tests, Node tools)
// it is painted right here instead.

export class PaintKit {
  readonly texture: THREE.DataArrayTexture;
  // How long the painting took (in the worker, so not time the page stood still), 0 until it is done.
  buildMs = 0;
  private surfaces = new Map<string, PaintSurface>();
  private detail: GroundDetail | null = null;

  constructor(private color: (name: string) => string, readonly look: PaintLook = parsePaintLook(paintJson)) {
    const layers = atlasLayers(look);
    this.texture = new THREE.DataArrayTexture(blankLayers(layers), 1, 1, layers.length);
    this.texture.format = THREE.RGBAFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = look.anisotropy;
    this.texture.needsUpdate = true;
    if (typeof Worker === "undefined") {
      const started = performance.now();
      this.fill(buildPaintAtlas(look), performance.now() - started);
      return;
    }
    const worker = new Worker(new URL("./atlasWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<AtlasReply>) => {
      worker.terminate();
      this.fill(event.data.atlas, event.data.ms);
    };
    worker.onerror = (event) => {
      worker.terminate();
      console.error("paint atlas worker failed, painting on the main thread instead", event.message);
      const started = performance.now();
      this.fill(buildPaintAtlas(look), performance.now() - started);
    };
    worker.postMessage(look);
  }

  // Swaps the painted pixels in. Disposing first makes three allocate the GPU texture again at the new size; every
  // material keeps the same texture object, so nothing else changes.
  private fill(atlas: PaintAtlas, ms: number): void {
    this.texture.dispose();
    Object.assign(this.texture.image, { data: atlas.data, width: atlas.size, height: atlas.size, depth: atlas.layers.length });
    this.texture.needsUpdate = true;
    this.buildMs = ms;
  }

  // The settings for one kind of surface. `edges` for unit boxes only (see PaintSurface).
  surface(kind: SurfaceKind, edges = false): PaintSurface {
    const key = `${kind}${edges ? "-edges" : ""}`;
    let s = this.surfaces.get(key);
    if (!s) {
      s = paintSurface(this.look, kind, this.texture, this.color, edges);
      this.surfaces.set(key, s);
    }
    return s;
  }

  ground(): GroundDetail {
    this.detail ??= groundDetail(this.look, this.texture);
    return this.detail;
  }

  // Off pulls every fade in to nothing, so the plain toon colours show, for comparing on the style page (key P).
  setShown(on: boolean): void {
    const { fade, ground } = this.look;
    for (const s of this.surfaces.values()) {
      (s.uniforms.paintFade!.value as THREE.Vector2).set(on ? fade.startMeters : 0, on ? fade.endMeters : 1e-4);
      (s.uniforms.paintFarTone!.value as THREE.Vector2).y = on ? this.look.farTone.strength : 0;
    }
    (this.ground().uniforms.detailFade!.value as THREE.Vector2).set(on ? ground.fade.startMeters : 0, on ? ground.fade.endMeters : 1e-4);
  }

  // GPU memory once painted: every layer and its mip chain (a third more).
  get bytes(): number {
    const { tileSize } = this.look;
    return Math.round((tileSize * tileSize * 4 * this.texture.image.depth * 4) / 3);
  }

  dispose(): void {
    this.texture.dispose();
  }
}

// One pixel a layer that marks nothing: shade at the middle, no rust, grime or wear; for the ground layer every
// channel at the middle, which leaves the ground alone (groundTile.ts).
function blankLayers(layers: readonly AtlasLayer[]): Uint8Array {
  const data = new Uint8Array(layers.length * 4);
  layers.forEach((layer, i) => data.set(layer.name === "ground" ? [128, 128, 128, 128] : [128, 0, 0, 0], i * 4));
  return data;
}
