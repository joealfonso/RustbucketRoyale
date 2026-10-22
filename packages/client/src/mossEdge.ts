// Where the world material grows moss (look.json world.moss): on what faces up, in noise patches. The patch threshold
// rises with how upward a surface faces, from nothing at `minUp` to the full `cover` `soft` further up, so on a
// smooth-shaded stone the moss thins out raggedly down its shoulders and follows the form, instead of stopping at
// one hard line (or, on faceted stone, filling whole facets like a pasted-on cap). Flat tops (facing straight up)
// get the full cover as before. The shader (toonMaterial.ts) runs the same sum as `mossThreshold`.

export interface MossLook {
  color: string;
  dark: string; // the rim round each patch
  scale: number; // patches per metre
  cover: number; // share of the noise range that is moss on a flat top
  rim: number; // how wide the dark rim is, in noise units
  minUp: number; // no moss on anything facing less upward than this (the normal's y)
  soft: number; // how far above minUp the moss reaches its full cover
}

export function parseMoss(raw: unknown): MossLook {
  const m = raw as MossLook;
  const ok = m && typeof m.color === "string" && typeof m.dark === "string" && m.scale > 0 && m.cover >= 0 && m.cover <= 1
    && m.rim >= 0 && m.minUp > -1 && m.minUp < 1 && m.soft > 0 && m.minUp + m.soft <= 1;
  if (!ok) throw new Error("look.json: world.moss needs color, dark, scale above 0, cover 0 to 1, rim 0 or more, and minUp plus soft (above 0) at most 1");
  return m;
}

// The noise value under which a point facing `up` (its normal's y) is moss.
export function mossThreshold(up: number, moss: MossLook): number {
  const t = Math.min(1, Math.max(0, (up - moss.minUp) / moss.soft));
  return moss.cover * t * t * (3 - 2 * t); // GLSL's smoothstep
}

// What a point shows: moss, its dark rim, or its own paint (null), for noise `n` at a point facing `up`.
export function mossAt(n: number, up: number, moss: MossLook): "moss" | "dark" | null {
  const edge = mossThreshold(up, moss);
  if (!(n < edge)) return null;
  return n > edge - moss.rim ? "dark" : "moss";
}

// The same as GLSL, for a fragment with world normal `vWorldN` and noise `n`, writing `diffuseColor`.
export function mossGlsl(moss: MossLook): string {
  const f = (v: number) => v.toFixed(3);
  return `float mossEdge = ${f(moss.cover)} * smoothstep(${f(moss.minUp)}, ${f(moss.minUp + moss.soft)}, vWorldN.y);
              if (n < mossEdge) diffuseColor.rgb = n > mossEdge - ${f(moss.rim)} ? mossDark : mossColor;`;
}
