import * as THREE from "three";
import type { Toon } from "../toonMaterial";
import { box, merge, turn, type MeshData } from "../dressing/shapes";

// Painted text in the hangar (bay numbers, the loading bay, the AEGIS DYNAMICS name), hand set in the decal font
// (Big Shoulders Stencil, DESIGN.md) on a canvas, and laid on as a flat quad lit like the surface under it.

// Waits for the decal font, so the first text drawn is not in a fallback face. Gives up quietly: real text in a
// fallback face beats no text.
export async function decalFontReady(font: string): Promise<void> {
  try { await document.fonts.load(font); } catch { /* the canvas falls back to the next face */ }
}

// A quad `height` metres tall carrying `text`, its width from the text, centred on its origin, facing +z.
// Painted text is lit like the surface under it; `light` text is projected light on a hologram, added over it.
export function textDecal(toon: Toon, text: string, font: string, height: number, color: string, light = false): THREE.Mesh {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  context.font = font;
  const pixelHeight = Number(/(\d+)px/.exec(font)?.[1] ?? 128);
  const pad = Math.round(pixelHeight * 0.12);
  canvas.width = Math.ceil(context.measureText(text).width) + pad * 2;
  canvas.height = Math.ceil(pixelHeight * 1.05) + pad * 2;
  context.font = font; // resizing the canvas resets it
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  context.fillText(text, pad, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Its own material: the colour times the white letters, cut out (or, as light, adding nothing) where there are none.
  const material = light
    ? new THREE.MeshBasicMaterial({ color: toon.color(color), map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    : toon.ownMaterial(color);
  if (!light) {
    material.map = texture;
    material.alphaTest = 0.5;
  }
  const width = height * (canvas.width / canvas.height);
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

// The Aegis Dynamics mark: a triangle drawn as three bars, with a crossbar that makes it read as an A. `size` is
// its height; it stands on y = 0, centred on x, as raised plate a few centimetres proud of the wall.
export function aegisMark(size: number): MeshData {
  const bar = size * 0.13, depth = 0.08;
  const side = size / Math.cos(Math.PI / 6);
  const half = size * Math.tan(Math.PI / 6);
  const leg = (sign: number) => turn(box([0, 0, 0], [bar, side, depth]), [0, 0, sign * Math.PI / 6], [0, 0, 0], [sign * half / 2, size / 2, 0]);
  return merge(
    leg(-1), leg(1),
    box([0, bar / 2, 0], [half * 2 + bar, bar, depth]),
    box([0, size * 0.42, 0], [half * 0.95, bar * 0.8, depth]),
  );
}
