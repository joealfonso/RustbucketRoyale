import * as THREE from "three";

// Real sun shadows near the camera (V7a), drawn in the toon look by toonLight.ts. One shadow map from the key light,
// square round a point a little ahead of the camera, so everything you can see up close casts and receives. It moves
// in whole texels of the map, measured across the sun's rays, so shadow edges hold still as you walk instead of
// crawling; past `fadeFrom` of its radius the shadows fade out (toonLight.ts).
// What casts is decided by material: the master toon material and its world and own versions cast (toonMaterial.ts
// marks them), the ground, the water, outlines and effects never do. `castShadows` applies that to a built object.

export interface ShadowLevel {
  mapSize: number; // texels per side of the shadow map
  meters: number; // radius round the middle that gets shadows
}

export interface SunShadowLook {
  // One per effects quality level (data/vfx.json), so the F1 "Effects quality" switch also picks the shadow cost.
  levels: Record<string, ShadowLevel>;
  ahead: number; // the middle sits this share of `meters` ahead of the camera, along the ground
  reach: number; // metres toward the sun beyond the round area in which tall things still cast into it
  fadeFrom: number; // share of the radius where shadows start to fade out
  bias: number; // depth bias of the shadow test, in shadow-map depth units (negative pulls toward the light)
  normalBias: number; // metres each surface is pushed along its normal before the test, against shadow acne
  edge: number; // half the width of the shadow's band edge, in shadow-test units (toonLight.ts)
  // Share of the soft contact patches under map boxes (contactShadows.ts) kept where real shadows are drawn.
  contactNear: number;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseSunShadowLook(raw: unknown, qualityLevels: readonly string[]): SunShadowLook {
  const s = raw as SunShadowLook;
  if (!s?.levels) throw new Error("look.json: shadows needs levels");
  for (const name of qualityLevels) {
    const l = s.levels[name];
    if (!l) throw new Error(`look.json: shadows.levels needs ${name}, one per effects quality level in vfx.json`);
    if (!(Number.isInteger(l.mapSize) && l.mapSize >= 256 && l.mapSize <= 8192 && (l.mapSize & (l.mapSize - 1)) === 0)) throw new Error(`look.json: shadows.levels.${name}.mapSize must be a power of two from 256 to 8192`);
    if (!(isNumber(l.meters) && l.meters > 0)) throw new Error(`look.json: shadows.levels.${name}.meters must be above 0`);
  }
  for (const k of ["ahead", "fadeFrom", "contactNear"] as const) if (!(isNumber(s[k]) && s[k] >= 0 && s[k] <= 1)) throw new Error(`look.json: shadows.${k} must be 0 to 1`);
  if (!(isNumber(s.edge) && s.edge >= 0 && s.edge <= 0.5)) throw new Error("look.json: shadows.edge must be 0 to 0.5");
  if (!(isNumber(s.reach) && s.reach >= 0) || !isNumber(s.bias) || !(isNumber(s.normalBias) && s.normalBias >= 0)) throw new Error("look.json: shadows needs reach and normalBias 0 or more, and a bias");
  return s;
}

// Where the shadow map's middle goes for a camera at `eye` looking along `forward`, for a sun along `sun` (unit,
// toward the sun). Moved `ahead` of the camera along the ground, then snapped to whole texels across the sun's
// rays, so the same scene always lands on the same texels. Writes `out` and returns it; allocates nothing.
const across = new THREE.Vector3();
const up = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
export function shadowCentre(eye: THREE.Vector3, forward: THREE.Vector3, sun: THREE.Vector3, look: SunShadowLook, level: ShadowLevel, out: THREE.Vector3): THREE.Vector3 {
  const flat = Math.hypot(forward.x, forward.z);
  const shift = flat > 1e-6 ? (level.meters * look.ahead) / flat : 0;
  out.set(eye.x + forward.x * shift, eye.y, eye.z + forward.z * shift);
  // The shadow camera's own axes: Three's lookAt from the sun's side with the world's up.
  across.crossVectors(worldUp, sun).normalize();
  up.crossVectors(sun, across);
  const texel = (level.meters * 2) / level.mapSize;
  const a = Math.round(out.dot(across) / texel) * texel;
  const b = Math.round(out.dot(up) / texel) * texel;
  const depth = out.dot(sun);
  return out.set(0, 0, 0).addScaledVector(across, a).addScaledVector(up, b).addScaledVector(sun, depth);
}

const centre = new THREE.Vector3();
const forward = new THREE.Vector3();

export class SunShadows {
  private level: ShadowLevel;

