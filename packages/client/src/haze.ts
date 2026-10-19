import * as THREE from "three";

// Warm haze in place of Three's fog, for every material that takes fog (toon, world, ground, outlines, props, mechs)
// with no work per material: the four fog shader chunks are swapped once, before anything compiles.
// It reuses the fog uniforms Three already sends each frame: fogColor, and fogNear / fogFar from a THREE.Fog, read
// as "haze starts here" and "ground-level haze is 98% thick here". The haze is thickest at the ground (y = 0, the
// height of every map's edge; valleys dip a little into thicker haze and hilltops rise out of it) and thins with
// height, so tall things far away stay readable and the open ground melts into the sky.
// The thinning rate is one number for the whole game, baked into the shader, because the fog uniforms are all spoken for.

let installedFalloff: number | null = null;

export function installHaze(heightFalloff: number): void {
  if (installedFalloff === heightFalloff) return;
  if (installedFalloff !== null) throw new Error("haze: the height falloff is baked into shaders, set it once");
  installedFalloff = heightFalloff;
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying vec3 vHazeRay;
#endif`;
  // From the camera to this point, in world space. mvPosition is that offset in view space; the view matrix only
  // turns and moves, so turning it back needs only the transpose.
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vHazeRay = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vHazeRay;
#endif`;
  // Density falls off as exp(-falloff * height); `lift` is its average along the ray (1 at the ground, less above,
  // more for a ray heading down). The distance past `near` is squared, so the near field stays clear and the far
  // field closes in quickly. 1.978 = sqrt(ln 50): exactly 98% at `far` for a ray along the ground.
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  float hazeFalloff = ${heightFalloff.toFixed(5)};
  float hazeRise = vHazeRay.y * hazeFalloff;
  float hazeLift = exp(-max(cameraPosition.y, 0.0) * hazeFalloff) * (abs(hazeRise) > 1e-4 ? (1.0 - exp(-hazeRise)) / hazeRise : 1.0);
  float hazeDepth = max(length(vHazeRay) - fogNear, 0.0) * 1.978 / max(fogFar - fogNear, 1.0);
  float fogFactor = 1.0 - exp(-hazeDepth * hazeDepth * hazeLift);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
}
