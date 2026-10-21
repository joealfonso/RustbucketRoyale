import * as THREE from "three";
import { freeze } from "../freeze";
import { flickerFrame, flipbookFrame, SlotRing, stepped } from "./flipbook";
import { CELL, COLUMNS, paintSpriteSheet, ROWS } from "./spriteArt";

// One pool of flat toon sprites in one palette, drawn in a single draw call however many are alive: fireballs,
// smoke puffs, dust, sparks, flames, shockwave rings and scorch marks are all sprites from the painted sheet
// (spriteArt.ts). Every sprite is made at startup; spawning takes the next slot and overwrites it, reusing the oldest
// when all are busy. The quality level (fx/quality.ts) sets how many slots are in use.
//
// A sprite can face the camera (BILLBOARD), stretch along a line and turn round it to face the camera (AXIS: a spark's
// tail, a jet flame), or lie flat on the ground (FLAT: rings, scorches). It shows three hard colour bands, fades by
// dissolving in hard-edged steps, and its size grows in steps, so it reads like hand drawn frames, not a particle.

export const BILLBOARD = 0;
export const AXIS = 1;
export const FLAT = 2;

// One pooled sprite: plain numbers, reset on every spawn, so nothing is allocated while playing.
export interface Sprite {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  gravity: number; // metres a second squared, down; negative floats it up faster
  drag: number; // share of speed lost a second
  age: number; // seconds; below 0 it waits that long before showing
  life: number;
  size0: number; size1: number; // width in metres at the start and the end, grown in steps
  aspect: number; // length over width, for AXIS and FLAT
  frame0: number; frames: number; // the flipbook: first cell in the sheet and how many
  fps: number; // 0 spreads the frames over the life once; above 0 loops them (a flicker)
  shade0: number; shade1: number; // bands shifted darker over the life: 0 none, 1 one band, 2 all dark
  dissolve0: number; // how eaten away it starts, 0 to 1 (thin smoke starts ragged)
  fadeShare: number; // the last share of its life it spends dissolving away
  spin: number; spinRate: number; // radians, and radians a second
  mode: number;
  ax: number; ay: number; az: number; // AXIS: the direction it stretches in; ignored when `streak` is above 0
  streak: number; // AXIS: seconds of travel its tail shows, the tail pointing back along its velocity
  floor: number; // it stops falling at this height
  tiltX: number; tiltZ: number; // FLAT: the ground's rise per metre along x and z, so the mark lies on a slope
}

export interface SpriteLook {
  colors: [string, string, string]; // light, mid, dark band
  growSteps: number;
  layer?: "ground"; // drawn just over the ground, for marks that lie on it
  fadeFromMeters?: number; fadeToMeters?: number; // marks further than this from the camera dissolve away
  // Sprites this close to the camera dissolve away, so smoke from the mech you watch never fills the screen.
  clearFromMeters?: number; clearToMeters?: number;
  // A hand-drawn outline round the shape and round the holes it dissolves into (the drop-in's effects, gate 16b):
  // its colour, its width as a share of INK_SPAN (0 to 1), and how wide the inked rim of a dissolving hole is (0 to 1).
  ink?: { color: string; width: number; holeWidth: number };
}

let sheet: THREE.DataTexture | null = null;
function spriteSheet(): THREE.DataTexture {
  if (sheet) return sheet;
  sheet = new THREE.DataTexture(paintSpriteSheet(), COLUMNS * CELL, ROWS * CELL, THREE.RGBAFormat);
  sheet.magFilter = THREE.LinearFilter;
  sheet.minFilter = THREE.LinearFilter;
  sheet.needsUpdate = true;
  return sheet;
}

