import * as THREE from "three";

// The sun in the toon look (V7a): how the key light and its shadow map land on every MeshToonMaterial (the master
// material, the ground, the water) with no work per material: two of Three's shader chunks are swapped once, before
// anything compiles, the way haze.ts swaps the fog.
// - Anything in the darkest band is in shadow, whether it is turned away from the sun or something stands between
//   it and the sun. Cast shadows therefore fall in the same flat band as the shadow side of a box, never darker.
// - The three bands are worked out in the shader, not read from a texture (V14): each edge is a step over about
//   `edgePixels` pixels of the light term's change on screen, so a terminator is sharp at any distance but never
//   stair-stepped, and on a far curved part, where the light term changes fast, the bands blend instead of shimmering.
// - Shadow colour, not darkness: the shadow band is lit by the sun's colour turned toward the sky's hue (the
//   hemisphere light's sky colour) and the middle band a little, by how much the light preset says (`setToonShade`):
//   warm light, cool shadow (DESIGN.md, Lighting).
// - The shadow test is one hardware-filtered sample, cut at one half: a hard edge that follows the shadow's shape
//   between texels instead of stepping, softened over a pixel or so by `edge`.
// - The shadow map follows the camera (sunShadows.ts), so toward its rim the shadows fade out (`fadeFrom`, a share
//   of its radius) and its edge never shows as a line on the ground.
// Other lights (an explosion's flash) light the bands from the bands texture as before. Materials other than toon
// keep Three's own code.
// - Finishes (gate V9, toonMaterial.ts): a material may set `toonEdges` and `toonLevels` before the lights for bands
//   of its own (bare metal, rubber), and `toonGlintSize` to have the sun leave one hard highlight on bare metal
//   (V16b): a flat stripe along the line where a curved part turns most toward the sun, `toonGlintSize` the sine of
//   how far round the curve it reaches either side. `toonGlint` is 1 inside the shape, 0 outside, and `toonGlintLight`
//   the sun's hue. The shape only sits in the top band, so it is always on the lit side, and only where the surface
//   bends at least `toonGlintBend` (normal change per metre): a piston gets a hard stripe, a big flat plate never
//   flashes white all over. It follows the sun, not the eye, so it stays put as the camera swings round a mech. `toonSunSide` says afterwards how far the sun lights the
//   pixel, for the rim.
// - Painted shadows (V16b): a material may set `toonBrush` (a brush mark's brightness, 0 for none, from the painted
//   atlas) and `toonBrushNear` (1 near, 0 once the atlas has faded). Only where the sun does not reach, the shadow
//   band, the light is raised or lowered by that mark (look.json shadowBrush), so the lit bands stay clean.

export interface ToonLightLook {
  edge: number; // half the width of the shadow's edge, in shadow-test units: 0 is a hard step, 0.5 the whole filter
  fadeFrom: number; // share of the shadow map's radius where shadows start to fade out, 0 to 1
  bands: number[]; // the three bands' brightness, darkest first
  bandEdges: number[]; // where each band turns into the next, 0 (facing away from the sun) to 1 (facing it)
  edgePixels: number; // how many pixels a band edge takes to turn
  brush: ShadowBrush;
}

// Brush marks in the shadow band (look.json shadowBrush). The atlas's shade channel holds the brush strokes as small
// steps either side of one half (paint/marks.ts brushStrokes); seams, rivets and grain step further. `reach` is the
// largest step still read as a brush mark, so seams do not get louder in the shade. A mark at `reach` changes the
// shadow's light by `strength` of it, lighter or darker.
export interface ShadowBrush {
  strength: number;
  reach: number;
}

export function parseShadowBrush(raw: unknown): ShadowBrush {
  const b = raw as ShadowBrush;
  if (!(b && typeof b.strength === "number" && b.strength >= 0 && b.strength <= 0.5 && typeof b.reach === "number" && b.reach > 0 && b.reach <= 0.5)) {
    throw new Error("look.json: shadowBrush needs strength 0 to 0.5 (it is faint) and reach above 0 to 0.5");
  }
  return b;
}

