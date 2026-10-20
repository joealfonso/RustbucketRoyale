import * as THREE from "three";

// The sun in the toon look (V7a): how the key light and its shadow map land on every MeshToonMaterial (the master
// material, the ground, the water) with no work per material: two of Three's shader chunks are swapped once, before
// anything compiles, the way haze.ts swaps the fog.
// - Anything in the darkest band is in shadow, whether it is turned away from the sun or something stands between
//   it and the sun. Cast shadows therefore fall in the same flat band as the shadow side of a box, never darker.
// - The shadow band is lit by the sun's colour turned toward the sky's hue (the hemisphere light's sky colour, so
//   each light preset gets its own cool shadows with nothing per preset): cool soot shadows (DESIGN.md, Lighting).
// - The shadow test is one hardware-filtered sample, cut at one half: a hard edge that follows the shadow's shape
//   between texels instead of stepping, softened over a pixel or so by `edge`.
// - The shadow map follows the camera (sunShadows.ts), so toward its rim the shadows fade out (`fadeFrom`, a share
//   of its radius) and its edge never shows as a line on the ground.
// Other lights (an explosion's flash) light the bands as before. Materials other than toon keep Three's own code.

export interface ToonLightLook {
  edge: number; // half the width of the band edge, in shadow-test units: 0 is a hard step, 0.5 the whole filter
  fadeFrom: number; // share of the shadow map's radius where shadows start to fade out, 0 to 1
  skyTint: number; // how far the shadow band's light turns toward the sky's hue, 0 to 1
}

const f = (n: number) => n.toFixed(4);

// Three's own lines this file replaces. Checked when installing, so a Three upgrade that changes them fails loudly
// instead of quietly drawing no shadows.
const SUN_INFO = "getDirectionalLightInfo( directionalLight, directLight );";
const SUN_SHADOW = "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";
const TOON_DIRECT = "vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;";

// The toon lighting functions, with the sun's shadow band. `toonSun` is raised by lights_fragment_begin just before
// the directional light is applied and lowered again here, so only that light gets the shadow treatment.
export function toonParsChunk(look: ToonLightLook, original: string = THREE.ShaderChunk.lights_toon_pars_fragment): string {
  if (!original.includes(TOON_DIRECT)) throw new Error("toonLight: three's toon lighting chunk changed, update toonLight.ts");
  const helpers = `
float toonSun = 0.0;
float toonSunLit = 1.0;
float toonBand( float coord ) {
	#ifdef USE_GRADIENTMAP
		return texture2D( gradientMap, vec2( coord, 0.0 ) ).r;
	#else
		return coord < 0.7 ? 0.7 : 1.0;
	#endif
}
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
		float band = toonBand( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
		float darkest = toonBand( 0.0 );
		float lit = toonSunLit * step( darkest + 0.001, band );
		vec3 shade = directLight.color;
		#if NUM_HEMI_LIGHTS > 0
			vec3 sky = hemisphereLights[ 0 ].skyColor;
			float keyBright = max( shade.r, max( shade.g, shade.b ) );
			shade = mix( shade, sky / max( max( sky.r, max( sky.g, sky.b ) ), 1e-4 ) * keyBright, ${f(look.skyTint)} );
		#endif
		irradiance = mix( darkest * shade, band * directLight.color, lit );
		toonSun = 0.0;
	} else {
		irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	}`;
  return original.replace("struct ToonMaterial {", `${helpers}\nstruct ToonMaterial {`).replace(TOON_DIRECT, sun);
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

let installed: string | null = null;

// Swaps the chunks. Every page builds its Toon before anything compiles, and every Toon reads the same look.json,
// so a second install with the same numbers does nothing and one with different numbers is a mistake.
export function installToonLight(look: ToonLightLook): void {
  const key = JSON.stringify([look.edge, look.fadeFrom, look.skyTint]);
  if (installed === key) return;
  if (installed !== null) throw new Error("toonLight: the sun's shadow look is baked into shaders, set it once");
  THREE.ShaderChunk.lights_toon_pars_fragment = toonParsChunk(look);
  THREE.ShaderChunk.lights_fragment_begin = lightsBeginChunk();
  installed = key;
}
