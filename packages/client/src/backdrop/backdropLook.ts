import { parseOutlineWidth, type OutlineWidth } from "../outlineWidth";

// How the world beyond the map is drawn (data/look.json, `backdrop`, gate V16a): painted flats with a hard rim of
// light on the slopes that turn from you and a line of ink along their skyline, in a colour darkened from their own,
// never black. The shapes themselves are in data/backdrop.json.

export interface BackdropLook {
  // A rim of the look's rim colour where a surface turns from the camera (`width`, 1 minus the cosine), `strength`
  // strong on the sun's side and `shadeSide` of that on the other. Unlike the master material's rim it never fades
  // with distance: the backdrop is all distance.
  rim: { strength: number; width: number; shadeSide: number };
  // The ink: `darken` is the share of its own on-screen brightness it keeps. `pixels` is how thick the ranges'
  // skyline line is; the scrap heaps and landmarks get a shell outline `outline` wide (outlineWidth.ts).
  ink: { darken: number; pixels: number };
  outline: OutlineWidth;
}

const share = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;

export function parseBackdropLook(raw: unknown): BackdropLook {
  const b = raw as BackdropLook;
  if (!(b?.rim && b.rim.strength >= 0 && share(b.rim.width) && share(b.rim.shadeSide))) throw new Error("look.json: backdrop.rim needs strength 0 or more, width and shadeSide 0 to 1");
  if (!(b.ink && share(b.ink.darken) && b.ink.pixels > 0 && b.ink.pixels <= 6)) throw new Error("look.json: backdrop.ink needs darken 0 to 1 and pixels above 0, at most 6");
  parseOutlineWidth(b.outline, "backdrop.outline");
  return b;
}

// GLSL for the rim, added to `outgoingLight` before <opaque_fragment> in a toon material (it needs `toonSunSide`
// from toonLight.ts, `normal`, `vViewPosition` and `diffuseColor`). `color` is a vec3 expression.
export function backdropRimGlsl(rim: BackdropLook["rim"], color: string): string {
  return `
  {
    float backRimTurn = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
    float backRimAa = max(fwidth(backRimTurn), 1e-5);
    float backRim = smoothstep(${(1 - rim.width).toFixed(3)} - backRimAa, ${(1 - rim.width).toFixed(3)} + backRimAa, backRimTurn) * mix(${rim.shadeSide.toFixed(3)}, 1.0, toonSunSide);
    outgoingLight += ${color} * ${rim.strength.toFixed(3)} * backRim * diffuseColor.rgb;
  }`;
}

// The ink's colour factor in working (linear) light, for a darken that is a share of on-screen brightness.
export const inkFactor = (darken: number) => Math.pow(darken, 2.2);