const VERTEX = /* glsl */ `
  attribute vec3 aPos;
  attribute vec3 aAxis;
  attribute vec2 aSize;
  attribute vec4 aLook; // frame, dissolve, shade, spin
  attribute float aMode;
  varying vec2 vUv;
  varying vec3 vLook;
  #include <fog_pars_vertex>
  void main() {
    vec2 c = position.xy;
    float s = sin(aLook.w), k = cos(aLook.w);
    // FLAT: the quad's y runs along the ground's z; aSize.y is its length there.
    vec4 mvPosition;
    if (aMode < 0.5) {
      mvPosition = viewMatrix * vec4(aPos, 1.0);
      mvPosition.xy += vec2(c.x * k - c.y * s, c.x * s + c.y * k) * aSize;
    } else if (aMode < 1.5) {
      vec3 axis = normalize(aAxis + vec3(0.0, 1e-5, 0.0));
      vec3 side = normalize(cross(axis, normalize(cameraPosition - aPos)) + vec3(1e-5, 0.0, 0.0));
      mvPosition = viewMatrix * vec4(aPos + side * c.x * aSize.x + axis * (c.y + 0.5) * aSize.y, 1.0);
    } else {
      // aAxis.xz carries the slope here, so a mark on a hillside leans with it.
      vec3 lying = vec3(c.x * k - c.y * s, 0.0, c.x * s + c.y * k) * aSize.xxy;
      lying.y = lying.x * aAxis.x + lying.z * aAxis.z;
      mvPosition = viewMatrix * vec4(aPos + lying, 1.0);
    }
    vUv = uv;
    vLook = aLook.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D sheet;
  uniform vec3 band0;
  uniform vec3 band1;
  uniform vec3 band2;
  #ifdef INKED
  uniform vec3 inkColor;
  uniform float inkWidth;
  uniform float holeWidth;
  #endif
  varying vec2 vUv;
  varying vec3 vLook;
  #include <fog_pars_fragment>
  void main() {
    float frame = vLook.x;
    vec2 cell = vec2(mod(frame, ${COLUMNS}.0), floor(frame / ${COLUMNS}.0));
    // Half a pixel in from the cell's edge, so the neighbouring cell never bleeds in.
    vec2 inCell = mix(vec2(0.5 / ${CELL}.0), vec2(1.0 - 0.5 / ${CELL}.0), vUv);
    vec4 ink = texture2D(sheet, (cell + inCell) / vec2(${COLUMNS}.0, ${ROWS}.0));
    if (ink.a < 0.5 || ink.g < vLook.y) discard;
    float band = floor(ink.r * 3.0 + vLook.z);
    vec3 color = band < 0.5 ? band0 : band < 1.5 ? band1 : band2;
    #ifdef INKED
    // The outline: near the shape's edge, or at the rim of a hole it is dissolving into (only once it has begun to).
    if (ink.b < inkWidth || (vLook.y > 0.001 && ink.g < vLook.y + holeWidth)) color = inkColor;
    #endif
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export class SpritePool {
  readonly mesh: THREE.Mesh;
  private sprites: Sprite[] = [];
  private immediate: Sprite[] = [];
  private immediateUsed = 0;
  private ring = new SlotRing();
  private pos: Float32Array; private axis: Float32Array; private size: Float32Array; private look: Float32Array; private mode: Float32Array;
  private attributes: THREE.InstancedBufferAttribute[];
  private geometry: THREE.InstancedBufferGeometry;

  // `capacity` sprites that live on their own, plus `immediateCapacity` drawn for one frame only (jet flames).
  // The limits are read on every spawn: the quality level's caps for this pool.
  constructor(
    scene: THREE.Scene, private spriteLook: SpriteLook, color: (name: string) => string, capacity: number, private limit: () => number,
    immediateCapacity = 0, private immediateLimit: () => number = () => immediateCapacity,
  ) {
    const total = capacity + immediateCapacity;
    for (let i = 0; i < capacity; i++) this.sprites.push(blank());
    for (let i = 0; i < immediateCapacity; i++) this.immediate.push(blank());
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute("position", quad.getAttribute("position"));
    this.geometry.setAttribute("uv", quad.getAttribute("uv"));
    this.pos = new Float32Array(total * 3); this.axis = new Float32Array(total * 3); this.size = new Float32Array(total * 2);
    this.look = new Float32Array(total * 4); this.mode = new Float32Array(total);
    this.attributes = [
      new THREE.InstancedBufferAttribute(this.pos, 3), new THREE.InstancedBufferAttribute(this.axis, 3), new THREE.InstancedBufferAttribute(this.size, 2),
      new THREE.InstancedBufferAttribute(this.look, 4), new THREE.InstancedBufferAttribute(this.mode, 1),
    ];
    ["aPos", "aAxis", "aSize", "aLook", "aMode"].forEach((name, i) => {
      this.attributes[i]!.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, this.attributes[i]!);
    });
    this.geometry.instanceCount = 0;
    const [c0, c1, c2] = spriteLook.colors.map((c) => new THREE.Color(color(c)));
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { sheet: { value: null }, band0: { value: c0 }, band1: { value: c1 }, band2: { value: c2 } }]),
    });
    material.uniforms.sheet!.value = spriteSheet();
    if (spriteLook.ink) {
      material.defines = { INKED: "" };
      material.uniforms.inkColor = { value: new THREE.Color(color(spriteLook.ink.color)) };
      material.uniforms.inkWidth = { value: spriteLook.ink.width };
      material.uniforms.holeWidth = { value: spriteLook.ink.holeWidth };
    }
    if (spriteLook.layer === "ground") { material.polygonOffset = true; material.polygonOffsetFactor = -2; material.polygonOffsetUnits = -4; }
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false; // the sprites are placed in the shader, so the quad's own bounds mean nothing
    freeze(this.mesh); // for the same reason the mesh itself never moves
    scene.add(this.mesh);
  }

  // The next free sprite, reset, for the caller to fill in. Null when the quality level allows none.
  spawn(): Sprite | null {
    const slot = this.ring.take(Math.min(this.limit(), this.sprites.length));
    if (slot < 0) return null;
    return reset(this.sprites[slot]!);
  }

  // A sprite drawn this frame only, placed afresh every frame by its owner. Null once this frame's are used up.
  draw(): Sprite | null {
    if (this.immediateUsed >= Math.min(this.immediate.length, this.immediateLimit())) return null;
    return reset(this.immediate[this.immediateUsed++]!);
  }

  // Every slot past the quality level's cap goes, so a lower level frees its sprites at once.
  trim(): void {
    const limit = this.limit();
    for (let i = limit; i < this.sprites.length; i++) this.sprites[i]!.life = 0;
  }

  update(dt: number, camera: THREE.Vector3): void {
    let n = 0;
    for (const s of this.sprites) {
      if (s.life <= 0 || s.age >= s.life) continue;
      s.age += dt;
      if (s.age < 0) continue;
      if (s.age >= s.life) continue;
      const slow = Math.max(0, 1 - s.drag * dt);
      s.vx *= slow; s.vz *= slow;
      s.vy = s.vy * slow - s.gravity * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < s.floor) { s.y = s.floor; s.vy = 0; }
      n = this.write(s, n, camera);
    }
    for (let i = 0; i < this.immediateUsed; i++) n = this.write(this.immediate[i]!, n, camera);
    this.immediateUsed = 0;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0; // no draw call for a pool with nothing alive
    if (n > 0) for (const a of this.attributes) a.needsUpdate = true;
  }

  private write(s: Sprite, n: number, camera: THREE.Vector3): number {
    const t = s.life > 0 ? Math.min(1, Math.max(0, s.age) / s.life) : 0;
    const grow = stepped(t, this.spriteLook.growSteps);
    const width = s.size0 + (s.size1 - s.size0) * grow;
    const fadeT = s.fadeShare > 0 ? Math.max(0, (t - (1 - s.fadeShare)) / s.fadeShare) : 0;
    let dissolve = Math.max(s.dissolve0, stepped(fadeT, this.spriteLook.growSteps) * 0.98);
    const { fadeFromMeters: near, fadeToMeters: far } = this.spriteLook;
    if (near !== undefined && far !== undefined && far > near) {
      const away = Math.hypot(s.x - camera.x, s.z - camera.z);
      if (away >= far) return n;
      dissolve = Math.max(dissolve, (away - near) / (far - near));
    }
    const { clearFromMeters: clearFrom = 0, clearToMeters: clearTo = 0 } = this.spriteLook;
    if (clearFrom > clearTo) {
      const near = Math.hypot(s.x - camera.x, s.y - camera.y, s.z - camera.z);
      if (near < clearFrom) dissolve = Math.max(dissolve, (clearFrom - near) / (clearFrom - clearTo));
    }
    if (dissolve >= 0.99) return n;
    const frame = s.fps > 0 ? flickerFrame(s.age, s.fps, s.frames) : flipbookFrame(s.age, s.life, s.frames);
    let length = width * s.aspect;
    let ax = s.ax, ay = s.ay, az = s.az;
    if (s.mode === FLAT) { ax = s.tiltX; ay = 0; az = s.tiltZ; }
    if (s.mode === AXIS && s.streak > 0) {
      ax = -s.vx; ay = -s.vy; az = -s.vz;
      length = width * s.aspect + Math.hypot(ax, ay, az) * s.streak;
    }
    this.pos[n * 3] = s.x; this.pos[n * 3 + 1] = s.y; this.pos[n * 3 + 2] = s.z;
    this.axis[n * 3] = ax; this.axis[n * 3 + 1] = ay; this.axis[n * 3 + 2] = az;
    this.size[n * 2] = width; this.size[n * 2 + 1] = s.mode === BILLBOARD ? width : length;
    this.look[n * 4] = s.frame0 + frame;
    this.look[n * 4 + 1] = dissolve;
    this.look[n * 4 + 2] = s.shade0 + (s.shade1 - s.shade0) * grow;
    this.look[n * 4 + 3] = s.spin + s.spinRate * Math.max(0, s.age);
    this.mode[n] = s.mode;
    return n + 1;
  }
}

function blank(): Sprite {
  return reset({} as Sprite);
}

function reset(s: Sprite): Sprite {
  s.x = 0; s.y = 0; s.z = 0; s.vx = 0; s.vy = 0; s.vz = 0; s.gravity = 0; s.drag = 0;
  s.age = 0; s.life = 0; s.size0 = 1; s.size1 = 1; s.aspect = 1; s.frame0 = 0; s.frames = 1; s.fps = 0;
  s.shade0 = 0; s.shade1 = 0; s.dissolve0 = 0; s.fadeShare = 0; s.spin = 0; s.spinRate = 0; s.mode = BILLBOARD;
  s.ax = 0; s.ay = -1; s.az = 0; s.streak = 0; s.floor = -Infinity; s.tiltX = 0; s.tiltZ = 0;
  return s;
}
