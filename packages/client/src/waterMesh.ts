import * as THREE from "three";
import type { Box, Terrain } from "@rustbucket/shared";
import { freeze } from "./freeze";
import { seaRing, seaRingIndex } from "./terrainMesh";
import { waterLook, type WaterLook } from "./waterLook";
import { WaterWakes } from "./waterWakes";

// The water surface: one flat mesh at the map's water level over every terrain cell that dips under it, in one draw
// call. Each corner carries how deep the water is over the ground there (negative where the ground is above it).
// The quads are split the same way as Terrain.heightAt, so that depth runs exactly like the real depth across each
// triangle: the shoreline is where it crosses zero, and the toon bands (shore, main, deep) follow the bed's contours.
// Past the shoreline the water is cut away, so it never lies over dry ground.

// The geometry for a map's water, or null on a dry map. Only cells with a corner under the water are in it. On an
// island the sea also runs `seaMeters` on past the map's edge, at the edge's depth (terrainMesh.ts seaRing).
export function waterGeometry(terrain: Terrain, seaMeters = 0): THREE.BufferGeometry | null {
  const level = terrain.waterLevel;
  if (!Number.isFinite(level)) return null;
  const n = terrain.corners - 1, half = terrain.meters / 2, cell = terrain.cell;
  const wet = (i: number, j: number) => terrain.corner(i, j) < level;
  const vertexOf = new Int32Array(terrain.corners * terrain.corners).fill(-1);
  let vertices = 0, quads = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!(wet(i, j) || wet(i + 1, j) || wet(i, j + 1) || wet(i + 1, j + 1))) continue;
      quads++;
      for (const [ci, cj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]] as const) {
        const k = cj * terrain.corners + ci;
        if (vertexOf[k]! < 0) vertexOf[k] = vertices++;
      }
    }
  }
  if (quads === 0) return null;
  // Every corner on an island's edge is under the sea, so each already has a vertex for the ring to start from.
  const ring = terrain.island && seaMeters > 0 ? seaRing(terrain, seaMeters) : null;
  const inMap = vertices;
  if (ring) vertices += ring.corners.length;
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), depths = new Float32Array(vertices);
  for (let k = 0; k < vertexOf.length; k++) {
    const v = vertexOf[k]!;
    if (v < 0) continue;
    const i = k % terrain.corners, j = Math.floor(k / terrain.corners);
    positions[v * 3] = i * cell - half; positions[v * 3 + 1] = level; positions[v * 3 + 2] = j * cell - half;
    normals[v * 3 + 1] = 1;
    depths[v] = level - terrain.corner(i, j);
  }
  const ringIndex: number[] = [];
  if (ring) {
    ring.corners.forEach((k, r) => {
      const v = inMap + r;
      positions[v * 3] = ring.far[r]![0]; positions[v * 3 + 1] = level; positions[v * 3 + 2] = ring.far[r]![1];
      normals[v * 3 + 1] = 1;
      depths[v] = depths[vertexOf[k]!]!;
    });
    seaRingIndex(ring.corners.length, (r) => vertexOf[ring.corners[r]!]!, (r) => inMap + r, ringIndex);
  }
  const index = vertices > 65535 ? new Uint32Array(quads * 6 + ringIndex.length) : new Uint16Array(quads * 6 + ringIndex.length);
  index.set(ringIndex, quads * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = vertexOf[j * terrain.corners + i]!, b = vertexOf[j * terrain.corners + i + 1]!;
      const d = vertexOf[(j + 1) * terrain.corners + i]!, e = vertexOf[(j + 1) * terrain.corners + i + 1]!;
      if (a < 0 || b < 0 || d < 0 || e < 0 || !(wet(i, j) || wet(i + 1, j) || wet(i, j + 1) || wet(i + 1, j + 1))) continue;
      // Faces up, split along b-d, as terrainMesh.ts and Terrain.heightAt do.
      index[q++] = a; index[q++] = d; index[q++] = b;
      index[q++] = e; index[q++] = b; index[q++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("waterDepth", new THREE.BufferAttribute(depths, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const f = (n: number) => n.toFixed(4);

// The surface's colour and see-through for this spot (gate V11): by depth, with the drifting streaks and glints, the
// sky's hue on the far water and foam along the bank. Same sin-free hash as the ground, for the same reason: sin()
// of large world coordinates differs between graphics cards. Every step is hard, so it stays flat toon colour.
export function waterShaderCode(look: WaterLook["surface"]): string {
  const { shallow, deep, deeper, ragged, streaks, glints, sky, foam, wakes, sunGlint } = look;
  const ripple2 = sunGlint.ripple;
  const angle = (streaks.angleDegrees * Math.PI) / 180;
  const ripple = foam.ripple;
  const skySteps = sky.steps.map((t) => `if (facing < ${f(t.facingBelow)}) toSky = ${f(t.amount)};`).join("\n      ");
  return `
    {
      // Slopes first: derivatives are only sure to be right before any pixel of the quad is discarded.
      vec2 wp = vWaterPos.xz;
      vec2 px = dFdx(wp), py = dFdy(wp);
      float dx = dFdx(vWaterDepth), dy = dFdy(vWaterDepth);
      if (vWaterDepth <= 0.0) discard;
      float pixel = length(abs(px) + abs(py)); // metres across a pixel, as fwidth would give
      float n = wNoise(wp * ${f(ragged.scale)});
      float depth = vWaterDepth + (n - 0.5) * ${f(ragged.meters * 2)};
      // Metres from the bank: the depth runs straight across each triangle, so its slope over the ground says how
      // far away it reaches zero. Flat beds have no slope and are far from any bank.
      float det = px.x * py.y - px.y * py.x;
      vec2 grad = abs(det) > 1e-12 ? vec2(dx * py.y - dy * px.y, dy * px.x - dx * py.x) / det : vec2(0.0);
      float bank = vWaterDepth / max(length(grad), 1e-4) + (n - 0.5) * ${f(foam.raggedMeters * 2)};

      // Long thin light streaks drifting along their length: one contour line of a long stretched noise, so they wander
      // like wind lines. Dropped once they would be thinner than a pixel, before they shimmer.
      vec2 sp = vec2(wp.x * ${f(Math.cos(angle))} + wp.y * ${f(Math.sin(angle))}, -wp.x * ${f(Math.sin(angle))} + wp.y * ${f(Math.cos(angle))});
      sp.x += waterTime * ${f(streaks.driftMetersPerSecond)};
      float streak = wNoise(vec2(sp.x * ${f(streaks.scale / streaks.stretch)}, sp.y * ${f(streaks.scale)}) + 19.0);
      // Broken where the still ragged noise is low, so they come and go in pieces as they drift.
      bool lit = abs(streak - ${f(streaks.level)}) < ${f(streaks.thickness / 2)} && n > ${f(streaks.gapsBelow)} && pixel < ${f(streaks.thickness / streaks.scale)};

      // Glints: at most one short dash per cell, somewhere in it, swelling and shrinking on the cell's own beat.
      vec2 gp = sp / ${f(glints.cellMeters)};
      vec2 cell = floor(gp);
      vec2 offset = (vec2(wHash(cell + 3.1), wHash(cell + 5.7)) - 0.5) * ${f(glints.cellMeters - glints.lengthMeters)};
      vec2 gl = (fract(gp) - 0.5) * ${f(glints.cellMeters)} - offset;
      float beat = fract(waterTime / ${f(glints.seconds)} + wHash(cell + 11.3) * 13.0) / ${f(Math.max(glints.share, 1e-4))};
      float swell = 1.0 - abs(2.0 * beat - 1.0);
      bool glint = beat < 1.0 && abs(gl.x) < ${f(glints.lengthMeters / 2)} * swell && abs(gl.y) < ${f(glints.widthMeters / 2)} * swell && pixel < ${f(glints.widthMeters)};

      // The depth bands, each edge turning over about a pixel of the depth's change on screen: hard, never stepped.
      float aa = (abs(dx) + abs(dy)) * ${f(look.bandSoftPixels / 2)} + 1e-5;
      vec3 c = mix(waterMain, waterDeep, smoothstep(${f(deep.aboveMeters)} - aa, ${f(deep.aboveMeters)} + aa, depth));
      c = mix(c, waterDeeper, smoothstep(${f(deeper.aboveMeters)} - aa, ${f(deeper.aboveMeters)} + aa, depth));
      float shoal = 1.0 - smoothstep(${f(shallow.belowMeters)} - aa, ${f(shallow.belowMeters)} + aa, depth);
      float alpha = mix(${f(look.opacity)}, ${f(shallow.opacity)}, shoal);
      c = mix(lit ? waterStreak : c, waterShallow, shoal);

      // The flatter the look, the more of the sky's hue. The hemisphere light's sky colour is each preset's sky.
      vec3 toEye = cameraPosition - vWaterPos;
      vec2 rp = vec2(wp.x, wp.y + waterTime * ${f(sky.ripple.driftMetersPerSecond)}) * ${f(sky.ripple.scale)} + 43.0;
      float facing = toEye.y / length(toEye) + (wNoise(rp) - 0.5) * ${f(sky.ripple.facing * 2)};
      float toSky = 0.0;
      ${skySteps}
      #if NUM_HEMI_LIGHTS > 0
        vec3 skyLight = hemisphereLights[0].skyColor;
        c = mix(c, skyLight / max(max(skyLight.r, max(skyLight.g, skyLight.b)), 1e-4) * ${f(sky.lightness)}, toSky);
      #endif
      if (glint && depth >= ${f(shallow.belowMeters)}) c = waterGlint;

      // The sun's glint: a path of short light dashes on the water running from you toward the sun, as sunlight
      // glitters off a rippled sea. Painted, not reflected: a band pathDegrees either side of the sun's bearing,
      // cut from a noise stretched along the streaks where it rises over level, more of it toward the path's middle.
      vec2 away = wp - cameraPosition.xz;
      vec2 sunWay = waterSun.xz / max(length(waterSun.xz), 1e-4);
      float bearing = dot(away, sunWay) / max(length(away), 1e-4);
      float pathIn = (bearing - ${f(Math.cos((sunGlint.pathDegrees * Math.PI) / 180))}) / ${f(1 - Math.cos((sunGlint.pathDegrees * Math.PI) / 180))};
      vec2 gr = vec2(sp.x * ${f(ripple2.scale / ripple2.stretch)}, sp.y * ${f(ripple2.scale)}) + vec2(waterTime * ${f(ripple2.driftMetersPerSecond * ripple2.scale)}, 71.0);
      float dash = wNoise(gr);
      float dashLevel = mix(1.0, ${f(sunGlint.level)}, clamp(pathIn, 0.0, 1.0));
      if (waterSunOn > 0.5 && pathIn > 0.0 && depth >= ${f(shallow.belowMeters)} && dash > dashLevel && pixel < ${f(0.5 / ripple2.scale)}) c = waterSunGlint;

      // Foam along the bank, and a thin ripple rolling in to it, swelling then thinning as it comes, a little later
      // or sooner along each stretch of bank.
      float wave = fract(waterTime / ${f(ripple.seconds)} + n * ${f(ripple.unevenShare)});
      float ringHalf = ${f(ripple.widthMeters)} * min(wave, 1.0 - wave);
      bool ring = abs(bank - ${f(foam.meters)} - ${f(ripple.fromMeters)} * (1.0 - wave)) < ringHalf && ringHalf * 2.0 > pixel;
      // Never thinner than a pixel, so far off it is a steady light line round the water, not a flicker.
      if (bank < max(${f(foam.meters)}, pixel) || ring) { c = waterFoam; alpha = ${f(foam.opacity)}; }

      // Foam round what stands in the water (waterWakes.ts): the distance to the nearest shape's edge, ragged like
      // the bank's foam, a band beside it and a ring swelling out from it. Skipped past nearMeters from the camera.
      #if WATER_WAKES > 0
      if (waterWakeCount > 0.5 && length(wp - cameraPosition.xz) < ${f(wakes.nearMeters)}) {
        float edge = 1e4;
        for (int k = 0; k < WATER_WAKES; k++) {
          if (float(k) >= waterWakeCount) break;
          vec4 w = waterWakes[k];
          float d;
          if (w.z < 0.0) d = length(wp - w.xy) + w.z;
          else {
            float r = min(min(w.z, w.w), ${f(wakes.cornerMeters)});
            vec2 e = abs(wp - w.xy) - (w.zw - r);
            d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
          }
          edge = min(edge, d);
        }
        // A finer, drifting noise than the bank's: these shapes are only a metre or two across.
        float wn = wNoise(wp * ${f(wakes.raggedScale)} + waterTime * 0.3);
        edge += (wn - 0.5) * ${f(wakes.raggedMeters * 2)};
        float wakeBeat = fract(waterTime / ${f(wakes.ring.seconds)});
        float wakeHalf = ${f(wakes.ring.widthMeters / 2)} * (1.0 - wakeBeat);
        bool wakeRing = abs(edge - ${f(wakes.meters)} - ${f(wakes.ring.fromMeters)} * wakeBeat) < wakeHalf && wakeHalf * 2.0 > pixel && wn > ${f(wakes.ring.gapsBelow)};
        if ((edge > -0.05 && edge < max(${f(wakes.meters)}, pixel)) || wakeRing) { c = waterFoam; alpha = ${f(foam.opacity)}; }
      }
      #endif
      diffuseColor.rgb = c;
      diffuseColor.a = alpha;
    }`;
}

const WATER_GLSL = `
  float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
  }`;

// The water's material: the toon bands (so it is lit like the ground under every light preset, and fogged the same),
// no rim, no gloss, the colour and see-through picked per spot. Mostly a touch see-through, so wading legs sink into
// it; more so in the shallows, where the muddy bed shows and the bank meets it softly.
// `live` holds what changes while playing: the clock, the sun's direction and whether it glints, and the foam shapes.
export interface WaterLive {
  time: { value: number };
  sun: { value: THREE.Vector3 };
  sunOn: { value: number };
  wakes: { value: Float32Array };
  wakeCount: { value: number };
}

export function waterLive(maxWakes: number): WaterLive {
  return {
    time: { value: 0 }, sun: { value: new THREE.Vector3(0, 1, 0) }, sunOn: { value: 0 },
    wakes: { value: new Float32Array(Math.max(maxWakes, 1) * 4) }, wakeCount: { value: 0 },
  };
}

export function waterMaterial(look: WaterLook["surface"], ramp: THREE.Texture, color: (name: string) => string, live: WaterLive): THREE.MeshToonMaterial {
  const seeThrough = Math.min(look.opacity, look.shallow.opacity, look.foam.opacity) < 1;
  const m = new THREE.MeshToonMaterial({ color: color(look.main), gradientMap: ramp, transparent: seeThrough, opacity: look.opacity });
  // Pulled a hair toward the camera, so where it meets the shore the water wins instead of flickering with the ground.
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -1;
  const colors: Record<string, string> = {
    waterMain: look.main, waterShallow: look.shallow.color, waterDeep: look.deep.color, waterStreak: look.streaks.color,
    waterGlint: look.glints.color, waterFoam: look.foam.color, waterDeeper: look.deeper.color, waterSunGlint: look.sunGlint.color,
  };
  const code = waterShaderCode(look);
  m.onBeforeCompile = (shader) => {
    for (const [name, value] of Object.entries(colors)) shader.uniforms[name] = { value: new THREE.Color(color(value)) };
    shader.uniforms.waterTime = live.time;
    shader.uniforms.waterSun = live.sun;
    shader.uniforms.waterSunOn = live.sunOn;
    shader.uniforms.waterWakes = live.wakes;
    shader.uniforms.waterWakeCount = live.wakeCount;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float waterDepth;\nvarying float vWaterDepth;\nvarying vec3 vWaterPos;\nvoid main() {")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vWaterDepth = waterDepth;
        vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    const declarations = Object.keys(colors).map((name) => `uniform vec3 ${name};`).join("\n");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `#define WATER_WAKES ${look.wakes.max}\nvarying float vWaterDepth;\nvarying vec3 vWaterPos;\nuniform float waterTime;\nuniform vec3 waterSun;\nuniform float waterSunOn;\nuniform vec4 waterWakes[${Math.max(look.wakes.max, 1)}];\nuniform float waterWakeCount;\n${declarations}\n${WATER_GLSL}\nvoid main() {`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${code}`);
  };
  m.customProgramCacheKey = () => "toon-water";
  return m;
}

// Streaks, glints and ripples drift for this long and then start over, so the time stays small enough for float precision.
const TIME_WRAP_SECONDS = 3600;

// The water of the current map. The material is made once; a new map only swaps the geometry and the boxes standing
// in it. Each frame: `wakes.begin()`, `wakes.addCircle` for every wading mech, then `update`.
export class WaterMesh {
  readonly mesh: THREE.Mesh;
  readonly wakes: WaterWakes;
  private live: WaterLive;

  constructor(scene: THREE.Scene, private look: WaterLook["surface"], ramp: THREE.Texture, color: (name: string) => string, private seaMeters = waterLook.sea.outMeters) {
    this.live = waterLive(look.wakes.max);
    this.wakes = new WaterWakes(look.wakes.max, look.wakes.nearMeters);
    if (look.wakes.max > 0) this.live.wakes.value = this.wakes.shapes; // with none, the uniform keeps one unused shape
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), waterMaterial(look, ramp, color, this.live));
    this.mesh.visible = false;
    this.mesh.renderOrder = 1; // after the opaque world, like any see-through surface
    freeze(this.mesh);
    scene.add(this.mesh);
  }

  // The map's terrain, or null for none (the range), and its boxes, for the foam round those standing in the water.
  // Dry maps draw nothing.
  setTerrain(terrain: Terrain | null, boxes: readonly Box[] = []): void {
    this.mesh.geometry.dispose();
    const geometry = terrain ? waterGeometry(terrain, this.seaMeters) : null;
    this.mesh.geometry = geometry ?? new THREE.BufferGeometry();
    this.mesh.visible = geometry !== null;
    this.wakes.setStill(geometry ? boxes : [], terrain);
  }

  // The light preset's sun: `toSun` is kept and read every frame (Toon changes it in place); `keyShadow` is how firm
  // its shadows are, and a hazy sun leaves no glint.
  useSun(toSun: THREE.Vector3, keyShadow: number): void {
    this.live.sun.value = toSun;
    this.live.sunOn.value = keyShadow >= this.look.sunGlint.minSunShadow ? 1 : 0;
  }

  // The clock, and the frame's foam shapes (after the mechs were added) with the nearest still ones round the camera.
  update(dt: number, cameraX: number, cameraZ: number): void {
    this.live.time.value = (this.live.time.value + dt) % TIME_WRAP_SECONDS;
    this.wakes.finish(cameraX, cameraZ);
    this.live.wakeCount.value = this.wakes.count;
  }
}