// How much a brush mark changes the shadow's light: `mark` is the atlas's shade minus one half, `near` the atlas's
// fade, `sunSide` how far the sun lights the pixel (0 in the shadow band). The same sum as the shader, for tests.
export function shadowBrushLight(b: ShadowBrush, mark: number, near: number, sunSide: number): number {
  if (Math.abs(mark) > b.reach) return 0;
  return (mark / b.reach) * b.strength * near * (1 - sunSide);
}

// How far the shadow and middle bands turn toward the sky's hue, 0 to 1 (a light preset's `shade`).
export interface ToonShade {
  shadow: number;
  mid: number;
}

const f = (n: number) => n.toFixed(4);

// Three's own lines this file replaces. Checked when installing, so a Three upgrade that changes them fails loudly
// instead of quietly drawing no shadows.
const SUN_INFO = "getDirectionalLightInfo( directionalLight, directLight );";
const SUN_SHADOW = "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";
const TOON_DIRECT = "vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;";

// The toon lighting functions, with the sun's shadow band. `toonSun` is raised by lights_fragment_begin just before
// the directional light is applied and lowered again here, so only that light gets the shadow treatment.
// The derivatives are taken outside any branch that differs between neighbouring pixels: `toonSun` is the same for
// the whole draw, and the glint's is taken whether the pixel is metal or not.
export function toonParsChunk(look: ToonLightLook, original: string = THREE.ShaderChunk.lights_toon_pars_fragment): string {
  if (!original.includes(TOON_DIRECT)) throw new Error("toonLight: three's toon lighting chunk changed, update toonLight.ts");
  const [dark, mid, top] = look.bands;
  const [low, high] = look.bandEdges;
  const halfWidth = f(look.edgePixels / 2);
  const helpers = `
uniform vec4 toonShade;
float toonSun = 0.0;
float toonSunLit = 1.0;
float toonSunSide = 0.0;
vec2 toonEdges = vec2( ${f(low!)}, ${f(high!)} );
vec3 toonLevels = vec3( ${f(dark!)}, ${f(mid!)}, ${f(top!)} );
float toonGlintSize = 0.0;
float toonGlintBend = 0.0;
float toonGlint = 0.0;
vec3 toonGlintLight = vec3( 0.0 );
float toonBrush = 0.0;
float toonBrushNear = 0.0;
#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF )
float toonShadow( sampler2DShadow map, float intensity, float bias, vec4 coord ) {
	coord.xyz /= coord.w;
	float rim = length( coord.xy - 0.5 ) * 2.0;
	if ( rim >= 1.0 || coord.z > 1.0 ) return 1.0;
	float lit = smoothstep( ${f(0.5 - look.edge)}, ${f(0.5 + look.edge + 1e-4)}, texture( map, vec3( coord.xy, coord.z + bias ) ) );
	return mix( 1.0, lit, intensity * ( 1.0 - smoothstep( ${f(look.fadeFrom)}, 1.0, rim ) ) );
}
#endif
`;
  const sun = `vec3 irradiance;
	if ( toonSun > 0.5 ) {
		float toward = dot( geometryNormal, directLight.direction ) * 0.5 + 0.5;
		float aa = max( fwidth( toward ), 1e-5 ) * ${halfWidth};
		float lit = toonSunLit * smoothstep( toonEdges.x - aa, toonEdges.x + aa, toward );
		float topBand = smoothstep( toonEdges.y - aa, toonEdges.y + aa, toward );
		// The highlight runs along the line where a curved surface turns most toward the sun (a stripe down a piston, a
		// ring round a bezel): there the light term stops rising as the normal turns, so its change over the normal's
		// change, the sine of the turn from that line, is small.
		float facing = dot( geometryNormal, directLight.direction );
		vec3 normalDx = dFdx( geometryNormal ), normalDy = dFdy( geometryNormal );
		float normalTurn = length( normalDx ) + length( normalDy );
		float awayFromPeak = ( abs( dFdx( facing ) ) + abs( dFdy( facing ) ) ) / max( normalTurn, 1e-5 );
		float bendPerMetre = normalTurn / max( length( dFdx( geometryPosition ) ) + length( dFdy( geometryPosition ) ), 1e-5 );
		vec3 key = directLight.color;
		toonGlint = max( toonGlint, lit * topBand * step( 1e-5, toonGlintSize ) * step( toonGlintBend, bendPerMetre ) * ( 1.0 - step( toonGlintSize * max( facing, 0.0 ), awayFromPeak ) ) );
		toonGlintLight = key / max( max( key.r, max( key.g, key.b ) ), 1e-4 );
		toonSunSide = lit;
		vec3 cool = key;
		#if NUM_HEMI_LIGHTS > 0
			vec3 sky = hemisphereLights[ 0 ].skyColor;
			cool = sky / max( max( sky.r, max( sky.g, sky.b ) ), 1e-4 ) * max( key.r, max( key.g, key.b ) );
		#endif
		vec3 shadowLight = toonLevels.x * mix( key, cool, toonShade.x );
		vec3 midLight = toonLevels.y * mix( key, cool, toonShade.y );
		irradiance = mix( shadowLight, mix( midLight, toonLevels.z * key, topBand ), lit );
		toonSun = 0.0;
	} else {
		irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	}`;
  return original.replace("struct ToonMaterial {", `${helpers}\nstruct ToonMaterial {`).replace(TOON_DIRECT, sun);
}