  // `sun` is the key light; `toSun` the unit direction toward it, kept by the toon look and changed per light preset.
  constructor(renderer: THREE.WebGLRenderer, private sun: THREE.DirectionalLight, private toSun: THREE.Vector3, private look: SunShadowLook, quality: string) {
    renderer.shadowMap.enabled = true;
    // PCF gives the hardware-filtered depth compare that toonLight.ts cuts into a hard edge.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = true;
    sun.shadow.bias = look.bias;
    sun.shadow.normalBias = look.normalBias;
    sun.shadow.radius = 0;
    this.level = look.levels[quality]!;
    this.setQuality(quality);
  }

  // The radius round the middle of the shadow map that gets shadows, in metres, at the current quality.
  get meters(): number {
    return this.level.meters;
  }

  // How far ahead of the camera that middle sits, in metres.
  get ahead(): number {
    return this.level.meters * this.look.ahead;
  }

  // The effects quality level by name (fx/quality.ts). A new map size frees the old map; Three makes the new one.
  setQuality(name: string): void {
    const level = this.look.levels[name];
    if (!level) return;
    this.level = level;
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== level.mapSize) {
      shadow.mapSize.set(level.mapSize, level.mapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
    const camera = shadow.camera;
    camera.left = -level.meters;
    camera.right = level.meters;
    camera.top = level.meters;
    camera.bottom = -level.meters;
    camera.near = 1;
    camera.far = level.meters * 2 + this.look.reach;
    camera.updateProjectionMatrix();
  }

  // Off skips the shadow pass and shaders lose their shadow code, so the first frames after a switch recompile.
  setEnabled(on: boolean): void {
    this.sun.castShadow = on;
  }

  // Each frame before rendering: moves the shadow map to follow the camera.
  follow(camera: THREE.Camera): void {
    camera.getWorldDirection(forward);
    shadowCentre(camera.position, forward, this.toSun, this.look, this.level, centre);
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(this.toSun, this.level.meters + this.look.reach);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }
}

// Turns on shadow casting for every mesh under `root` drawn in a material that casts (see toonMaterial.ts), and off
// for the rest (outline shells, glows, the ground). Call once a thing is built, and again after adding meshes to it.
export function castShadows(root: THREE.Object3D): void {
  root.traverse(markCaster);
}

function markCaster(o: THREE.Object3D): void {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.castShadow = materials.some(castsShadow);
  if (mesh.castShadow) mesh.customDepthMaterial = depthFor(mesh);
}

// One depth material per kind of caster: instanced or not, coloured instances or not, and which side it shows. Left
// alone, three draws every caster's shadow with one shared depth material, and each switch between an instanced and
// a plain mesh re-decides its shader program: about seven times a frame, and most of the garbage the frame loop made
// (docs/PERF.md, optimization pass). A mesh with a texture or a cut-out keeps three's own copy, which it needs.
const depthMaterials = new Map<string, THREE.MeshDepthMaterial>();

export function depthFor(mesh: THREE.Mesh): THREE.MeshDepthMaterial | undefined {
  const m = mesh.material;
  if (Array.isArray(m) || m.alphaTest > 0 || m.alphaToCoverage || (m as THREE.MeshStandardMaterial).map || (m as THREE.MeshStandardMaterial).alphaMap
    || (m as THREE.MeshStandardMaterial).displacementMap || (m.clippingPlanes?.length ?? 0) > 0) return undefined;
  const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true;
  const coloured = instanced && (mesh as THREE.InstancedMesh).instanceColor !== null;
  const key = `${instanced}-${coloured}-${m.side}-${m.shadowSide}`;
  let depth = depthMaterials.get(key);
  if (!depth) {
    depth = new THREE.MeshDepthMaterial();
    depthMaterials.set(key, depth);
  }
  return depth;
}

export function castsShadow(material: THREE.Material | undefined): boolean {
  return material?.userData.castsShadow === true;
}
