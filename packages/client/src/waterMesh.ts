import * as THREE from "three";
import type { Terrain } from "@rustbucket/shared";
import { freeze } from "./freeze";
import { seaRing, seaRingIndex } from "./terrainMesh";
import { waterLook, type WaterLook } from "./waterLook";

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

// The surface's colour for this spot, by depth, with the slow streaks. Same sin-free hash as the ground, for the
// same reason: sin() of large world coordinates differs between graphics cards.
export function waterShaderCode(look: WaterLook["surface"]): string {
  const { shore, deep, ragged, streaks } = look;
  const angle = (streaks.angleDegrees * Math.PI) / 180;
  return `
    {
      if (vWaterDepth <= 0.0) discard;
      vec2 wp = vWaterPos;
      float pixel = length(fwidth(wp));
      float depth = vWaterDepth + (wNoise(wp * ${f(ragged.scale)}) - 0.5) * ${f(ragged.meters * 2)};
      // Long light streaks drifting along their length, one band lighter than the water under them, faded out
      // before they are thinner than a pixel.
      vec2 sp = vec2(wp.x * ${f(Math.cos(angle))} + wp.y * ${f(Math.sin(angle))}, -wp.x * ${f(Math.sin(angle))} + wp.y * ${f(Math.cos(angle))});
      sp.x += waterTime * ${f(streaks.driftMetersPerSecond)};
      float streak = wNoise(vec2(sp.x * ${f(streaks.scale / streaks.stretch)}, sp.y * ${f(streaks.scale)}) + 19.0);
      float keep = 1.0 - smoothstep(${f(0.25 / streaks.scale)}, ${f(0.6 / streaks.scale)}, pixel);
      bool lit = streak > ${f(streaks.above)} && keep > 0.5;
      vec3 c = lit ? waterStreak : waterMain;
      if (depth < ${f(shore.belowMeters)}) c = waterShore;
      else if (depth > ${f(deep.aboveMeters)}) c = lit ? waterMain : waterDeep;
      diffuseColor.rgb = c;
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
// no rim, no gloss, the colour picked by depth. A touch see-through at most, so wading legs sink into it.
export function waterMaterial(look: WaterLook["surface"], ramp: THREE.Texture, color: (name: string) => string, time: { value: number }): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: color(look.main), gradientMap: ramp, transparent: look.opacity < 1, opacity: look.opacity });
  // Pulled a hair toward the camera, so where it meets the shore the water wins instead of flickering with the ground.
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -1;
  const colors: Record<string, string> = { waterMain: look.main, waterShore: look.shore.color, waterDeep: look.deep.color, waterStreak: look.streaks.color };
  const code = waterShaderCode(look);
  m.onBeforeCompile = (shader) => {
    for (const [name, value] of Object.entries(colors)) shader.uniforms[name] = { value: new THREE.Color(color(value)) };
    shader.uniforms.waterTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float waterDepth;\nvarying float vWaterDepth;\nvarying vec2 vWaterPos;\nvoid main() {")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vWaterDepth = waterDepth;
        vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    const declarations = Object.keys(colors).map((name) => `uniform vec3 ${name};`).join("\n");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `varying float vWaterDepth;\nvarying vec2 vWaterPos;\nuniform float waterTime;\n${declarations}\n${WATER_GLSL}\nvoid main() {`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${code}`);
  };
  m.customProgramCacheKey = () => "toon-water";
  return m;
}

// Streaks drift for this long and then start over, so the time stays small enough for float precision.
const TIME_WRAP_SECONDS = 3600;

// The water of the current map. The material is made once; a new map only swaps the geometry.
export class WaterMesh {
  readonly mesh: THREE.Mesh;
  private time = { value: 0 };

  constructor(scene: THREE.Scene, look: WaterLook["surface"], ramp: THREE.Texture, color: (name: string) => string, private seaMeters = waterLook.sea.outMeters) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), waterMaterial(look, ramp, color, this.time));
    this.mesh.visible = false;
    this.mesh.renderOrder = 1; // after the opaque world, like any see-through surface
    freeze(this.mesh);
    scene.add(this.mesh);
  }

  // The map's terrain, or null for none (the range). Dry maps draw nothing.
  setTerrain(terrain: Terrain | null): void {
    this.mesh.geometry.dispose();
    const geometry = terrain ? waterGeometry(terrain, this.seaMeters) : null;
    this.mesh.geometry = geometry ?? new THREE.BufferGeometry();
    this.mesh.visible = geometry !== null;
  }

  update(dt: number): void {
    this.time.value = (this.time.value + dt) % TIME_WRAP_SECONDS;
  }
}
