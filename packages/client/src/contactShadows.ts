import * as THREE from "three";
import type { Box, Terrain, World } from "@rustbucket/shared";
import { freeze } from "./freeze";
import { onHills } from "./groundTilt";

// Soft dark patches on the ground under things, so crates, walls and mechs sit on the floor instead of floating
// over it. Not real shadows: no light direction, just the darkening where an object meets the ground.
// Static ones go under every map box that stands on the ground, built once per map; moving ones follow the mechs.
// Near the camera the sun's real shadows (sunShadows.ts) and the contact darkening on the boxes themselves do this
// job, so the static patches fade down to a share of their strength there (`fadeNear`) and only carry the grounding
// past the shadow range. The mechs keep theirs at every distance: it shows how high a jetting mech is over the ground.
// Each set is one instanced mesh of flat quads, so all of it costs two draw calls.

export interface ShadowLook {
  color: string; // hex or palette name
  lift: number; // metres above the surface, so the quad does not flicker into it
  falloff: number; // how quickly the dark fades toward the rim: 1 even, higher keeps more of it near the middle
  // Under map boxes: boxes starting no higher than `nearGround` and at least `minHeight` tall. The patch reaches past
  // the footprint by `growPerMeter` of the box's height, kept between `minGrow` and `maxGrow`, and fades over that.
  static: { darkness: number; nearGround: number; minHeight: number; growPerMeter: number; minGrow: number; maxGrow: number };
  // Under mechs: a disc `radius` metres across the middle, shrinking to `minScale` and fading out by `fadeHeight`
  // metres above the ground. `maxCount` caps how many are drawn.
  moving: { darkness: number; radius: number; fadeHeight: number; minScale: number; maxCount: number };
}

export function parseShadowLook(raw: unknown): ShadowLook {
  const s = raw as ShadowLook;
  if (!s?.static || !s.moving || typeof s.color !== "string") throw new Error("ground.json shadows: needs color, static and moving");
  if (!(s.static.minGrow > 0 && s.static.minGrow <= s.static.maxGrow)) throw new Error("ground.json shadows: static needs 0 < minGrow <= maxGrow");
  if (!(s.moving.fadeHeight > 0 && s.moving.radius > 0 && s.moving.maxCount >= 1)) throw new Error("ground.json shadows: moving needs fadeHeight, radius and maxCount above 0");
  for (const d of [s.static.darkness, s.moving.darkness, s.moving.minScale]) if (!(d >= 0 && d <= 1)) throw new Error("ground.json shadows: darkness and minScale run 0 to 1");
  return s;
}

export interface Footprint {
  x: number; z: number; // middle
  y: number; // the surface it lies on
  sizeX: number; sizeZ: number; // the whole patch, metres
  soft: number; // how far in from the rim it fades, metres
}

// The patch under one map box, or false for a box that does not stand on the ground (the floor itself, flat strips,
// anything stacked on top of something else, whose patch would be hidden under what it stands on). `ground` is the
// height of the hills under the middle of the box, 0 on a map with none.
export function shadowFootprint(box: Box, look: ShadowLook["static"], out: Footprint, ground = 0): boolean {
  const base = Math.max(ground, box.minY);
  const height = box.maxY - base;
  if (box.minY > ground + look.nearGround || height < look.minHeight) return false;
  const grow = Math.min(look.maxGrow, Math.max(look.minGrow, height * look.growPerMeter));
  out.x = (box.minX + box.maxX) / 2;
  out.z = (box.minZ + box.maxZ) / 2;
  out.y = base;
  out.sizeX = box.maxX - box.minX + grow * 2;
  out.sizeZ = box.maxZ - box.minZ + grow * 2;
  out.soft = grow;
  return true;
}

// How dark a mech's patch is at `height` metres over the ground: full on the ground, gone at fadeHeight.
export function shadowStrength(height: number, look: ShadowLook["moving"]): number {
  return look.darkness * (1 - Math.min(1, Math.max(0, height / look.fadeHeight)));
}

// How big it is: full size on the ground, minScale at fadeHeight and above.
export function shadowScale(height: number, look: ShadowLook["moving"]): number {
  return 1 - (1 - look.minScale) * Math.min(1, Math.max(0, height / look.fadeHeight));
}

// The highest surface at or below `y` under the point (x, z): a box top, the hills, or the floor (0 on a map with
// no hills). `found` is reused, so this allocates nothing.
export function surfaceBelow(world: World, x: number, y: number, z: number, found: number[]): number {
  const n = world.query(x, z, x, z, found);
  let best = world.terrain ? world.groundAt(x, z) : 0;
  for (let k = 0; k < n; k++) {
    const b = world.boxes[found[k]!]!;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    // A little slack: a mech standing on a box is at its top, give or take rounding.
    if (b.maxY <= y + 0.05 && b.maxY > best) best = b.maxY;
  }
  return best;
}

