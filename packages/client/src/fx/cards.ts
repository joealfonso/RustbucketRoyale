import * as THREE from "three";
import { freeze } from "../freeze";

// Flat painted cards for effects that need a crisp drawn shape rather than a sprite from the sheet: muzzle stars,
// tracer streaks, hit flashes. Each shape is one small mesh with its toon colour bands baked into the vertices (hard
// edges, no gradients), and every card of that shape is one instance of a single InstancedMesh: one draw call however
// many are on screen, and nothing allocated after startup. The owner refills the batch every frame with the cards
// still alive, so dead cards cost nothing.

const color = new THREE.Color();

function colored(positions: number[], colors: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function pushColor(colors: number[], hex: string, vertices: number): void {
  color.set(hex);
  for (let i = 0; i < vertices; i++) colors.push(color.r, color.g, color.b);
}

// A star in the XY plane, 1 m across: `points` spikes, `inner` the notch depth (share of the radius), and a smaller
// star of the same shape in `core` at its middle. `aspect` stretches it sideways (a wide fan).
export function starCard(points: number, inner: number, aspect: number, coreScale: number, outer: string, core: string): THREE.BufferGeometry {
  const ring: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = (i % 2 === 0 ? 0.5 : 0.5 * inner);
    ring.push([Math.cos(a) * r * aspect, Math.sin(a) * r]);
  }
  const positions: number[] = [], colors: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
    // The core: a fan from the middle.
    positions.push(0, 0, 0, ax * coreScale, ay * coreScale, 0, bx * coreScale, by * coreScale, 0);
    pushColor(colors, core, 3);
    // The outer band: the strip between the core's outline and the star's.
    positions.push(ax * coreScale, ay * coreScale, 0, ax, ay, 0, bx, by, 0);
    positions.push(ax * coreScale, ay * coreScale, 0, bx, by, 0, bx * coreScale, by * coreScale, 0);
    pushColor(colors, outer, 6);
  }
  return colored(positions, colors);
}

// A needle along -Z, 1 m long and 1 m wide: head at z = 0, widest just behind it, tapering to a point at the tail.
// Three bands across its width, the middle `coreShare` of it in `core`.
export function needleCard(coreShare: number, outer: string, core: string): THREE.BufferGeometry {
  const profile: [number, number][] = [[0, 0.55], [-0.25, 1], [-1, 0]]; // z, share of full width
  const edge = coreShare / 2;
  const strips: [number, number, string][] = [[-0.5, -edge, outer], [-edge, edge, core], [edge, 0.5, outer]];
  const positions: number[] = [], colors: number[] = [];
  for (const [x0, x1, hex] of strips) {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [za, wa] = profile[i]!, [zb, wb] = profile[i + 1]!;
      positions.push(x0 * wa, 0, za, x1 * wa, 0, za, x1 * wb, 0, zb);
      positions.push(x0 * wa, 0, za, x1 * wb, 0, zb, x0 * wb, 0, zb);
      pushColor(colors, hex, 6);
    }
  }
  return colored(positions, colors);
}

// The colours are baked into the cards, so the material is shared. It keeps the fog, so far shots sit in the haze.
let cardMaterial: THREE.MeshBasicMaterial | null = null;
function material(): THREE.MeshBasicMaterial {
  cardMaterial ??= new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return cardMaterial;
}

// One shape, many cards. Call `begin`, then one placing call per live card, then `end`, once a frame.
export class CardBatch {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m: Float32Array;

  constructor(scene: THREE.Scene, geometry: THREE.BufferGeometry, readonly capacity: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material(), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // the cards move every frame; the mesh's own bounds would be stale
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.m = this.mesh.instanceMatrix.array as Float32Array;
    freeze(this.mesh); // the cards are instances; the mesh holding them never moves
    scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  // Faces the camera, turned `spin` radians, `sx` by `sy` metres.
  facing(camera: THREE.Camera, x: number, y: number, z: number, spin: number, sx: number, sy: number): void {
    if (this.n >= this.capacity) return;
    const e = camera.matrixWorld.elements;
    const c = Math.cos(spin), s = Math.sin(spin);
    // The camera's right and up, turned by spin, become the card's X and Y; its Z points back at the camera.
    this.write(
      (e[0]! * c + e[4]! * s) * sx, (e[1]! * c + e[5]! * s) * sx, (e[2]! * c + e[6]! * s) * sx,
      (e[4]! * c - e[0]! * s) * sy, (e[5]! * c - e[1]! * s) * sy, (e[6]! * c - e[2]! * s) * sy,
      e[8]!, e[9]!, e[10]!, x, y, z,
    );
  }

  // Lies along the unit direction (dx, dy, dz) with its head at the point and its tail `length` behind, turned round
  // that line to face the camera as well as it can, so a streak never goes edge-on.
  along(camera: THREE.Camera, x: number, y: number, z: number, dx: number, dy: number, dz: number, width: number, length: number): void {
    if (this.n >= this.capacity) return;
    const e = camera.matrixWorld.elements;
    const tx = e[12]! - x, ty = e[13]! - y, tz = e[14]! - z;
    // Side = direction x toward-camera; up = side x direction. Both are 0 when looking straight down the line, which
    // only happens for a moment and draws nothing.
    let sx = dy * tz - dz * ty, sy = dz * tx - dx * tz, sz = dx * ty - dy * tx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * dz - sz * dy, uy = sz * dx - sx * dz, uz = sx * dy - sy * dx;
    // The card's X is its width (side), its Y the face normal, its -Z the tail.
    this.write(sx * width, sy * width, sz * width, ux, uy, uz, dx * length, dy * length, dz * length, x, y, z);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private write(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, x: number, y: number, z: number,
  ): void {
    const m = this.m, o = this.n * 16;
    m[o] = ax; m[o + 1] = ay; m[o + 2] = az; m[o + 3] = 0;
    m[o + 4] = bx; m[o + 5] = by; m[o + 6] = bz; m[o + 7] = 0;
    m[o + 8] = cx; m[o + 9] = cy; m[o + 10] = cz; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    this.n++;
  }
}