// After every light: the brush marks in the shadow band. Only with a sun; with none `toonSunSide` means nothing.
export function lightsEndChunk(look: ShadowBrush, original: string = THREE.ShaderChunk.lights_fragment_end): string {
  if (!original.includes("RE_IndirectDiffuse(")) throw new Error("toonLight: three's light end code changed, update toonLight.ts");
  return `${original}
#if defined( TOON ) && NUM_DIR_LIGHTS > 0
	{
		float toonMark = toonBrush * step( abs( toonBrush ), ${f(look.reach)} ) * ${f(look.strength / look.reach)} * toonBrushNear * ( 1.0 - toonSunSide );
		reflectedLight.directDiffuse *= 1.0 + toonMark;
		reflectedLight.indirectDiffuse *= 1.0 + toonMark;
	}
#endif
`;
}

export function lightsBeginChunk(original: string = THREE.ShaderChunk.lights_fragment_begin): string {
  if (!original.includes(SUN_INFO) || !original.includes(SUN_SHADOW)) throw new Error("toonLight: three's directional light code changed, update toonLight.ts");
  return original
    .replace(SUN_INFO, `${SUN_INFO}
		#ifdef TOON
		toonSun = 1.0;
		toonSunLit = 1.0;
		#endif`)
    .replace(SUN_SHADOW, `#if defined( TOON ) && defined( SHADOWMAP_TYPE_PCF )
		toonSunLit = directLight.visible ? toonShadow( directionalShadowMap[ i ], directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, vDirectionalShadowCoord[ i ] ) : 1.0;
		#else
		${SUN_SHADOW}
		#endif`);
}

// The shade of the current light preset, one value shared by every toon material: Three copies a material's
// uniforms from its ShaderLib entry when it compiles, but a typed array is copied by reference, so writing these
// four numbers reaches every toon material, the ground, the water and the far ranges with nothing per material.
const shade = new Float32Array(4);

export function setToonShade(s: ToonShade): void {
  shade[0] = s.shadow;
  shade[1] = s.mid;
}

let installed: string | null = null;

// Swaps the chunks. Every page builds its Toon before anything compiles, and every Toon reads the same look.json,
// so a second install with the same numbers does nothing and one with different numbers is a mistake. `first` is
// the shade until a light preset is used (the hangar never uses one).
export function installToonLight(look: ToonLightLook, first: ToonShade): void {
  const key = JSON.stringify([look.edge, look.fadeFrom, look.bands, look.bandEdges, look.edgePixels, look.brush]);
  if (installed === key) return;
  if (installed !== null) throw new Error("toonLight: the sun's shadow look is baked into shaders, set it once");
  THREE.ShaderChunk.lights_toon_pars_fragment = toonParsChunk(look);
  THREE.ShaderChunk.lights_fragment_begin = lightsBeginChunk();
  THREE.ShaderChunk.lights_fragment_end = lightsEndChunk(look.brush);
  THREE.ShaderLib.toon!.uniforms.toonShade = { value: shade };
  setToonShade(first);
  installed = key;
}