// The one shared soft disc, drawn once at startup. Art hook: a painted blob texture can replace it.
export function makeShadowTexture(falloff: number, size = 64): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const stops = 8;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    gradient.addColorStop(t, `rgba(255,255,255,${(1 - t) ** falloff})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// The disc stretched to any rectangle without stretching its rim: the middle stays full and only the outer `soft`
// metres fade, with rounded corners, so a long wall gets an even band and a mech a round patch.
// Per instance: `shadowShape` holds (strength, soft metres); the size comes from the instance's scale.
// `near` (from metres, to metres, share kept) fades the patches by distance from the camera: down to the share kept
// within `from`, full strength past `to`. Null for patches that never fade.
function makeShadowMaterial(texture: THREE.Texture, color: string, near: { value: THREE.Vector3 } | null): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.shadowDisc = { value: texture };
    if (near) shader.uniforms.shadowNear = near;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute vec2 shadowShape;\nvarying vec2 vShadowAt;\nvarying vec2 vShadowHalf;\nvarying vec2 vShadowShape;\nvarying float vShadowDistance;\nvoid main() {")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec2 shadowSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        vShadowAt = position.xz * shadowSize;
        vShadowHalf = shadowSize * 0.5;
        vShadowShape = shadowShape;
        vShadowDistance = distance((modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz, cameraPosition);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `uniform sampler2D shadowDisc;\n${near ? "uniform vec3 shadowNear;\n" : ""}varying vec2 vShadowAt;\nvarying vec2 vShadowHalf;\nvarying vec2 vShadowShape;\nvarying float vShadowDistance;\nvoid main() {`)
      .replace("#include <alphamap_fragment>", `#include <alphamap_fragment>
        float shadowSoft = max(min(vShadowShape.y, min(vShadowHalf.x, vShadowHalf.y)), 0.001);
        vec2 intoRim = max(abs(vShadowAt) - (vShadowHalf - shadowSoft), 0.0) / shadowSoft;
        diffuseColor.a *= texture2D(shadowDisc, 0.5 + 0.5 * intoRim).a * vShadowShape.x;
        ${near ? "diffuseColor.a *= mix(shadowNear.z, 1.0, smoothstep(shadowNear.x, shadowNear.y, vShadowDistance));" : ""}`);
  };
  m.customProgramCacheKey = () => (near ? "contact-shadow-near" : "contact-shadow");
  return m;
}

const flatQuad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const placed = new THREE.Matrix4();
const at = new THREE.Vector3();
const sized = new THREE.Vector3();
const noTurn = new THREE.Quaternion();
const leaning = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const slope = new THREE.Vector3();
const normal = [0, 1, 0];
const gone = new THREE.Matrix4().makeScale(0, 0, 0);
const footprint: Footprint = { x: 0, z: 0, y: 0, sizeX: 0, sizeZ: 0, soft: 0 };

// The turn that lays a flat patch along the hillside at (x, z). Shared scratch: use it before the next call.
function leanOn(terrain: Terrain, x: number, z: number): THREE.Quaternion {
  terrain.normalAt(x, z, normal);
  return leaning.setFromUnitVectors(up, slope.set(normal[0]!, normal[1]!, normal[2]!));
}

function shadowMesh(material: THREE.Material, count: number): { mesh: THREE.InstancedMesh; shape: THREE.InstancedBufferAttribute } {
  const geometry = flatQuad.clone();
  const shape = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  geometry.setAttribute("shadowShape", shape);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  // Drawn first among the see-through things, under dust, ghosts and the zone wall.
  mesh.renderOrder = -1;
  // The patches are instances; the mesh holding them stays where it is, even for the ones that follow mechs.
  freeze(mesh);
  return { mesh, shape };
}

export class ContactShadows {
  private material: THREE.MeshBasicMaterial;
  private stillMaterial: THREE.MeshBasicMaterial;
  // Until `fadeNear` is called the static patches never fade.
  private near = { value: new THREE.Vector3(0, 0, 1) };
  private still: { mesh: THREE.InstancedMesh; shape: THREE.InstancedBufferAttribute } | null = null;
  private instanceOfBox = new Int32Array(0);
  private moving: { mesh: THREE.InstancedMesh; shape: THREE.InstancedBufferAttribute };
  private movingCount = 0;
  private world: World | null = null;
  private found: number[] = [];

  constructor(private scene: THREE.Scene, private look: ShadowLook, color: string) {
    const disc = makeShadowTexture(look.falloff);
    this.material = makeShadowMaterial(disc, color, null);
    this.stillMaterial = makeShadowMaterial(disc, color, this.near);
    this.moving = shadowMesh(this.material, look.moving.maxCount);
    // They move every frame, so the bounds are never right for culling. There are only a few.
    this.moving.mesh.frustumCulled = false;
    this.moving.mesh.count = 0;
    scene.add(this.moving.mesh);
  }

  // Lays the patches under a new map's boxes, replacing the last map's.
  setMap(boxes: readonly Box[], world: World): void {
    this.disposeStill();
    this.world = world;
    this.instanceOfBox = new Int32Array(boxes.length).fill(-1);
    let count = 0;
    const groundUnder = (b: Box) => (world.terrain ? world.groundAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) : 0);
    boxes.forEach((b, i) => { if (shadowFootprint(b, this.look.static, footprint, groundUnder(b))) this.instanceOfBox[i] = count++; });
    const still = shadowMesh(this.stillMaterial, Math.max(1, count));
    still.mesh.count = count;
    boxes.forEach((b, i) => {
      const instance = this.instanceOfBox[i]!;
      if (instance < 0 || !shadowFootprint(b, this.look.static, footprint, groundUnder(b))) return;
      // Buildings stand on level pads, but a crate or barrel can sit on open hillside: lean its patch with the slope.
      const turn = world.terrain ? leanOn(world.terrain, footprint.x, footprint.z) : noTurn;
      still.mesh.setMatrixAt(instance, placed.compose(at.set(footprint.x, footprint.y + this.look.lift, footprint.z), turn, sized.set(footprint.sizeX, 1, footprint.sizeZ)));
      still.shape.setXY(instance, this.look.static.darkness, footprint.soft);
    });
    still.mesh.instanceMatrix.needsUpdate = true;
    still.shape.needsUpdate = true;
    still.mesh.computeBoundingSphere();
    this.scene.add(still.mesh);
    this.still = still;
  }

  // Where the sun's real shadows are drawn: the static patches keep `share` of their strength within `fromMeters` of
  // the camera, rising to full by `toMeters`.
  fadeNear(fromMeters: number, toMeters: number, share: number): void {
    this.near.value.set(fromMeters, Math.max(toMeters, fromMeters + 0.01), share);
  }

  // A broken prop's patch goes with it.
  hideBox(boxIndex: number): void {
    const instance = this.instanceOfBox[boxIndex] ?? -1;
    if (!this.still || instance < 0) return;
    this.still.mesh.setMatrixAt(instance, gone);
    this.still.mesh.instanceMatrix.needsUpdate = true;
  }

  // Each frame: `beginMoving`, `addUnder` for every mech, then `endMoving`.
  beginMoving(): void {
    this.movingCount = 0;
  }

  // A patch on the surface under something at (x, y, z), its feet at y. Bound once, so it can be handed to a loop.
  addUnder = (x: number, y: number, z: number): void => {
    if (this.movingCount >= this.look.moving.maxCount || !this.world) return;
    const ground = surfaceBelow(this.world, x, y, z, this.found);
    const strength = shadowStrength(y - ground, this.look.moving);
    if (strength <= 0.01) return;
    const size = this.look.moving.radius * 2 * shadowScale(y - ground, this.look.moving);
    const i = this.movingCount++;
    // On a hillside the patch leans with the slope, so it neither sinks in uphill nor floats downhill.
    const terrain = this.world.terrain;
    const turn = terrain && onHills(terrain, x, z, ground) ? leanOn(terrain, x, z) : noTurn;
    this.moving.mesh.setMatrixAt(i, placed.compose(at.set(x, ground + this.look.lift, z), turn, sized.set(size, 1, size)));
    // Soft all the way in: a round patch, darkest in the middle.
    this.moving.shape.setXY(i, strength, size / 2);
  };

  addObject = (object: THREE.Object3D): void => {
    if (object.visible) this.addUnder(object.position.x, object.position.y, object.position.z);
  };

  endMoving(): void {
    this.moving.mesh.count = this.movingCount;
    this.moving.mesh.instanceMatrix.needsUpdate = true;
    this.moving.shape.needsUpdate = true;
  }

  private disposeStill(): void {
    if (!this.still) return;
    this.scene.remove(this.still.mesh);
    this.still.mesh.geometry.dispose();
    this.still.mesh.dispose();
    this.still = null;
  }
}
