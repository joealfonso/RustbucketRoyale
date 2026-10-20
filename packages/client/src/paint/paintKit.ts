import * as THREE from "three";
import paintJson from "../../../../data/paint.json";
import { groundDetail, type GroundDetail } from "./groundDetail";
import { buildPaintAtlas } from "./paintAtlas";
import { paintSurface, type PaintSurface } from "./paintChunk";
import { parsePaintLook, type PaintLook, type SurfaceKind } from "./paintLook";

// The painted atlas as one GPU texture (a 2D array: one layer per material, so each layer repeats on its own and no
// neighbour bleeds into it at small mip levels) and the shader settings that read it. Made once and shared by every
// material, like the toon ramp. Built at load from the seed (about 35 ms at tileSize 512 on a laptop, measured in Node), no
// download at all.

export class PaintKit {
  readonly texture: THREE.DataArrayTexture;
  readonly buildMs: number;
  private surfaces = new Map<string, PaintSurface>();
  private detail: GroundDetail | null = null;

  constructor(private color: (name: string) => string, readonly look: PaintLook = parsePaintLook(paintJson)) {
    const started = performance.now();
    const atlas = buildPaintAtlas(look);
    this.buildMs = performance.now() - started;
    this.texture = new THREE.DataArrayTexture(atlas.data, atlas.size, atlas.size, atlas.layers.length);
    this.texture.format = THREE.RGBAFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = look.anisotropy;
    this.texture.needsUpdate = true;
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
    for (const s of this.surfaces.values()) (s.uniforms.paintFade!.value as THREE.Vector2).set(on ? fade.startMeters : 0, on ? fade.endMeters : 1e-4);
    (this.ground().uniforms.detailFade!.value as THREE.Vector2).set(on ? ground.fade.startMeters : 0, on ? ground.fade.endMeters : 1e-4);
  }

  // GPU memory: every layer and its mip chain (a third more).
  get bytes(): number {
    const { tileSize } = this.look;
    return Math.round((tileSize * tileSize * 4 * this.texture.image.depth * 4) / 3);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
